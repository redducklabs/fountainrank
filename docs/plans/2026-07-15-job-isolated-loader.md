# Job-isolated CLI loader (boundary + PBF + Overpass) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move each operator data-load CLI out of the shared serving pod into its own isolated Kubernetes Job, so a cancelled run tears the loader down (releasing `ADD_FOUNTAIN_LOCK`) and can never OOM the API — fixing the boundary fan-out's stalls, OOMs, and no-progress.

**Architecture:** A reusable composite action (`.github/actions/run-loader-job/`) renders a `batch/v1` Job with a stdlib-Python renderer (`backend/app/imports/loader_job_render.py`, emitting JSON via `json.dumps`), creates it, streams the prepared input file(s) in via `kubectl exec`, arms a wait-for-ready entrypoint, then tails logs and polls for the Job's terminal state. The three lock-taking workflows (`osm-boundary-load.yml`, `osm-import-pbf.yml`, `osm-import.yml`) keep every fetch/prepare step and only swap their in-pod `kubectl exec` for a call to the action, share ONE concurrency group with `queue: max`, and add an `if: always()` cleanup step. A small loader-side log line brackets the advisory-lock acquisition.

**Tech Stack:** Python 3.13 (stdlib only for the renderer), FastAPI/SQLAlchemy 2 async backend, GitHub Actions composite action (bash + kubectl), Kubernetes `batch/v1` Job on DOKS, `pytest`, `actionlint`, `kubeconform`.

## Global Constraints

- Spec: `docs/specs/2026-07-15-job-isolated-loader-design.md` — every task implicitly includes its requirements.
- Windows host for file tools (backslash paths); Bash tool is Git Bash. Backend verifies via an **isolated** `UV_PROJECT_ENVIRONMENT` — never delete Codex's `.venv`/`node_modules` (`claude_help/local-dev.md`).
- No AI attribution in commits/PRs; no time estimates anywhere.
- Conventional Commits, frequent commits, one task at a time. Branch `fix/job-isolated-loader` (already created).
- Backend local check mirror: `uv run ruff check .` + `uv run ruff format --check .` + `uv run alembic check` + `uv run pytest` (in `backend/`, isolated env).
- The Job renderer is **stdlib-only** (system `python3` runs it on the runner; no third-party imports).
- Loader Job resource/timeout defaults (spec §B/§C): boundary `active_deadline_seconds=5400`, `ready_timeout_seconds=600`; PBF `21600`/`1800`; Overpass `10800`/`900`. Memory default request `768Mi`, limit `3Gi`; cpu `100m`/`1`. `ttlSecondsAfterFinished=600`, `terminationGracePeriodSeconds=30`, `restartPolicy: Never`, `backoffLimit: 0`, `imagePullSecrets: regcred`, pod `fsGroup: 1000`.
- Shared concurrency group for all three workflows: `{ group: db-membership-write-production, cancel-in-progress: false, queue: max }`.
- Container-path allow-list for streamed files: `^/work/[A-Za-z0-9._-]+$`.

---

### Task 1: Job-manifest renderer (`loader_job_render.py`)

**Files:**
- Create: `backend/app/imports/loader_job_render.py`
- Test: `backend/tests/test_loader_job_render.py`

**Interfaces:**
- Produces: `render_job(*, job_name: str, image: str, namespace: str, argv: list[str], files: list[dict], mem_request: str, mem_limit: str, cpu_request: str, cpu_limit: str, active_deadline_seconds: int, ready_timeout_seconds: int, ttl_seconds: int = 600, grace_seconds: int = 30) -> dict` and a `main(argv=None) -> int` CLI printing `json.dumps(manifest)` to stdout. Raises `ValueError` on empty/non-str argv or a container path failing `^/work/[A-Za-z0-9._-]+$`.

- [ ] **Step 1: Write the failing test**

```python
# backend/tests/test_loader_job_render.py
import json
import subprocess
import sys

import pytest

from app.imports.loader_job_render import render_job

BASE = dict(
    job_name="boundary-load",
    image="registry.example/fountainrank-backend:abc123",
    namespace="fountainrank",
    files=[{"local": "/tmp/x.geojsonl", "container": "/work/boundary.geojsonl"}],
    mem_request="768Mi", mem_limit="3Gi", cpu_request="100m", cpu_limit="1",
    active_deadline_seconds=5400, ready_timeout_seconds=600,
)


def _container(m):
    return m["spec"]["template"]["spec"]["containers"][0]


def test_hostile_argv_stays_one_element_each():
    argv = ["python", "-m", "app.imports.cli", "--label",
            'A "b" $(rm -rf /) `id` ; drop ${NAMESPACE}\nx']
    m = render_job(argv=argv, **BASE)
    cmd = _container(m)["command"]
    # sh -c <wrapper> loader <argv...>
    assert cmd[0] == "sh" and cmd[1] == "-c" and cmd[3] == "loader"
    assert cmd[4:] == argv                      # every argv element preserved, one-for-one
    assert cmd[4:][4] == argv[4]                # the hostile --label value is a single element
    # round-trips through JSON unchanged (json.dumps is the real encoder used by main())
    assert json.loads(json.dumps(m)) == m


def test_ready_timeout_interpolated_and_shell_vars_literal():
    m = render_job(argv=["python", "-m", "x"], **{**BASE, "ready_timeout_seconds": 1800})
    wrapper = _container(m)["command"][2]
    assert "-gt 1800 " in wrapper
    assert '"$i"' in wrapper and 'exec "$@"' in wrapper   # shell vars are literal text


def test_security_and_backstop_fields():
    m = render_job(argv=["python"], **BASE)
    spec = m["spec"]
    pod = spec["template"]["spec"]
    assert spec["backoffLimit"] == 0
    assert spec["activeDeadlineSeconds"] == 5400
    assert spec["ttlSecondsAfterFinished"] == 600
    assert pod["restartPolicy"] == "Never"
    assert pod["terminationGracePeriodSeconds"] == 30
    assert pod["imagePullSecrets"] == [{"name": "regcred"}]
    assert pod["securityContext"]["fsGroup"] == 1000
    assert pod["securityContext"]["runAsNonRoot"] is True
    c = _container(m)
    assert c["securityContext"]["readOnlyRootFilesystem"] is True
    assert c["securityContext"]["capabilities"]["drop"] == ["ALL"]
    assert c["resources"]["requests"]["memory"] == "768Mi"
    assert c["resources"]["limits"]["memory"] == "3Gi"
    envs = {e["name"]: e for e in c["env"]}
    assert envs["DATABASE_URL"]["valueFrom"]["secretKeyRef"]["key"] == "database-url"
    assert envs["DB_SSL_ROOT_CERT"]["value"].endswith("/database-ca.crt")


@pytest.mark.parametrize("bad", ["/etc/passwd", "/work/../etc", "/work/sub/x", "work/x", "/work/"])
def test_rejects_disallowed_container_paths(bad):
    with pytest.raises(ValueError):
        render_job(argv=["python"], **{**BASE, "files": [{"local": "/t", "container": bad}]})


def test_rejects_empty_argv():
    with pytest.raises(ValueError):
        render_job(argv=[], **BASE)


def test_cli_main_emits_valid_json():
    out = subprocess.check_output(
        [sys.executable, "-m", "app.imports.loader_job_render",
         "--job-name", "boundary-load", "--image", "img:1", "--namespace", "fountainrank",
         "--argv-json", json.dumps(["python", "-m", "app.imports.boundary_cli"]),
         "--files-json", json.dumps([{"local": "/t", "container": "/work/b.geojsonl"}]),
         "--active-deadline-seconds", "5400", "--ready-timeout-seconds", "600"],
    )
    m = json.loads(out)
    assert m["kind"] == "Job" and m["metadata"]["name"] == "boundary-load"
```

- [ ] **Step 2: Run test to verify it fails**

Run (in `backend/`, isolated env): `uv run pytest tests/test_loader_job_render.py -q`
Expected: FAIL — `ModuleNotFoundError: No module named 'app.imports.loader_job_render'`.

- [ ] **Step 3: Write minimal implementation**

```python
# backend/app/imports/loader_job_render.py
"""Render the isolated operator-loader Job manifest as JSON (spec 2026-07-15 §B).

Stdlib-only, like the sibling CI-helper scripts (boundaries_registry.py, regions.py,
poly_to_wkt.py) the loader workflows already invoke with system python3. `json.dumps`
guarantees every argv element — including an operator-supplied PBF `--label` with
spaces/quotes/`$`/metacharacters — is one exec-form `command` element that cannot break
out. No envsubst, so the wait-for-ready wrapper's literal `$i`/`$@` cannot be corrupted.
"""

from __future__ import annotations

import argparse
import json
import re
import sys

_CONTAINER_PATH_RE = re.compile(r"^/work/[A-Za-z0-9._-]+$")

# Wait until the runner streams every input file and touches /work/.ready, bounded by
# ready_timeout_seconds, then exec the real argv. `$i`/`$@` are literal shell text.
_WRAPPER = (
    'i=0; while [ ! -f /work/.ready ]; do i=$((i+1)); '
    '[ "$i" -gt __RT__ ] && { echo "::error::input files never arrived"; exit 1; }; '
    'sleep 1; done; exec "$@"'
)


def render_job(
    *,
    job_name: str,
    image: str,
    namespace: str,
    argv: list[str],
    files: list[dict],
    mem_request: str,
    mem_limit: str,
    cpu_request: str,
    cpu_limit: str,
    active_deadline_seconds: int,
    ready_timeout_seconds: int,
    ttl_seconds: int = 600,
    grace_seconds: int = 30,
) -> dict:
    if not argv or not all(isinstance(a, str) for a in argv):
        raise ValueError("argv must be a non-empty list of strings")
    for f in files:
        cp = f.get("container", "")
        if not _CONTAINER_PATH_RE.match(cp):
            raise ValueError(f"container path not allowed (must match /work/<name>): {cp!r}")
    wrapper = _WRAPPER.replace("__RT__", str(int(ready_timeout_seconds)))
    command = ["sh", "-c", wrapper, "loader", *argv]
    labels = {"app": job_name, "component": "loader"}
    return {
        "apiVersion": "batch/v1",
        "kind": "Job",
        "metadata": {"name": job_name, "namespace": namespace, "labels": labels},
        "spec": {
            "backoffLimit": 0,
            "activeDeadlineSeconds": int(active_deadline_seconds),
            "ttlSecondsAfterFinished": int(ttl_seconds),
            "template": {
                "metadata": {"labels": labels},
                "spec": {
                    "restartPolicy": "Never",
                    "terminationGracePeriodSeconds": int(grace_seconds),
                    "imagePullSecrets": [{"name": "regcred"}],
                    "securityContext": {
                        "runAsNonRoot": True,
                        "runAsUser": 1000,
                        "runAsGroup": 1000,
                        "fsGroup": 1000,
                        "seccompProfile": {"type": "RuntimeDefault"},
                    },
                    "volumes": [
                        {
                            "name": "db-ca",
                            "secret": {
                                "secretName": "fountainrank-secrets",
                                "items": [
                                    {"key": "database-ca.crt", "path": "database-ca.crt"}
                                ],
                            },
                        },
                        {"name": "work", "emptyDir": {}},
                    ],
                    "containers": [
                        {
                            "name": "loader",
                            "image": image,
                            "command": command,
                            "env": [
                                {
                                    "name": "DATABASE_URL",
                                    "valueFrom": {
                                        "secretKeyRef": {
                                            "name": "fountainrank-secrets",
                                            "key": "database-url",
                                        }
                                    },
                                },
                                {
                                    "name": "DB_SSL_ROOT_CERT",
                                    "value": "/var/run/secrets/fountainrank/database-ca.crt",
                                },
                            ],
                            "securityContext": {
                                "allowPrivilegeEscalation": False,
                                "readOnlyRootFilesystem": True,
                                "capabilities": {"drop": ["ALL"]},
                            },
                            "volumeMounts": [
                                {
                                    "name": "db-ca",
                                    "mountPath": "/var/run/secrets/fountainrank",
                                    "readOnly": True,
                                },
                                {"name": "work", "mountPath": "/work"},
                            ],
                            "resources": {
                                "requests": {"memory": mem_request, "cpu": cpu_request},
                                "limits": {"memory": mem_limit, "cpu": cpu_limit},
                            },
                        }
                    ],
                },
            },
        },
    }


def main(argv: list[str] | None = None) -> int:
    p = argparse.ArgumentParser(prog="app.imports.loader_job_render")
    p.add_argument("--job-name", required=True)
    p.add_argument("--image", required=True)
    p.add_argument("--namespace", required=True)
    p.add_argument("--argv-json", required=True)
    p.add_argument("--files-json", required=True)
    p.add_argument("--mem-request", default="768Mi")
    p.add_argument("--mem-limit", default="3Gi")
    p.add_argument("--cpu-request", default="100m")
    p.add_argument("--cpu-limit", default="1")
    p.add_argument("--active-deadline-seconds", type=int, required=True)
    p.add_argument("--ready-timeout-seconds", type=int, required=True)
    a = p.parse_args(argv)
    manifest = render_job(
        job_name=a.job_name,
        image=a.image,
        namespace=a.namespace,
        argv=json.loads(a.argv_json),
        files=json.loads(a.files_json),
        mem_request=a.mem_request,
        mem_limit=a.mem_limit,
        cpu_request=a.cpu_request,
        cpu_limit=a.cpu_limit,
        active_deadline_seconds=a.active_deadline_seconds,
        ready_timeout_seconds=a.ready_timeout_seconds,
    )
    print(json.dumps(manifest))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `uv run pytest tests/test_loader_job_render.py -q` → Expected: PASS (7 tests).
Then `uv run ruff check app/imports/loader_job_render.py tests/test_loader_job_render.py` and `uv run ruff format --check .` → Expected: clean.

- [ ] **Step 5: Commit**

```bash
git add backend/app/imports/loader_job_render.py backend/tests/test_loader_job_render.py
git commit -m "feat(imports): stdlib Job-manifest renderer for the isolated loader"
```

---

### Task 2: Log the advisory-lock acquisition on the loader paths

**Files:**
- Modify: `backend/app/locks.py` (add helper)
- Modify: `backend/app/membership.py:1172`, `backend/app/membership.py:1287`
- Modify: `backend/app/imports/merge.py:89`, `backend/app/imports/merge.py:434`
- Test: `backend/tests/test_locks.py` (add a case)

**Interfaces:**
- Produces: `async def acquire_add_fountain_lock(session: AsyncSession, *, context: str) -> None` in `app.locks` — logs `advisory_lock_wait` then executes `pg_advisory_xact_lock(ADD_FOUNTAIN_LOCK_KEY)` then logs `advisory_lock_acquired` with `waited_ms`.

- [ ] **Step 1: Write the failing test**

Add to `backend/tests/test_locks.py` (mirror the module's existing async DB-session fixture — reuse the same fixture the other tests in this file use):

```python
async def test_acquire_add_fountain_lock_logs_wait_and_acquired(db_session, caplog):
    import logging

    from app.locks import acquire_add_fountain_lock

    with caplog.at_level(logging.INFO, logger="app.locks"):
        await acquire_add_fountain_lock(db_session, context="unit-test")
    msgs = [r.message for r in caplog.records if r.name == "app.locks"]
    assert "advisory_lock_wait" in msgs
    assert "advisory_lock_acquired" in msgs
```

(If this file's existing tests use a differently-named session fixture, use that name instead of `db_session`.)

- [ ] **Step 2: Run test to verify it fails**

Run: `uv run pytest tests/test_locks.py::test_acquire_add_fountain_lock_logs_wait_and_acquired -q`
Expected: FAIL — `ImportError: cannot import name 'acquire_add_fountain_lock'`.

- [ ] **Step 3: Write minimal implementation**

Append to `backend/app/locks.py`:

```python
import logging
import time

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

log = logging.getLogger(__name__)


async def acquire_add_fountain_lock(session: AsyncSession, *, context: str) -> None:
    """Take the transaction-level ``ADD_FOUNTAIN_LOCK``, logging the wait and the
    acquisition (with ``waited_ms``) so a cross-workflow lock wait is diagnosable from
    logs alone (spec 2026-07-15 §C.1). ``pg_advisory_xact_lock`` blocks until granted and
    releases on commit/rollback — so a long ``waited_ms`` means another holder is running."""
    log.info("advisory_lock_wait", extra={"lock": "ADD_FOUNTAIN_LOCK", "context": context})
    started = time.monotonic()
    await session.execute(select(func.pg_advisory_xact_lock(ADD_FOUNTAIN_LOCK_KEY)))
    log.info(
        "advisory_lock_acquired",
        extra={
            "lock": "ADD_FOUNTAIN_LOCK",
            "context": context,
            "waited_ms": round((time.monotonic() - started) * 1000),
        },
    )
```

Then replace each of the four loader-path call sites (leave the request-path sites in `admin.py`/`fountains.py` unchanged — they are fast single-fountain ops, not the stall concern):

- `backend/app/membership.py:1172` (in `refresh_country_memberships`):
  ```python
  await acquire_add_fountain_lock(session, context="refresh_country_memberships")
  ```
- `backend/app/membership.py:1287` (in `refresh_all_memberships`):
  ```python
  await acquire_add_fountain_lock(session, context="refresh_all_memberships")
  ```
- `backend/app/imports/merge.py:89` and `:434`:
  ```python
  await acquire_add_fountain_lock(session, context="osm_import_merge")
  ```

Add `from app.locks import acquire_add_fountain_lock` to `membership.py` and `merge.py` (they already import `ADD_FOUNTAIN_LOCK_KEY`; keep it only if still referenced elsewhere in the file — `ruff check` will flag an unused import). If removing `ADD_FOUNTAIN_LOCK_KEY`/`func`/`select` imports leaves them unused in a file, delete those names from that file's imports; if they are still used, leave them.

- [ ] **Step 4: Run tests to verify they pass**

Run: `uv run pytest tests/test_locks.py tests/test_membership.py tests/test_boundary_cli.py tests/test_boundary_load.py -q` → Expected: PASS (no regressions in the refresh paths).
Then `uv run ruff check .` (catches any now-unused import) and `uv run ruff format --check .` → clean.

- [ ] **Step 5: Commit**

```bash
git add backend/app/locks.py backend/app/membership.py backend/app/imports/merge.py backend/tests/test_locks.py
git commit -m "feat(locks): log ADD_FOUNTAIN_LOCK wait/acquire on the loader paths"
```

---

### Task 3: The `run-loader-job` composite action

**Files:**
- Create: `.github/actions/run-loader-job/action.yml`

**Interfaces:**
- Consumes: `loader_job_render.py` (Task 1) via `python3 backend/app/imports/loader_job_render.py`.
- Produces: a composite action with inputs `job_name`, `argv_json`, `files_json`, `active_deadline_seconds`, `ready_timeout_seconds`, `mem_request` (default `768Mi`), `mem_limit` (default `3Gi`), `namespace` (default `fountainrank`). It leaves the guaranteed teardown to the calling workflow's `if: always()` step (composite actions have no `post:` hook), but also deletes the Job on its own non-cancel failures.

- [ ] **Step 1: Write the action**

```yaml
# .github/actions/run-loader-job/action.yml
name: Run loader Job
description: >-
  Run a backend CLI as an isolated one-shot Kubernetes Job (spec 2026-07-15). Streams the
  prepared input file(s) in via kubectl exec, then tails logs and returns the Job's real
  terminal result. Assumes kubeconfig is already configured (doctl step in the caller).
inputs:
  job_name: { required: true, description: "Deterministic Job name (also the pod label selector)." }
  argv_json: { required: true, description: "JSON array of strings: the exact CLI argv." }
  files_json: { required: true, description: "JSON array of {local, container}; container must match ^/work/[A-Za-z0-9._-]+$." }
  active_deadline_seconds: { required: true, description: "Hard Job ceiling (abandoned-Job backstop)." }
  ready_timeout_seconds: { required: true, description: "Upper bound the entrypoint waits for streamed inputs." }
  mem_request: { required: false, default: "768Mi" }
  mem_limit: { required: false, default: "3Gi" }
  namespace: { required: false, default: "fountainrank" }
runs:
  using: composite
  steps:
    - name: Run isolated loader Job
      shell: bash
      env:
        JOB_NAME: ${{ inputs.job_name }}
        ARGV_JSON: ${{ inputs.argv_json }}
        FILES_JSON: ${{ inputs.files_json }}
        ACTIVE_DEADLINE: ${{ inputs.active_deadline_seconds }}
        READY_TIMEOUT: ${{ inputs.ready_timeout_seconds }}
        MEM_REQUEST: ${{ inputs.mem_request }}
        MEM_LIMIT: ${{ inputs.mem_limit }}
        NS: ${{ inputs.namespace }}
      run: |
        set -euo pipefail

        # 0) Verify we are pointed at the intended cluster before any cluster op.
        echo "kube context: $(kubectl config current-context)"

        # 1) Discover the DEPLOYED backend image so the Job runs the exact prod code.
        IMAGE="$(kubectl -n "$NS" get deployment fountainrank-backend \
          -o jsonpath='{.spec.template.spec.containers[?(@.name=="backend")].image}')"
        [ -n "$IMAGE" ] || { echo "::error::could not discover backend image"; exit 1; }
        echo "loader image: $IMAGE"

        # 2) Pre-flight: clear any stale Job of this name (the concurrency group serializes runs).
        kubectl -n "$NS" delete job "$JOB_NAME" --ignore-not-found --wait --timeout=60s

        # 3) Render the manifest (stdlib python; json.dumps escapes all argv) and create it.
        python3 backend/app/imports/loader_job_render.py \
          --job-name "$JOB_NAME" --image "$IMAGE" --namespace "$NS" \
          --argv-json "$ARGV_JSON" --files-json "$FILES_JSON" \
          --mem-request "$MEM_REQUEST" --mem-limit "$MEM_LIMIT" \
          --active-deadline-seconds "$ACTIVE_DEADLINE" \
          --ready-timeout-seconds "$READY_TIMEOUT" \
          | kubectl -n "$NS" create -f -

        SEL="batch.kubernetes.io/job-name=$JOB_NAME"

        # On ANY failure below, dump diagnostics and delete the Job (the caller's if:always()
        # step is the guaranteed teardown on cancellation; this covers in-step failures).
        cleanup() {
          rc=$?
          if [ "$rc" -ne 0 ]; then
            echo "::group::loader Job diagnostics"
            kubectl -n "$NS" describe job "$JOB_NAME" || true
            kubectl -n "$NS" describe pod -l "$SEL" || true
            kubectl -n "$NS" logs -l "$SEL" --tail=100 || true
            echo "::endgroup::"
            kubectl -n "$NS" delete job "$JOB_NAME" --ignore-not-found --wait --timeout=60s || true
          fi
          return $rc
        }
        trap cleanup EXIT

        # 4) Wait for the pod to be Running, failing fast on un-runnable states.
        if ! kubectl -n "$NS" wait --for=jsonpath='{.status.phase}'=Running \
             pod -l "$SEL" --timeout=180s; then
          echo "::error::loader pod did not reach Running (image pull / unschedulable / crashloop?)"
          exit 1
        fi
        POD="$(kubectl -n "$NS" get pod -l "$SEL" -o jsonpath='{.items[0].metadata.name}')"
        echo "loader pod: $POD"

        # 5) Stream each input file, verify non-empty, then arm the loader.
        echo "$FILES_JSON" | python3 -c 'import json,sys; [print(f["local"]+"\t"+f["container"]) for f in json.load(sys.stdin)]' \
          | while IFS="$(printf "\t")" read -r LOCAL CONTAINER; do
              echo "stream $LOCAL -> $CONTAINER"
              kubectl -n "$NS" exec -i "$POD" -- sh -c 'cat > "$1"' -- "$CONTAINER" < "$LOCAL"
              kubectl -n "$NS" exec "$POD" -- test -s "$CONTAINER" \
                || { echo "::error::streamed file empty in pod: $CONTAINER"; exit 1; }
            done
        kubectl -n "$NS" exec "$POD" -- touch /work/.ready

        # 6) Tail logs in the background (visibility); the poll loop is the authority.
        ( kubectl -n "$NS" logs -f "$POD" 2>&1 || true ) &
        LOGPID=$!
        while true; do
          COMPLETE="$(kubectl -n "$NS" get job "$JOB_NAME" -o jsonpath='{.status.conditions[?(@.type=="Complete")].status}' 2>/dev/null || true)"
          FAILED="$(kubectl -n "$NS" get job "$JOB_NAME" -o jsonpath='{.status.conditions[?(@.type=="Failed")].status}' 2>/dev/null || true)"
          REASON="$(kubectl -n "$NS" get job "$JOB_NAME" -o jsonpath='{.status.conditions[?(@.type=="Failed")].reason}' 2>/dev/null || true)"
          if [ "$COMPLETE" = "True" ]; then kill "$LOGPID" 2>/dev/null || true; wait "$LOGPID" 2>/dev/null || true; echo "loader Job completed"; exit 0; fi
          if [ "$FAILED" = "True" ]; then
            kill "$LOGPID" 2>/dev/null || true; wait "$LOGPID" 2>/dev/null || true
            if [ "$REASON" = "DeadlineExceeded" ]; then
              echo "::error::loader Job hit activeDeadlineSeconds ($ACTIVE_DEADLINE) — raise the input or investigate (NOT a plain crash)"
            else
              echo "::error::loader Job failed (reason=${REASON:-unknown})"
            fi
            exit 1
          fi
          sleep 5
        done
```

- [ ] **Step 2: Lint the action**

Run (WSL, per repo): `wsl.exe -e ./temp/actionlint/actionlint .github/actions/run-loader-job/action.yml`
Expected: no errors. (If actionlint flags composite-action `run:` steps, confirm the version understands them; the committed binary should.)

- [ ] **Step 3: Commit**

```bash
git add .github/actions/run-loader-job/action.yml
git commit -m "feat(ci): reusable run-loader-job composite action (isolated Job)"
```

---

### Task 4: Convert `osm-boundary-load.yml`

**Files:**
- Modify: `.github/workflows/osm-boundary-load.yml` (concurrency block :28-32; the final "Run boundary loader in backend pod" step :157-185)

- [ ] **Step 1: Change the concurrency block**

Replace lines 28-32 with:

```yaml
concurrency:
  # ALL operator workflows that take ADD_FOUNTAIN_LOCK during their membership refresh share
  # this group so they never contend on the lock; queue: max lets a bulk fan-out enqueue every
  # country FIFO instead of the default single-pending behavior that cancels older pending runs.
  group: db-membership-write-production
  cancel-in-progress: false
  queue: max
```

- [ ] **Step 2: Replace the in-pod exec step**

Replace the whole `- name: Run boundary loader in backend pod` step (lines 157-185) with a call to the action plus a guaranteed cleanup step. The `doctl` + `Save kubeconfig` steps immediately above it stay.

```yaml
      - name: Run boundary loader (isolated Job)
        uses: ./.github/actions/run-loader-job
        with:
          job_name: boundary-load
          namespace: ${{ env.NAMESPACE }}
          active_deadline_seconds: "5400"
          ready_timeout_seconds: "600"
          files_json: >-
            [{"local": "${{ env.OUT }}", "container": "/work/boundary.geojsonl"}]
          argv_json: >-
            ${{ github.event.inputs.dry_run == 'true'
              && format('["python","-m","app.imports.boundary_cli","--path","/work/boundary.geojsonl","--overture-release-id","{0}","--scope-id","{1}","--dry-run"]', github.event.inputs.overture_release_id, github.event.inputs.scope_id)
              || format('["python","-m","app.imports.boundary_cli","--path","/work/boundary.geojsonl","--overture-release-id","{0}","--scope-id","{1}"]', github.event.inputs.overture_release_id, github.event.inputs.scope_id) }}

      - name: Delete loader Job (guaranteed teardown)
        if: always()
        run: kubectl -n "$NAMESPACE" delete job boundary-load --ignore-not-found --wait --timeout=60s
```

(Note: `scope_id`/`overture_release_id` are already regex-validated earlier in the workflow to `overture:[a-z]{2}` / `YYYY-MM-DD.N`, so they contain no JSON-breaking characters; the renderer would still escape them safely regardless.)

- [ ] **Step 3: Lint**

Run: `wsl.exe -e ./temp/actionlint/actionlint .github/workflows/osm-boundary-load.yml`
Expected: no errors — in particular confirm `queue: max` is accepted (see Task 7 if not).

- [ ] **Step 4: Commit**

```bash
git add .github/workflows/osm-boundary-load.yml
git commit -m "feat(ci): boundary load runs as an isolated Job; shared lock concurrency group"
```

---

### Task 5: Convert `osm-import-pbf.yml`

**Files:**
- Modify: `.github/workflows/osm-import-pbf.yml` (concurrency :33-36; final "Run importer in backend pod" step :202-231)

- [ ] **Step 1: Change the concurrency block** to the shared group (identical to Task 4 Step 1).

- [ ] **Step 2: Replace the exec step** (streams TWO files) + cleanup:

```yaml
      - name: Run PBF importer (isolated Job)
        uses: ./.github/actions/run-loader-job
        with:
          job_name: osm-pbf-import
          namespace: ${{ env.NAMESPACE }}
          active_deadline_seconds: "21600"
          ready_timeout_seconds: "1800"
          files_json: >-
            [{"local": "${{ env.WORKDIR }}/import.geojson", "container": "/work/osm-import.geojson"},
             {"local": "${{ env.WORKDIR }}/scope.wkt", "container": "/work/osm-scope.wkt"}]
          argv_json: >-
            ${{ github.event.inputs.dry_run == 'true'
              && format('["python","-m","app.imports.cli","--path","/work/osm-import.geojson","--scope-id","{0}","--dataset","{1}","--build-id","{2}","--label","{3}","--scope-bounds-wkt-file","/work/osm-scope.wkt","--require-scope-bounds","--dry-run"]', github.event.inputs.scope_id, github.event.inputs.dataset, env.BUILD_ID, github.event.inputs.label)
              || format('["python","-m","app.imports.cli","--path","/work/osm-import.geojson","--scope-id","{0}","--dataset","{1}","--build-id","{2}","--label","{3}","--scope-bounds-wkt-file","/work/osm-scope.wkt","--require-scope-bounds"]', github.event.inputs.scope_id, github.event.inputs.dataset, env.BUILD_ID, github.event.inputs.label) }}

      - name: Delete loader Job (guaranteed teardown)
        if: always()
        run: kubectl -n "$NAMESPACE" delete job osm-pbf-import --ignore-not-found --wait --timeout=60s
```

**Important — `--label` safety:** `label` is operator free-text and may contain a `"` or `\`, which would break the JSON string built by `format()`. Guard it in the workflow BEFORE the action call: add a step that validates/normalizes `label` (reject or strip characters outside `^[A-Za-z0-9 ()._/-]+$`) and pass the sanitized value via env, OR assert the format-built `argv_json` parses as JSON (`echo "$ARGV_JSON" | python3 -c 'import json,sys; json.load(sys.stdin)'`) and fail closed if not. The renderer escapes argv for the *manifest*, but the `argv_json` string itself is assembled by `format()` here, so it must be valid JSON first. Implement the fail-closed JSON-parse check as its own step immediately before the action call.

- [ ] **Step 3: Lint** — `wsl.exe -e ./temp/actionlint/actionlint .github/workflows/osm-import-pbf.yml` → no errors.

- [ ] **Step 4: Commit**

```bash
git add .github/workflows/osm-import-pbf.yml
git commit -m "feat(ci): PBF import runs as an isolated Job; shared lock concurrency group"
```

---

### Task 6: Convert `osm-import.yml` (Overpass)

**Files:**
- Modify: `.github/workflows/osm-import.yml` (concurrency :31-33; final "Run importer in backend pod" step :133-161)

- [ ] **Step 1: Change the concurrency block** to the shared group (identical to Task 4 Step 1).

- [ ] **Step 2: Replace the exec step** (TWO files: `import.geojson` + `scope.wkt`; keep `--scope-bounds-wkt-file`/`--require-scope-bounds`). Note this workflow computes `BUILD_ID` inline (`date -u`); set it into `$GITHUB_ENV` in a prior step so the action call can read `env.BUILD_ID`, or compute it in the same step that builds `argv_json`. Mirror Task 5's structure with `job_name: osm-import`, `active_deadline_seconds: "10800"`, `ready_timeout_seconds: "900"`, the same fail-closed `argv_json` JSON-parse guard for `--label`, and the `if: always()` cleanup deleting `osm-import`.

- [ ] **Step 3: Lint** — `wsl.exe -e ./temp/actionlint/actionlint .github/workflows/osm-import.yml` → no errors.

- [ ] **Step 4: Commit**

```bash
git add .github/workflows/osm-import.yml
git commit -m "feat(ci): Overpass import runs as an isolated Job; shared lock concurrency group"
```

---

### Task 7: Validation gates (actionlint `queue:max`, kubeconform, deploy-guard)

**Files:**
- (verification only; may modify `.pre-commit-config.yaml` if the actionlint pin rejects `queue`)

- [ ] **Step 1: Confirm the pinned actionlint accepts `queue: max`**

Run: `wsl.exe -e ./temp/actionlint/actionlint .github/workflows/osm-boundary-load.yml`
Expected: no errors. If it rejects `queue`, bump `rhysd/actionlint` in `.pre-commit-config.yaml` to a version that supports it, refresh the committed `temp/actionlint` binary, and commit that bump in this PR.

- [ ] **Step 2: kubeconform the rendered manifest**

Run (Git Bash / WSL):
```bash
python3 backend/app/imports/loader_job_render.py \
  --job-name boundary-load --image img:1 --namespace fountainrank \
  --argv-json '["python","-m","app.imports.boundary_cli"]' \
  --files-json '[{"local":"/t","container":"/work/b.geojsonl"}]' \
  --active-deadline-seconds 5400 --ready-timeout-seconds 600 \
  | kubeconform -strict -summary -kubernetes-version 1.34.0 -
```
Expected: `Summary: 1 resource ... 0 errors`.

- [ ] **Step 3: Deploy-guard assertion**

Confirm no static loader manifest exists and deploy never applies one:
```bash
test ! -e infra/k8s/loader-job.yaml && echo "no static loader manifest: OK"
grep -nE "for f in|kubectl apply" .github/workflows/deploy.yml   # confirm loader-job is absent from every apply list
```
Expected: the file does not exist; `loader-job`/`osm-pbf-import`/`osm-import` appear in NO apply list.

- [ ] **Step 4: Full backend check + commit any pin bump**

Run (backend, isolated env): `uv run ruff check . && uv run ruff format --check . && uv run alembic check && uv run pytest -q`
Expected: PASS.

```bash
git add -A
git commit -m "ci: validate queue:max + kubeconform loader manifest" --allow-empty
```

---

## Self-Review

**Spec coverage:** §A action → Task 3; §A.1 image discovery + context check → Task 3 step 1; §A.3 renderer → Task 1; §B manifest fields (imagePullSecrets/fsGroup/securityContext/deadline/ttl/grace/restartPolicy/backoffLimit/entrypoint/resources) → Task 1 tests; §C three-workflow conversion → Tasks 4-6; §C.1 shared group + queue:max → Tasks 4-6 + Task 7; §D (no statement_timeout) → not implemented, correct; §C.1 loader lock logging → Task 2; Termination (`if: always()` cleanup + trap + activeDeadlineSeconds + ttl) → Tasks 3-6; Testing (render-safety pytest, kubeconform, actionlint, deploy-guard, dry-run + lock-cancellation) → Tasks 1/7 + the post-merge run phase below. Handoff/cancellation/regression prod tests are operational (post-deploy), listed in the execution phase, not unit tasks.

**Placeholder scan:** none — every code/test/YAML block is complete. The `--label` JSON-safety guard (Tasks 5/6) is specified as a concrete fail-closed JSON-parse step.

**Type consistency:** `render_job(...)` signature and `main` CLI flags match between Task 1 code and the action's `python3 …loader_job_render.py` invocation (Task 3). `acquire_add_fountain_lock(session, *, context)` matches between Task 2 definition and its four call sites. Job name strings (`boundary-load`, `osm-pbf-import`, `osm-import`) are consistent across render, action, cleanup, and pod-label selection.

## Post-merge execution (operational — after CI green + Codex PR approval + squash-merge)

1. **Deploy** the backend so the running image (used by the Job) includes the lock-logging: `gh workflow run deploy.yml --ref main` and monitor to success.
2. **Handoff smoke:** dispatch a **dry-run** boundary load (`dry_run=true`) for an already-indexed country; confirm the Job is created, streams the file, runs, and the run goes green with no in-pod loader left behind.
3. **Cancellation/lock test:** dispatch a **non-dry** re-load of a micro-state (e.g. `overture:mc`), cancel the run mid-refresh, and confirm the Job+pod are gone and no `ADD_FOUNTAIN_LOCK` advisory lock lingers (`pg_locks`/`pg_stat_activity`).
4. **Fan-out:** dispatch the remaining countries (handoff list) — with `queue: max` they enqueue FIFO. Monitor each to `success`; verify the indexed-country count grows via `https://api.fountainrank.com/api/v1/places?limit=300`.
