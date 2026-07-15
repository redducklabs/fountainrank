"""Render the isolated operator-loader Job manifest as JSON (spec 2026-07-15 §B).

Stdlib-only, like the sibling CI-helper scripts (boundaries_registry.py, regions.py,
poly_to_wkt.py) the loader workflows already invoke with system python3. ``json.dumps``
guarantees every argv element — including an operator-supplied PBF ``--label`` with
spaces/quotes/``$``/metacharacters — is one exec-form ``command`` element that cannot break
out. No envsubst, so the wait-for-ready wrapper's literal ``$i``/``$@`` cannot be corrupted.
"""

from __future__ import annotations

import argparse
import json
import re

_CONTAINER_PATH_RE = re.compile(r"^/work/[A-Za-z0-9._-]+$")

# Wait until the runner streams every input file and touches /work/.ready, bounded by
# ready_timeout_seconds, then exec the real argv. `$i`/`$@` are literal shell text.
_WRAPPER = (
    "i=0; while [ ! -f /work/.ready ]; do i=$((i+1)); "
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
                                "items": [{"key": "database-ca.crt", "path": "database-ca.crt"}],
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
