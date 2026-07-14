from pathlib import Path

import yaml

ROOT = Path(__file__).resolve().parents[2]
MANIFEST = ROOT / "infra/k8s/write-attempt-cleanup.yaml"
DEPLOY = ROOT / ".github/workflows/deploy.yml"


def _manifest() -> dict:
    rendered = (
        MANIFEST.read_text()
        .replace("${NAMESPACE}", "fountainrank-test")
        .replace("${REGISTRY}", "registry.example")
        .replace("${IMAGE_TAG}", "test-sha")
    )
    return yaml.safe_load(rendered)


def test_cleanup_cronjob_schedule_and_failure_bounds():
    manifest = _manifest()
    spec = manifest["spec"]
    assert manifest["kind"] == "CronJob"
    assert spec["schedule"] == "37 * * * *"
    assert spec["concurrencyPolicy"] == "Forbid"
    assert spec["successfulJobsHistoryLimit"] == 3
    assert spec["failedJobsHistoryLimit"] == 3
    assert spec["jobTemplate"]["spec"]["backoffLimit"] == 2


def test_cleanup_cronjob_is_hardened_and_database_only():
    pod = _manifest()["spec"]["jobTemplate"]["spec"]["template"]["spec"]
    container = pod["containers"][0]
    assert pod["automountServiceAccountToken"] is False
    assert pod["securityContext"] == {
        "runAsNonRoot": True,
        "runAsUser": 1000,
        "runAsGroup": 1000,
        "fsGroup": 1000,
        "seccompProfile": {"type": "RuntimeDefault"},
    }
    assert container["securityContext"] == {
        "allowPrivilegeEscalation": False,
        "readOnlyRootFilesystem": True,
        "capabilities": {"drop": ["ALL"]},
    }
    assert container["command"] == ["python", "-m", "app.write_attempt_cleanup"]
    assert {item["name"] for item in container["env"]} == {
        "DATABASE_URL",
        "DB_SSL_ROOT_CERT",
    }
    assert container["resources"]["requests"]
    assert container["resources"]["limits"]


def test_deploy_applies_cleanup_manifest():
    workflow = DEPLOY.read_text()
    migration = workflow.index('kubectl -n "$NAMESPACE" exec "$POD" -- alembic upgrade head')
    cleanup = workflow.index("envsubst < infra/k8s/write-attempt-cleanup.yaml | kubectl apply -f -")
    assert migration < cleanup
    assert (
        "for f in backend account-deletion-cleanup web logto ingress basemap-tiles; do" in workflow
    )
