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
client dies but the **loader process keeps running inside the serving pod**, still holding its open
transaction and the `ADD_FOUNTAIN_LOCK` advisory lock while it finishes its ~14-min refresh. During
the runaway, several such orphans stacked up on the one advisory lock, so the next real load waited
~1 hour for them to drain. The orphans also accumulate memory in the shared pod → the OOM failures.
The PBF importer shares the exact exposure: `backend/app/imports/merge.py` takes the same
`ADD_FOUNTAIN_LOCK` (`merge.py:89`, `434`) around `refresh_all_memberships` (`merge.py:152`, `521`).

Evidence: no DB timeout can produce a ~3,600 s cutoff (`statement_timeout`, `lock_timeout`,
`idle_session_timeout` = `0`; `idle_in_transaction_session_timeout` = 24 h), so the gap was a
lock-wait that cleared when a holder finished; a clean subsequent load of a **larger** country (AU,
14,569 features), dispatched after the runaway stopped, had only a **~3-min** upsert→refresh gap
instead of 60; and a live orphan-capable process (`python -m app.imports.boundary_cli --scope-id
overture:au`) was observed running in the pod. All three symptoms trace to the one cause.

## Goal

Run each operator load in its **own isolated Kubernetes Job**, so that:

- The loader never shares memory with the API (kills the OOM-in-serving-pod failure mode).
- Cancelling a run (or the runner dying) **tears the loader down and releases the advisory lock**
  within a bounded interval — no process can survive to orphan the lock.
- A serial fan-out completes each country in its true ~15-min time with no 60-min stalls.

Scope (per owner decision): **generalize to a reusable "run a backend CLI as an isolated Job"
pattern and convert the operator loader workflows.** The owner asked for boundary + PBF; the review
surfaced that `osm-import.yml` (the Overpass importer) `kubectl exec`s a loader into the serving pod
**and** takes the same `ADD_FOUNTAIN_LOCK` (`osm-import.yml:157` → `merge.py` full refresh), so leaving
it on the old pattern would keep a third orphan door open on the shared lock. The reusable action makes
its conversion trivial, so this spec converts **all three** lock-taking loader workflows
(`osm-boundary-load.yml`, `osm-import-pbf.yml`, `osm-import.yml`) — the design and tests assume all
three are in scope.

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

Inputs (all strings; structured inputs are **JSON** so nothing is shell-split):

| Input | Meaning |
|---|---|
| `job_name` | Deterministic Job/metadata name, e.g. `boundary-load`, `osm-pbf-import`. |
| `argv_json` | JSON **array of strings** — the exact CLI argv, e.g. `["python","-m","app.imports.boundary_cli","--path","/work/boundary.geojsonl", …]`. |
| `files_json` | JSON array of `{ "local": "<runner path>", "container": "/work/<name>" }`; every `container` MUST match `^/work/[A-Za-z0-9._-]+$` (allow-listed — no traversal, no arbitrary dest). |
| `active_deadline_seconds` | Per-call hard ceiling for the whole Job (see §B). |
| `ready_timeout_seconds` | Per-call upper bound the Job entrypoint waits for the streamed inputs (`.ready`), sized for worst-case upload time (see §B). |
| `mem_request` / `mem_limit` | Per-call resource sizing (defaults in §B). |

**Why JSON, not a shell string (addresses the argv-injection finding):** the manifest `command` is
rendered as an **exec-form array** (`jq` maps `argv_json` element-for-element into the JSON list),
so a value like the PBF `label` (`osm-import-pbf.yml:25`, user-supplied, may contain spaces/metachars)
is a single argv element and is **never** word-split or shell-evaluated. Untrusted data is never
concatenated into a shell string; the wrapper's `exec "$@"` runs the properly-quoted arg vector, so
there is no `eval` and no interpolation surface.

The action steps:

1. **Verify context, then discover the deployed image.** `kubectl config current-context` (assert the
   production cluster before any cluster op), then
   `kubectl -n "$NAMESPACE" get deployment fountainrank-backend -o jsonpath='{.spec.template.spec.containers[?(@.name=="backend")].image}'`
   — the Job runs the **exact code currently in production**, never a drifting `latest`, and the
   container is selected **by name** (`backend`) so a future sidecar can't shift `containers[0]`.
2. **Pre-flight cleanup.** `kubectl delete job "$job_name" --ignore-not-found --wait` (the unified
   concurrency group in §C.1 serializes all lock-taking workflows; this clears a stale Job from an
   abnormally-terminated prior run).
3. **Render + create the Job.** Two-stage, chosen so the untrusted argv and the wrapper's shell
   syntax are never mangled:
   - Build the exec-form `command` **array as a JSON value with `jq`** — the `sh -c` wrapper string
     (containing literal `$i`/`$@`) passed via `--arg` and the argv appended via `--argjson argv …`.
     `jq` guarantees correct JSON quoting/escaping for arbitrary strings (spaces, quotes, `$`, shell
     metacharacters), so a value like the PBF `--label` cannot break out. Emit it as
     `${COMMAND_JSON}` (a flow-style JSON array, which is valid YAML).
   - Substitute the remaining **scalar** placeholders with an **allow-listed** `envsubst` —
     `envsubst '${NAMESPACE} ${JOB_NAME} ${IMAGE} ${MEM_REQUEST} ${MEM_LIMIT} ${ACTIVE_DEADLINE} ${READY_TIMEOUT} ${COMMAND_JSON}'`. Naming the vars explicitly is load-bearing: a bare `envsubst`
     would eat the wrapper's `$i`/`$@`; restricting it to this list leaves all shell variables literal.
   Then `kubectl create -f -`. (This intentionally departs from the repo's plain-`envsubst` manifest
   convention for this one template because it carries operator-supplied argv; `kubeconform` still
   validates the rendered output.)
4. **Wait for the Job's pod to be Running, failing fast on un-runnable states.** Select the pod by the
   stable Job label —
   `kubectl -n "$NAMESPACE" get pod -l batch.kubernetes.io/job-name="$job_name"` — assert **exactly
   one**, then `kubectl wait --for=jsonpath='{.status.phase}'=Running pod -l … --timeout=180s` (the
   same idiom `deploy.yml` already uses for the backend pod). If the wait times out, inspect the pod
   for `ImagePullBackOff`/`ErrImagePull`, `Unschedulable`, or a pre-`.ready` `CrashLoopBackOff` and
   `::error::` with the specific cause (don't hang).
5. **Stream inputs, then arm the loader.** For each `files_json` entry
   `kubectl exec -i "$pod" -- sh -c 'cat > "$1"' -- "<container>"` (target is the allow-listed path),
   verify non-empty (`kubectl exec "$pod" -- test -s "<container>"`), then finally
   `kubectl exec "$pod" -- touch /work/.ready`. The entrypoint (§B) blocks until `.ready`.
6. **Tail logs + wait for a real terminal state — deterministic structure.** There is no single
   `kubectl wait` for "complete OR failed", so the poll loop is the **authority** and the log tail is
   subordinate: (a) once the pod exists, start `kubectl logs -f job/"$job_name"` **in the background**
   for operator visibility; (b) run a foreground **poll loop** that watches the Job's
   `.status.conditions[]` for `Complete=True` **or** `Failed=True`, treating `DeadlineExceeded` and
   pod `OOMKilled` as failure with a **distinct** message; (c) when the poll resolves, kill/`wait` the
   background log process so the step never blocks in `logs -f`; (d) on failure, dump
   `kubectl describe job/"$job_name"` + the failed pod + recent logs for diagnosis. Return the loader's
   real result: success ⇒ step passes; any failure ⇒ non-zero.
7. **Guaranteed cleanup** — see *Termination & cleanup* below.

### B. Job manifest — `infra/k8s/loader-job.yaml` (rendered per-run; NOT applied by `deploy.yml`)

A `batch/v1` **Job** (not CronJob) copying the security/DB wiring of
`infra/k8s/account-deletion-cleanup.yaml`:

- **Image:** the discovered backend image (§A.1). **`imagePullSecrets: [{ name: regcred }]`** — the
  backend image lives in the private DO registry; both the CronJob (`account-deletion-cleanup.yaml:48`)
  and the Deployment (`backend.yaml:41`) pull with `regcred`, so without it the Job `ImagePullBackOff`s
  and never starts.
- **Env:** minimal — `DATABASE_URL` (secretKeyRef) + `DB_SSL_ROOT_CERT` with the `database-ca.crt`
  volume. The loaders talk to Postgres only; no Logto/Spaces/email env.
- **Volumes:** the CA secret (read-only) + a writable `emptyDir` at `/work` for the streamed files
  (root fs stays read-only).
- **Pod `securityContext`:** `runAsNonRoot`, `runAsUser/Group 1000`, **`fsGroup: 1000`**, seccomp
  `RuntimeDefault`; container `securityContext`: `readOnlyRootFilesystem: true`,
  `allowPrivilegeEscalation: false`, drop ALL caps — matching the cleanup CronJob so the manifest
  passes the security scanners. **`fsGroup: 1000` is load-bearing:** the `/work` `emptyDir` must be
  group-writable by uid 1000 or the `kubectl exec … cat > /work/…` stream (which runs as the
  container's non-root user) fails before `.ready` (`account-deletion-cleanup.yaml:41-47` sets the
  same `fsGroup`). A test MUST assert the non-root container can create each streamed file **and**
  `/work/.ready`.
- **`restartPolicy: Never`, `backoffLimit: 0`** — a failed load fails the Job; no silent retry and no
  re-entering the wait loop.
- **`activeDeadlineSeconds`** — per-workflow, operator-overridable, and set **generously above the
  largest legitimate load** so it only ever fires on a truly-abandoned Job (not as a load SLA):
  boundary default **`5400`** (90 min; observed worst case is a ~15-min scoped refresh with wide
  margin), PBF default **`21600`** (6 h; the PBF path allows up to a 6 GB pre-filter extract,
  `osm-import-pbf.yml:44`, and a full `refresh_all_memberships`, `merge.py:152/521`). The terminal-wait
  loop reports a deadline kill as `::error::job exceeded activeDeadlineSeconds (Nn) — raise the input
  or investigate`, **distinct** from a loader crash.
- **`ttlSecondsAfterFinished: 600`** — auto-clean finished Jobs.
- **`terminationGracePeriodSeconds: 30`** — on delete, Kubernetes SIGTERMs the container and SIGKILLs
  after the grace period. Python's default SIGTERM handling terminates the process, closing the asyncpg
  connection, so Postgres rolls back the open transaction and releases `ADD_FOUNTAIN_LOCK` promptly;
  30 s is the hard backstop if it doesn't exit cleanly.
- **Entrypoint** — the manifest `command` is an exec-form array (built by `jq`, §A.3): a tiny `sh`
  wait-for-ready wrapper as the first elements, then the `argv_json` elements appended verbatim (no
  image change, no shell interpolation of untrusted data). Shape:
  `["sh","-c","i=0; while [ ! -f /work/.ready ]; do i=$((i+1)); [ \"$i\" -gt ${READY_TIMEOUT} ] && { echo '::error::input files never arrived'; exit 1; }; sleep 1; done; exec \"$@\"","loader", <argv…>]`
  (`$0`=`loader`, `$@`=argv). `$i`/`$@` are literal because the allow-listed `envsubst` (§A.3) does not
  substitute them; only `${READY_TIMEOUT}` is. **`ready_timeout_seconds` is a per-call input, sized for
  worst-case upload** (default boundary `600`, PBF `1800` — the PBF `import.geojson` can be large and
  streams over `kubectl exec -i`, so a fixed 5-min wait could kill a legitimate slow upload). It bounds
  a runner that dies mid-stream; `activeDeadlineSeconds` is the outer backstop, and during this wait the
  loader has **not** run, so **no** `ADD_FOUNTAIN_LOCK` is held.
- **Resources:** default request `768Mi` / limit `3Gi`, cpu request `100m` / limit `1`, both
  overridable per call. Scheduling keys on *requests* (serving pod requests only `512Mi` on the
  `s-2vcpu-4gb` node), so `768Mi` places; the streaming loader (`_BATCH_SIZE = 1000`,
  `boundary_cli.py:42`) keeps real usage modest. See *Resources & node pressure* for the limit caveat.

### C. Workflow changes

All three workflows keep every step up to and including fetch/validate/prepare **unchanged**. Only the
final "Run … in backend pod" step is replaced by a call to `run-loader-job`, plus a **top-level
`if: always()` cleanup step** (see *Termination & cleanup*):

- **`osm-boundary-load.yml`** → `job_name: boundary-load`, `files_json:
  [{local:$OUT, container:/work/boundary.geojsonl}]`, `argv_json: ["python","-m",
  "app.imports.boundary_cli","--path","/work/boundary.geojsonl","--overture-release-id",<rel>,
  "--scope-id",<scope>, …dry]`, `active_deadline_seconds: 5400`.
- **`osm-import-pbf.yml`** → `job_name: osm-pbf-import`, two files
  (`import.geojson→/work/osm-import.geojson`, `scope.wkt→/work/osm-scope.wkt`), the equivalent
  `python -m app.imports.cli …` argv (including `--label` as one JSON element),
  `active_deadline_seconds: 21600`.
- **`osm-import.yml`** (Overpass) → `job_name: osm-import`, **two files** exactly as today
  (`import.geojson→/work/osm-import.geojson`, `scope.wkt→/work/osm-scope.wkt`;
  `osm-import.yml:147-149`) and the same argv including **`--scope-bounds-wkt-file /work/osm-scope.wkt
  --require-scope-bounds`** (`osm-import.yml:156-159`) — dropping either would fail every non-dry import
  or weaken the fail-closed removal guard the CLI enforces (`cli.py --require-scope-bounds`). Its refresh
  is a **full** `refresh_all_memberships` (`merge.py:521`), so `active_deadline_seconds: 10800`.

The `doctl` auth + kubeconfig steps stay; the action assumes a configured kubeconfig + `$NAMESPACE`.

### C.1. Serialize every `ADD_FOUNTAIN_LOCK` workflow under one concurrency group

Isolating the loader into a Job removes the *orphan*, but not cross-workflow **lock** contention.
Three operator workflows all take `ADD_FOUNTAIN_LOCK` during their membership refresh — boundary load
(`membership.py:1172`), PBF import and Overpass import (both via `merge.py:89/434` →
`refresh_all_memberships`) — yet today they sit in **two** groups: `boundary-load-production`
(`osm-boundary-load.yml:31`) and `osm-import-production` (shared by `osm-import-pbf.yml:35` and
`osm-import.yml:32`). An operator can therefore start a boundary Job and an import Job at once; one
Job would then sit in `pg_advisory_xact_lock` for the other's whole refresh, burning its
`activeDeadlineSeconds` and reproducing the *stalled-load* symptom (minus the orphan).

Fix: put **all three** workflows in a single shared group **with `queue: max`**:
`concurrency: { group: db-membership-write-production, cancel-in-progress: false, queue: max }`. GitHub
Actions concurrency defaults to `queue: single` — **one** pending run, and a newer dispatch **cancels**
the older pending one (verified against GitHub's concurrency docs). That default IS the cancelled-runs
symptom from the Problem section: a fan-out that dispatches many countries at once leaves one running,
one pending, and cancels the rest. `queue: max` (up to 100 pending, FIFO) makes bulk dispatch **queue
serially** instead of cancelling — so the fan-out can dispatch every country up front and they run
one-at-a-time in order. This supersedes the old "boundaries and fountain imports use different tables,
so separate groups" reasoning — that overlooked the **shared advisory lock** taken by the membership
refresh, which is the real serialization point. (Additionally, the loader CLI should log a line
immediately before and after acquiring `ADD_FOUNTAIN_LOCK` so any residual lock wait is visible in
logs — a small, logging-standard-aligned loader addition, not an action-level capability.)

### D. Considered and rejected — a loader-session `statement_timeout`

An earlier draft proposed a bounded `statement_timeout` on the loader session as belt-and-suspenders.
**Removed.** In PostgreSQL `statement_timeout` also runs **while a statement waits on
`pg_advisory_xact_lock`**, so a legitimately-serialized run behind another active loader would abort;
it would also kill the known-long membership statements (`refresh_all_memberships` /
`refresh_country_memberships`, `membership.py:1162-1311`). The Job model already covers the wedged/
abandoned case: deleting the Job (on cancel) or `activeDeadlineSeconds` (on abandonment) drops the
connection and releases the lock. Adding a statement timeout would trade the fixed failure mode for a
new one on the exact large loads this is meant to support.

### Termination & cleanup (guaranteeing the lock is released)

The orphan fix rests on the Job being torn down whenever the run ends abnormally. Composite actions
cannot register a `post:` hook, so cleanup is layered:

1. **Primary:** a **top-level workflow step with `if: always()`** — `kubectl delete job "$job_name"
   --wait --ignore-not-found` — runs on success, failure, **and cancellation** (GitHub runs
   `always()` steps when a job is cancelled). Deleting the Job deletes the pod → SIGTERM/SIGKILL →
   asyncpg connection drops → Postgres releases `ADD_FOUNTAIN_LOCK`.
2. **Backstop A:** `activeDeadlineSeconds` self-terminates a Job whose run was hard-killed before the
   cleanup step could run.
3. **Backstop B:** `ttlSecondsAfterFinished` + the pre-flight delete (§A.2) ensure no stale Job
   lingers into the next dispatch.

## Resources & node pressure

Scheduling is by *requests*, but a `3Gi` limit on a `4Gi` node is a burst ceiling: if a large-PBF Job
approaches it while the API, web, Logto, and basemap pods are active, the node can hit `MemoryPressure`.
Requirement: the operator workflow surfaces pod `OOMKilled` and node `MemoryPressure`/eviction events
after a load, and the runbook documents the response — raise `mem_request`, lower `mem_limit`, or make
a separate node-pool/size decision — rather than silently re-OOMing. (Node resize is `ForceNew` on
DOKS; out of scope here, see `fountainrank-doks-cluster-undersized-nodes` history.)

## Why this resolves each symptom

| Symptom | Mechanism of the fix |
|---|---|
| Shared-pod OOM (`exit 137`) | Loader runs in its own pod with its own memory; the API pod is never in the blast radius. |
| Orphaned lock-holder → 60-min stalls | Cancel/failure → `if: always()` `kubectl delete job` → pod SIGTERM/SIGKILL (≤ grace period) → asyncpg connection drops → Postgres rolls back the txn → `ADD_FOUNTAIN_LOCK` released. No process survives to orphan it; `activeDeadlineSeconds` is the abandoned-Job backstop. |
| Cancelled-run churn on bulk dispatch | `queue: max` on the shared group (§C.1) queues dispatched runs FIFO instead of the default `queue: single` behavior that cancels the older pending run — the fan-out can enqueue every country at once without cancellations. |
| No progress / re-loads pile up | With the loader isolated **and** all lock-taking workflows serialized under one queued concurrency group (§C.1), no Job ever blocks on the lock; a serial fan-out advances at ~15 min/country. |

## Testing

- **Static (local/PR, cluster-independent):** render the manifest (jq command build + allow-listed
  `envsubst`, §A.3) and `kubeconform` it (per `claude_help/kubernetes-infra.md`); `actionlint` (via WSL
  on this host) on the composite action + all three workflows. **Deploy-guard test:** assert
  `loader-job` appears in **no** apply list in `.github/workflows/deploy.yml` (today those are explicit
  `for f in …` lists at `deploy.yml:253` and `:286` plus the `write-attempt-cleanup` line — a future
  `infra/k8s/*.yaml` glob must not sweep the on-demand Job in).
- **Render-safety (argv injection):** unit-test the jq command build with adversarial values — a
  `--label` containing spaces, single/double quotes, `$(…)`, backticks, `;`, and `${NAMESPACE}`-shaped
  text — asserting each lands as exactly one argv element in the rendered JSON and that the wrapper's
  `$i`/`$@` survive the allow-listed `envsubst` verbatim. Also assert `files_json` container paths
  outside `^/work/[A-Za-z0-9._-]+$` are rejected.
- **Cross-workflow serialization:** assert all three lock-taking workflows share the one concurrency
  group (§C.1) so a boundary Job and an import Job cannot run concurrently.
- **Authenticated smoke (in the operator workflow only, after `kubectl config current-context`):**
  optional `kubectl create --dry-run=server` of the rendered manifest.
- **Handoff end-to-end:** a **dry-run boundary Job** proving create → wait-Running → stream file(s) →
  `.ready` → CLI runs → logs tail → exit propagates, **plus** an assertion the non-root container
  created `/work/<file>` and `/work/.ready` (the `fsGroup` check).
- **Cancellation / lock-release (must hold the lock — dry-run does NOT):** dry-run skips the membership
  refresh (`boundary_cli.py:129-137`), so it never takes `ADD_FOUNTAIN_LOCK`. Use a **non-dry re-load
  of an already-indexed micro-state** (e.g. Monaco/Andorra — tiny, idempotent, partial committed
  batches are safe to re-run per `boundary_cli.py:126`), cancel the run mid-refresh, and assert within
  a bounded interval that the Job **and** its pod are gone and the advisory lock has disappeared
  (`pg_locks`/`pg_stat_activity` — the query used in the root-cause investigation).
- **Regression:** a real AT/AU load completing in ~15 min with **no** 60-min gap (compare the
  loader-start → first-membership-log delta to the ~3,606 s baseline).

## Non-goals

- No change to the fetch/validate/prepare steps, the loader/membership SQL, the URL/indexing
  contract, or the pinned DuckDB/osmium/Overture/Geofabrik versions.
- Not making the loader self-fetch; not enabling DO Spaces; not adding a loader-session
  `statement_timeout` (§D).
- Not re-sizing the DOKS nodes (the Job fits current node requests); revisit only if large-PBF Jobs
  fail to schedule or pressure the node.

## Process

Branch → PR → **CI green + Codex `VERDICT: APPROVED` + every PR comment addressed** → squash-merge
(`claude_help/codex-review-process.md`). This spec gets a Codex spec review before the implementation
plan. Deploy is a manual dispatch; the Job manifest is on-demand (not part of `deploy.yml`), so no
standing deploy change is required to land the pattern — but the workflows must be on `main` to be
dispatchable.
