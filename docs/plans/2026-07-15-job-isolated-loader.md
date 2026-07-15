# Job-isolated CLI loader (boundary + PBF + Overpass) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move each operator data-load CLI out of the shared serving pod into its own isolated Kubernetes Job, so a cancelled run tears the loader down (releasing `ADD_FOUNTAIN_LOCK`) and can never OOM the API — fixing the boundary fan-out's stalls, OOMs, and no-progress.

**Architecture:** A reusable composite action (`.github/actions/run-loader-job/`) renders a `batch/v1` Job with a stdlib-Python renderer (`backend/app/imports/loader_job_render.py`, emitting JSON via `json.dumps`), creates it, streams the prepared input file(s) in via `kubectl exec`, arms a wait-for-ready entrypoint, then tails logs and polls for the Job's terminal state. The three lock-taking workflows (`osm-boundary-load.yml`, `osm-import-pbf.yml`, `osm-import.yml`) keep every fetch/prepare step and only swap their in-pod `kubectl exec` for a call to the action, share ONE concurrency group with `queue: max`, and add an `if: always()` cleanup step. Each workflow builds its `argv_json`/`files_json` with `json.dumps` in a shell step (never GHA `format()`), so an operator `--label` with quotes/backslashes/newlines survives as exactly one argv element. A small loader-side log line brackets the advisory-lock acquisition.

**Tech Stack:** Python 3.13 (stdlib only for the renderer), FastAPI/SQLAlchemy 2 async backend, GitHub Actions composite action (bash + kubectl), Kubernetes `batch/v1` Job on DOKS, `pytest`, `actionlint` (pre-commit), `kubeconform`.

## Global Constraints

- Spec: `docs/specs/2026-07-15-job-isolated-loader-design.md` — every task implicitly includes its requirements.
- Windows host for file tools (backslash paths); Bash tool is Git Bash. Backend verifies via an **isolated** `UV_PROJECT_ENVIRONMENT` — never delete Codex's `.venv`/`node_modules` (`claude_help/local-dev.md`).
- No AI attribution in commits/PRs; no time estimates anywhere.
- Conventional Commits, frequent commits, one task at a time. Branch `fix/job-isolated-loader` (already created).
- Backend local check mirror (in `backend/`, isolated env): `uv run ruff check .` + `uv run ruff format --check .` + `uv run alembic check` + `uv run pytest`.
- The Job renderer is **stdlib-only** (system `python3` runs it on the runner; no third-party imports).
- **actionlint is pre-commit-only, NOT a CI gate** (`ci.yml` jobs are `backend`, `workspace-js`, `mobile-doctor`). `temp/actionlint` is a **local, gitignored** binary (`.gitignore:54`); the real gate is the `rhysd/actionlint` pre-commit pin. v1.7.12 is the latest release and does not know the `queue` concurrency key, so Task 4 adds a narrow justified `-ignore`.
- Loader Job resource/timeout defaults (spec §B/§C): boundary `active_deadline_seconds=5400`/`ready_timeout_seconds=600`; PBF `21600`/`1800`; Overpass `10800`/`900`. Memory request `768Mi`, limit `3Gi`; cpu `100m`/`1`. `ttlSecondsAfterFinished=600`, `terminationGracePeriodSeconds=30`, `restartPolicy: Never`, `backoffLimit: 0`, `imagePullSecrets: regcred`, pod `fsGroup: 1000`.
- Shared concurrency group for all three workflows: `{ group: db-membership-write-production, cancel-in-progress: false, queue: max }`.
- Container-path allow-list for streamed files (enforced by the renderer): `^/work/[A-Za-z0-9._-]+$`.

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
    assert cmd[0] == "sh" and cmd[1] == "-c" and cmd[3] == "loader"
    assert cmd[4:] == argv                 # every argv element preserved one-for-one
    assert cmd[4:][4] == argv[4]           # the hostile --label value is a single element
    assert json.loads(json.dumps(m)) == m  # round-trips through the real json.dumps main() uses


def test_ready_timeout_interpolated_and_shell_vars_literal():
    m = render_job(argv=["python", "-m", "x"], **{**BASE, "ready_timeout_seconds": 1800})
    wrapper = _container(m)["command"][2]
    assert "-gt 1800 " in wrapper
    assert '"$i"' in wrapper and 'exec "$@"' in wrapper


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


def test_rejects_empty_files():
    with pytest.raises(ValueError):
        render_job(argv=["python"], **{**BASE, "files": []})


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
    if not files:
        raise ValueError("files must be non-empty (the Job waits on /work/.ready)")
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

Run: `uv run pytest tests/test_loader_job_render.py -q` → Expected: PASS (all render tests green — 6 test functions, one parametrized into 5 cases).
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
- Produces: `async def acquire_add_fountain_lock(session: AsyncSession, *, context: str) -> None` in `app.locks`.

- [ ] **Step 1: Write the failing test**

Add to `backend/tests/test_locks.py` (the repo-wide async DB fixture is named `session`, `conftest.py:21`):

```python
async def test_acquire_add_fountain_lock_logs_wait_and_acquired(session, caplog):
    import logging

    from app.locks import acquire_add_fountain_lock

    with caplog.at_level(logging.INFO, logger="app.locks"):
        await acquire_add_fountain_lock(session, context="unit-test")
    msgs = [r.message for r in caplog.records if r.name == "app.locks"]
    assert "advisory_lock_wait" in msgs
    assert "advisory_lock_acquired" in msgs
```

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

Then replace each of the four loader-path call sites with the helper (leave the request-path sites in `admin.py`/`fountains.py` untouched — fast single-fountain ops, not the stall concern). At the top of `membership.py` and `merge.py` add `from app.locks import acquire_add_fountain_lock`.

- `backend/app/membership.py:1172` (in `refresh_country_memberships`) — replace
  `await session.execute(select(func.pg_advisory_xact_lock(ADD_FOUNTAIN_LOCK_KEY)))` with:
  ```python
  await acquire_add_fountain_lock(session, context="refresh_country_memberships")
  ```
- `backend/app/membership.py:1287` (in `refresh_all_memberships`) — replace with:
  ```python
  await acquire_add_fountain_lock(session, context="refresh_all_memberships")
  ```
- `backend/app/imports/merge.py:89` and `:434` — replace each with:
  ```python
  await acquire_add_fountain_lock(session, context="osm_import_merge")
  ```

After editing, run `uv run ruff check .`; if `ADD_FOUNTAIN_LOCK_KEY`, `func`, or `select` are now unused in `membership.py` or `merge.py`, delete only the newly-unused names from that file's imports (they may still be used elsewhere — let ruff be the judge).

- [ ] **Step 4: Run tests to verify they pass**

Run: `uv run pytest tests/test_locks.py tests/test_membership.py tests/test_boundary_cli.py tests/test_boundary_load.py -q` → Expected: PASS.
Then `uv run ruff check .` and `uv run ruff format --check .` → clean.

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
- Produces: a composite action with inputs `job_name`, `argv_json`, `files_json`, `active_deadline_seconds`, `ready_timeout_seconds`, `mem_request` (default `768Mi`), `mem_limit` (default `3Gi`), `namespace` (default `fountainrank`). Guaranteed teardown on cancellation is the caller's `if: always()` step (composite actions have no `post:`); this action also deletes the Job on its own in-step failures.

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

        # 0) Assert we are on the production cluster before any cluster op.
        CTX="$(kubectl config current-context)"
        echo "kube context: $CTX"
        case "$CTX" in
          *fountainrank-production-cluster*) ;;
          *) echo "::error::refusing to run: unexpected kube context '$CTX'"; exit 1 ;;
        esac

        # 1) Discover the DEPLOYED backend image (by container name) so the Job runs prod code.
        IMAGE="$(kubectl -n "$NS" get deployment fountainrank-backend \
          -o jsonpath='{.spec.template.spec.containers[?(@.name=="backend")].image}')"
        [ -n "$IMAGE" ] || { echo "::error::could not discover backend image"; exit 1; }
        echo "loader image: $IMAGE"

        # 2) Pre-flight: clear any stale Job of this name.
        kubectl -n "$NS" delete job "$JOB_NAME" --ignore-not-found --wait --timeout=60s

        # 3) Render (stdlib python; json.dumps escapes all argv) and create.
        python3 backend/app/imports/loader_job_render.py \
          --job-name "$JOB_NAME" --image "$IMAGE" --namespace "$NS" \
          --argv-json "$ARGV_JSON" --files-json "$FILES_JSON" \
          --mem-request "$MEM_REQUEST" --mem-limit "$MEM_LIMIT" \
          --active-deadline-seconds "$ACTIVE_DEADLINE" \
          --ready-timeout-seconds "$READY_TIMEOUT" \
          | kubectl -n "$NS" create -f -

        SEL="batch.kubernetes.io/job-name=$JOB_NAME"

        # On ANY in-step failure: dump diagnostics + delete the Job. (The caller's if:always()
        # step is the guaranteed teardown on job cancellation.)
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

        # 4) Wait until EXACTLY ONE pod exists for the Job (kubectl wait can't wait for a
        #    not-yet-created pod), then wait for THAT pod to be Running.
        POD=""
        for _ in $(seq 1 60); do
          names="$(kubectl -n "$NS" get pod -l "$SEL" -o jsonpath='{.items[*].metadata.name}')"
          n=$(printf '%s' "$names" | wc -w)
          if [ "$n" -gt 1 ]; then echo "::error::expected 1 loader pod, found $n ($names)"; exit 1; fi
          if [ "$n" -eq 1 ]; then POD="$names"; break; fi
          sleep 2
        done
        [ -n "$POD" ] || { echo "::error::loader pod was never created"; exit 1; }
        echo "loader pod: $POD"
        if ! kubectl -n "$NS" wait --for=jsonpath='{.status.phase}'=Running \
             "pod/$POD" --timeout=180s; then
          echo "::error::loader pod $POD did not reach Running (image pull / unschedulable / crashloop?)"
          kubectl -n "$NS" get "pod/$POD" \
            -o jsonpath='{range .status.containerStatuses[*]}{.state}{"\n"}{end}' || true
          exit 1
        fi

        # 5) Stream each input file (fields extracted with python — no delimiter fragility),
        #    verifying the local file exists and the streamed copy is non-empty, then arm .ready.
        count="$(printf '%s' "$FILES_JSON" | python3 -c 'import json,sys; print(len(json.load(sys.stdin)))')"
        for idx in $(seq 0 "$((count-1))"); do
          LOCAL="$(printf '%s' "$FILES_JSON" | python3 -c "import json,sys; print(json.load(sys.stdin)[$idx]['local'])")"
          CONTAINER="$(printf '%s' "$FILES_JSON" | python3 -c "import json,sys; print(json.load(sys.stdin)[$idx]['container'])")"
          [ -n "$LOCAL" ] && [ -s "$LOCAL" ] || { echo "::error::local input missing/empty: $LOCAL"; exit 1; }
          echo "stream $LOCAL -> $CONTAINER"
          kubectl -n "$NS" exec -i "$POD" -- sh -c 'cat > "$1"' -- "$CONTAINER" < "$LOCAL"
          kubectl -n "$NS" exec "$POD" -- test -s "$CONTAINER" \
            || { echo "::error::streamed file empty in pod: $CONTAINER"; exit 1; }
        done
        kubectl -n "$NS" exec "$POD" -- touch /work/.ready

        # 6) Tail logs in the background (visibility); the terminal poll loop is the authority.
        ( kubectl -n "$NS" logs -f "$POD" 2>&1 || true ) &
        LOGPID=$!
        while true; do
          COMPLETE="$(kubectl -n "$NS" get job "$JOB_NAME" -o jsonpath='{.status.conditions[?(@.type=="Complete")].status}' 2>/dev/null || true)"
          FAILED="$(kubectl -n "$NS" get job "$JOB_NAME" -o jsonpath='{.status.conditions[?(@.type=="Failed")].status}' 2>/dev/null || true)"
          if [ "$COMPLETE" = "True" ]; then
            kill "$LOGPID" 2>/dev/null || true; wait "$LOGPID" 2>/dev/null || true
            echo "loader Job completed"; exit 0
          fi
          if [ "$FAILED" = "True" ]; then
            kill "$LOGPID" 2>/dev/null || true; wait "$LOGPID" 2>/dev/null || true
            REASON="$(kubectl -n "$NS" get job "$JOB_NAME" -o jsonpath='{.status.conditions[?(@.type=="Failed")].reason}' 2>/dev/null || true)"
            OOM="$(kubectl -n "$NS" get pod -l "$SEL" -o jsonpath='{.items[0].status.containerStatuses[0].state.terminated.reason}{" "}{.items[0].status.containerStatuses[0].lastState.terminated.reason}' 2>/dev/null || true)"
            case "$OOM" in
              *OOMKilled*) echo "::error::loader pod OOMKilled — raise mem_limit or investigate node memory"; exit 1 ;;
            esac
            if [ "$REASON" = "DeadlineExceeded" ]; then
              echo "::error::loader Job hit activeDeadlineSeconds ($ACTIVE_DEADLINE) — raise the input or investigate (not a plain crash)"
            else
              echo "::error::loader Job failed (reason=${REASON:-unknown})"
            fi
            exit 1
          fi
          sleep 5
        done
```

- [ ] **Step 2: Validate the action metadata**

`actionlint` lints **workflows**, not composite-action metadata (it would parse `action.yml` as a
workflow and error on missing `on`/`jobs`). Validate the action file as YAML + schema shape instead;
it is exercised for real via the calling workflows' actionlint in Tasks 4-7:
`python -c "import yaml; d=yaml.safe_load(open('.github/actions/run-loader-job/action.yml')); assert d['runs']['using']=='composite'"`
Expected: exits 0.

- [ ] **Step 3: Commit**

```bash
git add .github/actions/run-loader-job/action.yml
git commit -m "feat(ci): reusable run-loader-job composite action (isolated Job)"
```

---

### Task 4: Convert `osm-boundary-load.yml` (+ actionlint `queue` tolerance)

**Files:**
- Modify: `.pre-commit-config.yaml` (actionlint hook args)
- Modify: `.github/workflows/osm-boundary-load.yml` (concurrency :28-32; final "Run boundary loader in backend pod" step :157-185)

- [ ] **Step 1: Make actionlint tolerate the valid `queue` key**

Under the `rhysd/actionlint` hook in `.pre-commit-config.yaml`, add args (v1.7.12 is the latest and does not yet know `queue`):

```yaml
  - repo: https://github.com/rhysd/actionlint
    rev: v1.7.12
    hooks:
      - id: actionlint
        # `queue` is a valid GitHub Actions concurrency key (single|max), but actionlint
        # <=v1.7.12 (latest) errors "unexpected key queue for concurrency". Narrow, justified
        # ignore — remove when actionlint learns the key. (actionlint is pre-commit-only; not a
        # CI gate.)
        args: ["-ignore", 'unexpected key "queue" for "concurrency" section']
```

Local runs of the gitignored binary must pass the same flag:
`wsl.exe -e ./temp/actionlint/actionlint -ignore 'unexpected key "queue" for "concurrency" section' <file>`.

- [ ] **Step 2: Change the concurrency block** (replace lines 28-32):

```yaml
concurrency:
  # ALL operator workflows that take ADD_FOUNTAIN_LOCK during their membership refresh share this
  # group so they never contend on the lock; queue: max lets a bulk fan-out enqueue every country
  # FIFO instead of the default single-pending behavior that cancels older pending runs.
  group: db-membership-write-production
  cancel-in-progress: false
  queue: max
```

- [ ] **Step 3: Replace the in-pod exec step** with a build-inputs step + the action call + guaranteed cleanup (the `doctl` + `Save kubeconfig` steps just above it stay). Replace lines 157-185 with:

```yaml
      - name: Build loader inputs
        id: loader
        env:
          SCOPE_ID: ${{ github.event.inputs.scope_id }}
          RELEASE_ID: ${{ github.event.inputs.overture_release_id }}
          DRY_RUN: ${{ github.event.inputs.dry_run }}
        run: |
          # OUT is already exported from an earlier GITHUB_ENV step. Build JSON with json.dumps so
          # any value is correctly encoded (defense-in-depth; these inputs are regex-validated).
          python3 - >> "$GITHUB_OUTPUT" <<'PY'
          import json, os
          argv = ["python", "-m", "app.imports.boundary_cli", "--path", "/work/boundary.geojsonl",
                  "--overture-release-id", os.environ["RELEASE_ID"], "--scope-id", os.environ["SCOPE_ID"]]
          if os.environ["DRY_RUN"] == "true":
              argv.append("--dry-run")
          files = [{"local": os.environ["OUT"], "container": "/work/boundary.geojsonl"}]
          print("argv_json=" + json.dumps(argv))
          print("files_json=" + json.dumps(files))
          PY

      - name: Run boundary loader (isolated Job)
        uses: ./.github/actions/run-loader-job
        with:
          job_name: boundary-load
          namespace: ${{ env.NAMESPACE }}
          active_deadline_seconds: "5400"
          ready_timeout_seconds: "600"
          argv_json: ${{ steps.loader.outputs.argv_json }}
          files_json: ${{ steps.loader.outputs.files_json }}

      - name: Delete loader Job (guaranteed teardown)
        if: always()
        run: kubectl -n "$NAMESPACE" delete job boundary-load --ignore-not-found --wait --timeout=60s
```

- [ ] **Step 4: Lint**

Run: `wsl.exe -e ./temp/actionlint/actionlint -ignore 'unexpected key "queue" for "concurrency" section' .github/workflows/osm-boundary-load.yml`
Expected: no errors. Also `pre-commit run actionlint --files .github/workflows/osm-boundary-load.yml .pre-commit-config.yaml` (if pre-commit is installed) → pass.

- [ ] **Step 5: Commit**

```bash
git add .pre-commit-config.yaml .github/workflows/osm-boundary-load.yml
git commit -m "feat(ci): boundary load runs as an isolated Job; shared lock concurrency group"
```

---

### Task 5: Convert `osm-import-pbf.yml`

**Files:**
- Modify: `.github/workflows/osm-import-pbf.yml` (concurrency :33-36; final "Run importer in backend pod" step :202-231)

- [ ] **Step 1: Change the concurrency block** to the shared group (identical to Task 4 Step 2).

- [ ] **Step 2: Replace the exec step** (streams TWO files; keeps `--scope-bounds-wkt-file`/`--require-scope-bounds`). `WORKDIR` and `BUILD_ID` are already exported to `GITHUB_ENV` earlier. `label` is operator free-text — `json.dumps` encodes it safely as one argv element. Replace lines 202-231 with:

```yaml
      - name: Build loader inputs
        id: loader
        env:
          SCOPE_ID: ${{ github.event.inputs.scope_id }}
          DATASET: ${{ github.event.inputs.dataset }}
          LABEL: ${{ github.event.inputs.label }}
          DRY_RUN: ${{ github.event.inputs.dry_run }}
        run: |
          # WORKDIR + BUILD_ID exported earlier via GITHUB_ENV. json.dumps makes LABEL (free text)
          # exactly one argv element even with quotes/backslashes/newlines.
          python3 - >> "$GITHUB_OUTPUT" <<'PY'
          import json, os
          argv = ["python", "-m", "app.imports.cli", "--path", "/work/osm-import.geojson",
                  "--scope-id", os.environ["SCOPE_ID"], "--dataset", os.environ["DATASET"],
                  "--build-id", os.environ["BUILD_ID"], "--label", os.environ["LABEL"],
                  "--scope-bounds-wkt-file", "/work/osm-scope.wkt", "--require-scope-bounds"]
          if os.environ["DRY_RUN"] == "true":
              argv.append("--dry-run")
          wd = os.environ["WORKDIR"]
          files = [{"local": wd + "/import.geojson", "container": "/work/osm-import.geojson"},
                   {"local": wd + "/scope.wkt", "container": "/work/osm-scope.wkt"}]
          print("argv_json=" + json.dumps(argv))
          print("files_json=" + json.dumps(files))
          PY

      - name: Run PBF importer (isolated Job)
        uses: ./.github/actions/run-loader-job
        with:
          job_name: osm-pbf-import
          namespace: ${{ env.NAMESPACE }}
          active_deadline_seconds: "21600"
          ready_timeout_seconds: "1800"
          argv_json: ${{ steps.loader.outputs.argv_json }}
          files_json: ${{ steps.loader.outputs.files_json }}

      - name: Delete loader Job (guaranteed teardown)
        if: always()
        run: kubectl -n "$NAMESPACE" delete job osm-pbf-import --ignore-not-found --wait --timeout=60s
```

- [ ] **Step 3: Lint** — `wsl.exe -e ./temp/actionlint/actionlint -ignore 'unexpected key "queue" for "concurrency" section' .github/workflows/osm-import-pbf.yml` → no errors.

- [ ] **Step 4: Commit**

```bash
git add .github/workflows/osm-import-pbf.yml
git commit -m "feat(ci): PBF import runs as an isolated Job; shared lock concurrency group"
```

---

### Task 6: Convert `osm-import.yml` (Overpass)

**Files:**
- Modify: `.github/workflows/osm-import.yml` (concurrency :31-33; final "Run importer in backend pod" step :133-161)

- [ ] **Step 1: Change the concurrency block** to the shared group (identical to Task 4 Step 2).

- [ ] **Step 2: Replace the exec step.** This workflow computes `BUILD_ID` inline and produces `import.geojson` + `scope.wkt` in the repo root (the checkout dir), not a `$WORKDIR`. Compute `BUILD_ID` in the build-inputs step. Replace lines 133-161 with:

```yaml
      - name: Build loader inputs
        id: loader
        env:
          SCOPE_ID: ${{ github.event.inputs.scope_id }}
          DATASET: ${{ github.event.inputs.dataset }}
          LABEL: ${{ github.event.inputs.label }}
          DRY_RUN: ${{ github.event.inputs.dry_run }}
        run: |
          BUILD_ID="$(date -u +%Y-%m-%dT%H-%M-%SZ)"; export BUILD_ID
          python3 - >> "$GITHUB_OUTPUT" <<'PY'
          import json, os
          argv = ["python", "-m", "app.imports.cli", "--path", "/work/osm-import.geojson",
                  "--scope-id", os.environ["SCOPE_ID"], "--dataset", os.environ["DATASET"],
                  "--build-id", os.environ["BUILD_ID"], "--label", os.environ["LABEL"],
                  "--scope-bounds-wkt-file", "/work/osm-scope.wkt", "--require-scope-bounds"]
          if os.environ["DRY_RUN"] == "true":
              argv.append("--dry-run")
          files = [{"local": "import.geojson", "container": "/work/osm-import.geojson"},
                   {"local": "scope.wkt", "container": "/work/osm-scope.wkt"}]
          print("argv_json=" + json.dumps(argv))
          print("files_json=" + json.dumps(files))
          PY

      - name: Run Overpass importer (isolated Job)
        uses: ./.github/actions/run-loader-job
        with:
          job_name: osm-import
          namespace: ${{ env.NAMESPACE }}
          active_deadline_seconds: "10800"
          ready_timeout_seconds: "900"
          argv_json: ${{ steps.loader.outputs.argv_json }}
          files_json: ${{ steps.loader.outputs.files_json }}

      - name: Delete loader Job (guaranteed teardown)
        if: always()
        run: kubectl -n "$NAMESPACE" delete job osm-import --ignore-not-found --wait --timeout=60s
```

(`import.geojson`/`scope.wkt` are relative to the checkout dir, which is the composite action's working directory too — the action's `[ -s "$LOCAL" ]` check confirms they exist before streaming.)

- [ ] **Step 3: Lint** — `wsl.exe -e ./temp/actionlint/actionlint -ignore 'unexpected key "queue" for "concurrency" section' .github/workflows/osm-import.yml` → no errors.

- [ ] **Step 4: Commit**

```bash
git add .github/workflows/osm-import.yml
git commit -m "feat(ci): Overpass import runs as an isolated Job; shared lock concurrency group"
```

---

### Task 7: Validation gates (kubeconform, deploy-guard, full backend check)

- [ ] **Step 1: kubeconform the rendered manifest**

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

- [ ] **Step 1b: Render-safety end-to-end (hostile label → one argv element → valid JSON)**

This exercises the same `json.dumps → argv_json → renderer` chain the workflows use, proving a hostile `--label` survives (`json.dumps` emits single-line JSON, so it is also safe for `$GITHUB_OUTPUT`):
```bash
HOSTILE='a "b" $(id) ; ${X}'
python3 backend/app/imports/loader_job_render.py \
  --job-name osm-import --image img:1 --namespace fountainrank \
  --argv-json "$(python3 -c "import json,os;print(json.dumps(['python','-m','app.imports.cli','--label',os.environ['HOSTILE']]))" )" \
  --files-json '[{"local":"/t","container":"/work/osm-import.geojson"}]' \
  --active-deadline-seconds 10800 --ready-timeout-seconds 900 \
  | HOSTILE="$HOSTILE" python3 -c 'import json,os,sys; m=json.load(sys.stdin); c=m["spec"]["template"]["spec"]["containers"][0]["command"]; assert c[-1]==os.environ["HOSTILE"], c[-1]; print("hostile --label preserved as one element: OK")'
```
Expected: `hostile --label preserved as one element: OK`.

- [ ] **Step 2: Deploy-guard assertion**

```bash
test ! -e infra/k8s/loader-job.yaml && echo "no static loader manifest: OK"
grep -nE "for f in|kubectl apply" .github/workflows/deploy.yml   # loader-job / osm-* absent from every apply list
```
Expected: the file does not exist; no loader Job name appears in any apply list.

- [ ] **Step 3: Full backend check**

Run (backend, isolated env): `uv run ruff check . && uv run ruff format --check . && uv run alembic check && uv run pytest -q`
Expected: PASS.

- [ ] **Step 4: Full workflow lint**

Run: `wsl.exe -e ./temp/actionlint/actionlint -ignore 'unexpected key "queue" for "concurrency" section' .github/workflows/osm-boundary-load.yml .github/workflows/osm-import-pbf.yml .github/workflows/osm-import.yml`
Expected: no errors. (Do NOT pass the composite `action.yml` — actionlint lints workflows, not action metadata.)

---

## Self-Review

**Spec coverage:** §A action → Task 3; §A.1 image discovery (by container name) + context check → Task 3; §A.3 renderer → Task 1; §B manifest fields → Task 1 tests; §C three-workflow conversion (two-file handoff + `--require-scope-bounds` for PBF/Overpass) → Tasks 4-6; §C.1 shared group + `queue: max` (+ actionlint tolerance) → Task 4; loader lock logging → Task 2; Termination (`if: always()` cleanup + trap + activeDeadlineSeconds + ttl + OOMKilled reporting) → Tasks 3-6; Testing (render-safety pytest, kubeconform, actionlint, deploy-guard) → Tasks 1/7; handoff/cancellation/regression prod tests → the post-merge execution phase.

**Placeholder scan:** none — every code/test/YAML block is complete, including the concrete Overpass steps and the `json.dumps` build-inputs steps that replace unsafe GHA `format()`.

**Type consistency:** `render_job(...)` and the `main` CLI flags match the action's invocation. `acquire_add_fountain_lock(session, *, context)` matches its four call sites and the test uses the real `session` fixture. Job names (`boundary-load`, `osm-pbf-import`, `osm-import`) are consistent across render, action, cleanup, and pod-label selection. `steps.loader.outputs.{argv_json,files_json}` names match between each build-inputs step and its action call.

## Post-merge execution (operational — after CI green + Codex PR approval + squash-merge)

1. **Deploy** the backend so the running image (used by the Job) includes the lock-logging: `gh workflow run deploy.yml --ref main`; monitor to success.
2. **Handoff smoke:** dispatch a **dry-run** boundary load for an already-indexed country; confirm the Job is created, streams the file, runs green, leaves no in-pod loader behind.
3. **Cancellation/lock test:** dispatch a **non-dry** re-load of a micro-state (`overture:mc`), cancel the run mid-refresh, and confirm the Job+pod are gone and no `ADD_FOUNTAIN_LOCK` lingers (`pg_locks`/`pg_stat_activity`).
4. **Fan-out:** dispatch the remaining countries (handoff list) — with `queue: max` they enqueue FIFO. Monitor each to `success`; verify the indexed-country count grows via `https://api.fountainrank.com/api/v1/places?limit=300`.
