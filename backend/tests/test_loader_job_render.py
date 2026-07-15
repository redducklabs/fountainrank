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
    mem_request="256Mi",
    mem_limit="1Gi",
    cpu_request="100m",
    cpu_limit="1",
    active_deadline_seconds=5400,
    ready_timeout_seconds=600,
)


def _container(m):
    return m["spec"]["template"]["spec"]["containers"][0]


def test_hostile_argv_stays_one_element_each():
    argv = [
        "python",
        "-m",
        "app.imports.cli",
        "--label",
        'A "b" $(rm -rf /) `id` ; drop ${NAMESPACE}\nx',
    ]
    m = render_job(argv=argv, **BASE)
    cmd = _container(m)["command"]
    assert cmd[0] == "sh" and cmd[1] == "-c" and cmd[3] == "loader"
    assert cmd[4:] == argv  # every argv element preserved one-for-one
    assert cmd[4:][4] == argv[4]  # the hostile --label value is a single element
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
    assert c["resources"]["requests"]["memory"] == "256Mi"
    assert c["resources"]["limits"]["memory"] == "1Gi"
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
        [
            sys.executable,
            "-m",
            "app.imports.loader_job_render",
            "--job-name",
            "boundary-load",
            "--image",
            "img:1",
            "--namespace",
            "fountainrank",
            "--argv-json",
            json.dumps(["python", "-m", "app.imports.boundary_cli"]),
            "--files-json",
            json.dumps([{"local": "/t", "container": "/work/b.geojsonl"}]),
            "--active-deadline-seconds",
            "5400",
            "--ready-timeout-seconds",
            "600",
        ],
    )
    m = json.loads(out)
    assert m["kind"] == "Job" and m["metadata"]["name"] == "boundary-load"
