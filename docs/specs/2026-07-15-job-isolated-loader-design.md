# Job-isolated CLI loader (boundary + PBF) — design (2026-07-15)

Operational/infra follow-up to `docs/specs/2026-07-02-crawlable-seo-pages-design.md` (§11.3 boundary
load) and `docs/specs/2026-06-21-osm-pbf-large-scale-import-design.md`. **No change to the data
model, the loader/membership SQL, or the URL contract** — only to *where* the loader CLI runs and how
a cancelled run is torn down.

## Problem — the worldwide boundary fan-out stalls, OOMs, and makes no progress

Both operator data-load workflows run their CLI **inside the running backend serving pod** via
`kubectl exec` (`osm-boundary-load.yml:181`, `osm-import-pbf.yml:226` — "same pod-exec pattern"). A
production fan-out session (loading the remaining ~54 countries) exhibited three failures:

1. **60–90-minute "loads" that did ~14 minutes of work.** A re-load of Austria (2,336 boundary
   features, all `UPDATE`s) took 74 min wall-clock, but the membership refresh itself was only ~14
   min. The other **~60 minutes was a single log-silent gap** between the loader starting and its
   first log line — i.e. blocking on the `ADD_FOUNTAIN_LOCK` advisory transaction lock that
   `refresh_country_memberships` takes (`backend/app/membership.py:1172`).
2. **`exit code 137` (OOM) failures.** The loader shares the serving pod's memory; a country-scale
   load (or several stacked loaders — see below) pushes the pod over its `1.5Gi` limit and the kernel
   OOM-kills the loader subprocess. (Serving-pod resources are in `infra/k8s/backend.yaml`; its own
   Deployment comment at `infra/k8s/backend.yaml:157` already flags "a Job-isolated loader is the
   cleaner long-term fix".)
3. **Zero net progress.** Over an overnight session the indexed-country count stayed at 8; loads spent
   their time blocked or were cancel/OOM-killed before finishing.

### Confirmed root cause — orphaned in-pod loaders hold the lock

`kubectl exec` **does not propagate GitHub's job-cancellation kill to the in-pod process.** When a
run is cancelled (the fan-out driver produced many cancelled runs — GitHub's `concurrency` keeps at
most one running + one pending per group, auto-cancelling the rest), the runner's `kubectl exec`
client dies but the **`python -m app.imports.boundary_cli` process keeps running inside the serving
pod**, still holding its open transaction and the `ADD_FOUNTAIN_LOCK` advisory lock while it finishes
its ~14-min refresh. During the runaway, several such orphans stacked up on the one advisory lock, so
the next real load waited ~1 hour for them to drain. The orphans also accumulate memory in the shared
pod → the OOM failures.

Evidence: no DB timeout can produce a ~3,600 s cutoff (`statement_timeout`, `lock_timeout`,
`idle_session_timeout` = `0`; `idle_in_transaction_session_timeout` = 24 h), so the gap was a
lock-wait that cleared when a holder finished; a clean subsequent load of a **larger** country (AU,
14,569 features), dispatched after the runaway stopped, had only a **~3-min** upsert→refresh gap
instead of 60; and a live orphan-capable process (`python -m app.imports.boundary_cli --scope-id
overture:au`) was observed running in the pod. All three symptoms trace to the one cause.

## Goal

Run each operator load in its **own isolated Kubernetes Job**, so that:

- The loader never shares memory with the API (kills the OOM-in-serving-pod failure mode).
- Cancelling a run (or the runner dying) **tears the loader down and releases the advisory lock
  immediately** — no process can survive to orphan the lock.
- A serial fan-out completes each country in its true ~15-min time with no 60-min stalls.

Scope (per owner decision): **generalize to a reusable "run a backend CLI as an isolated Job"
pattern and convert BOTH `osm-boundary-load.yml` and `osm-import-pbf.yml`.**

## Key architectural decision — fetch on the runner, execute in a Job

The heavy fetch/prepare tooling stays exactly where it already works (the ephemeral runner): DuckDB +
the anonymous-S3 Overture pull for boundaries; the Geofabrik download + `osmium` filter + PostGIS
`.poly`→WKT validation (needing up to ~75 GB of runner disk) for PBF. **Only the final CLI execution
moves off `kubectl exec`-into-serving-pod and into a one-shot Job.** The prepared file(s) are streamed
into the Job with the same `kubectl exec -i … 'cat > …'` mechanism used today.

Rejected alternatives: an object-store (DO Spaces) handoff — Spaces is `optional`/disabled in prod
(photos off), so it would need enabling first; a self-fetching Job — would bloat the shared backend
image with DuckDB + osmium (also inflating the serving pod) and need ~75 GB of ephemeral disk on the
PBF Job pod.

## Design

### A. Reusable composite action — `.github/actions/run-loader-job/`

Inputs: `job_name`, `image` (optional; defaults to discovery), the CLI **argv**, a list of
`local_path:container_path` file pairs to stream, and resource overrides. It:

1. **Discovers the deployed image** — `kubectl -n "$NAMESPACE" get deployment fountainrank-backend
   -o jsonpath='{.spec.template.spec.containers[0].image}'` — so the Job runs the **exact code
   currently in production**, never a drifting `latest`.
2. **Pre-flight cleanup** — `kubectl delete job "$job_name" --ignore-not-found --wait` (the workflow
   `concurrency` group already serializes, so at most one is ever live; this clears a stale one from
   an abnormally-terminated prior run).
3. **Renders + creates** the Job (envsubst of the template in §B, `kubectl create -f -`).
4. **Waits for the Job pod to be Running**, then streams each input file
   (`kubectl exec -i "$pod" -- sh -c 'cat > <container_path>'`) and finally
   `kubectl exec "$pod" -- touch /work/.ready`.
5. **Streams logs** (`kubectl logs -f job/"$job_name"`) and **waits for terminal state**
   (`kubectl wait --for=condition=complete/failed`), then reads the Job's success condition and
   **exits non-zero on failure** so CI reflects the true result.
6. **Trap** on `EXIT`/`INT`/`TERM` → `kubectl delete job "$job_name" --wait` — a cancelled run (which
   sends a signal to the step) tears down the Job, killing the pod and releasing the lock.

### B. Job manifest — `infra/k8s/loader-job.yaml` (rendered per-run; NOT applied by `deploy.yml`)

A `batch/v1` **Job** (not CronJob) copying the security/DB wiring of
`infra/k8s/account-deletion-cleanup.yaml`:

- **Image:** the discovered backend image (`§A.1`).
- **Env:** minimal — `DATABASE_URL` (secretKeyRef) + `DB_SSL_ROOT_CERT` with the `database-ca.crt`
  volume. The loaders talk to Postgres only; no Logto/Spaces/email env.
- **Volumes:** the CA secret (read-only) + a writable `emptyDir` at `/work` for the streamed files
  (root fs stays read-only).
- **`securityContext`:** `runAsNonRoot`, `runAsUser/Group 1000`, `readOnlyRootFilesystem: true`,
  `allowPrivilegeEscalation: false`, drop ALL caps, `seccompProfile: RuntimeDefault` — matching the
  cleanup CronJob so the manifest passes the security scanners.
- **`restartPolicy: Never`, `backoffLimit: 0`** — a failed load fails the Job; no silent retry and no
  re-entering the wait loop.
- **`activeDeadlineSeconds`** (default `7200`, overridable per workflow) — hard self-terminate
  backstop: even if the cancellation trap never runs (runner hard-killed), the Job dies on its own and
  releases the lock. Set generously above the largest legitimate load's runtime (a big PBF import may
  need more than a scoped boundary load).
- **`ttlSecondsAfterFinished: 600`** — auto-clean finished Jobs.
- **Entrypoint** — an inline `sh` wrapper (no image change) that waits up to ~300 s for `/work/.ready`
  then `exec`s the passed CLI argv:
  `command: ["sh","-c","i=0; while [ ! -f /work/.ready ]; do i=$((i+1)); [ $i -gt 300 ] && { echo '::error::input files never arrived'; exit 1; }; sleep 1; done; exec \"$@\"","--", <cli argv…>]`
- **Resources:** request `768Mi` / limit `3Gi`, cpu request `100m` / limit `1`. Scheduling keys on
  *requests* (serving pod requests only `512Mi` on the `s-2vcpu-4gb` node), so `768Mi` places; the
  streaming loader (`_BATCH_SIZE = 1000`, `boundary_cli.py:42`) keeps real usage modest and the `3Gi`
  limit absorbs US-boundary / large-PBF bursts. On a 4 GB node the `3Gi` limit is a burst ceiling to
  watch, but it is now isolated from the API.

### C. Workflow changes

Both workflows keep every step up to and including fetch/validate/prepare **unchanged**. Only the
final "Run … in backend pod" step is replaced by a call to `run-loader-job`:

- **`osm-boundary-load.yml`** → `job_name: boundary-load`, one file
  (`$OUT → /work/boundary.geojsonl`), argv `python -m app.imports.boundary_cli --path
  /work/boundary.geojsonl --overture-release-id "$RELEASE_ID" --scope-id "$SCOPE_ID" [$DRY]`.
- **`osm-import-pbf.yml`** → `job_name: osm-pbf-import`, two files
  (`import.geojson → /work/osm-import.geojson`, `scope.wkt → /work/osm-scope.wkt`), argv `python -m
  app.imports.cli --path /work/osm-import.geojson --scope-id … --dataset … --build-id … --label … 
  --scope-bounds-wkt-file /work/osm-scope.wkt --require-scope-bounds [$DRY]`.

The `doctl` auth + `kubectl` config steps stay; the action assumes a configured kubeconfig +
`$NAMESPACE`.

### D. Belt-and-suspenders — bounded loader DB session

Because the root-cause investigation found the server-side timeouts effectively disabled, set a
bounded `statement_timeout` (and a short `idle_in_transaction_session_timeout`) **on the loader's DB
session only** (via the loader's engine/connect options or a `SET LOCAL` at the start of the load
transaction), so that even a wedged-but-undeleted refresh cannot hold `ADD_FOUNTAIN_LOCK`
indefinitely. This is scoped to the loader path and does not touch the serving pod's sessions.

## Why this resolves each symptom

| Symptom | Mechanism of the fix |
|---|---|
| Shared-pod OOM (`exit 137`) | Loader runs in its own pod with its own memory; the API pod is never in the blast radius. |
| Orphaned lock-holder → 60-min stalls | Cancel/runner-death → trap `kubectl delete job` → pod SIGKILL → DB connection drops → Postgres rolls back the txn → advisory lock released at once. No process survives to orphan it. `activeDeadlineSeconds` is the backstop; the bounded session timeout (§D) is defense-in-depth. |
| No progress / re-loads pile up | With loads no longer blocking each other, a serial fan-out advances at ~15 min/country. |

## Testing

- **Static:** render the manifest and `kubectl create --dry-run=server` / kubeconform it; `actionlint`
  (via WSL on this host) on the action + both workflows.
- **Handoff end-to-end:** a **dry-run boundary Job** in prod (`dry_run=true` → no writes) proving
  create → wait-Running → stream file → `.ready` → CLI runs → logs tail → exit propagates.
- **Cancellation/lock-release:** start a real Job, cancel the run, assert the Job pod is gone and no
  `ADD_FOUNTAIN_LOCK` advisory lock lingers (`pg_locks`/`pg_stat_activity` query).
- **Regression:** a real AT/AU load completing in ~15 min with **no** 60-min gap (compare the
  loader-start → first-membership-log delta to the ~3,606 s baseline).

## Non-goals

- No change to the fetch/validate/prepare steps, the loader/membership SQL, the URL/indexing
  contract, or the pinned DuckDB/osmium/Overture/Geofabrik versions.
- Not making the loader self-fetch; not enabling DO Spaces.
- Not re-sizing the DOKS nodes (the Job fits current node requests); revisit only if large-PBF Jobs
  fail to schedule.

## Process

Branch → PR → **CI green + Codex `VERDICT: APPROVED` + every PR comment addressed** → squash-merge
(`claude_help/codex-review-process.md`). This spec gets a Codex spec review before the implementation
plan. Deploy is a manual dispatch; the Job manifest is on-demand (not part of `deploy.yml`), so no
standing deploy change is required to land the pattern — but the workflows must be on `main` to be
dispatchable.
