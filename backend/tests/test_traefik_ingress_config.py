"""Guards for the Traefik ingress controller config (ingress-nginx replacement).

Traefik is Helm-installed by .github/workflows/deploy.yml from infra/helm/traefik-values.yaml.
These tests pin the security-relevant settings so a later edit can't quietly widen the
forwarded-header trust, drop the body-size limits, or make Traefik the default IngressClass.
"""

import re
from pathlib import Path

import yaml

ROOT = Path(__file__).resolve().parents[2]
VALUES = ROOT / "infra/helm/traefik-values.yaml"
DEPLOY = ROOT / ".github/workflows/deploy.yml"
INGRESS = ROOT / "infra/k8s/ingress.yaml"


def _values() -> dict:
    return yaml.safe_load(VALUES.read_text())


def test_only_the_ingress_nginx_provider_reads_ingresses():
    providers = _values()["providers"]
    nginx = providers["kubernetesIngressNGINX"]
    assert nginx["enabled"] is True
    assert nginx["controllerClass"] == "k8s.io/ingress-nginx"
    assert nginx["ingressClass"] == "nginx"
    assert nginx["watchIngressWithoutClass"] is False
    # Never write Ingress status while ingress-nginx may still own it.
    assert nginx["publishService"]["enabled"] is False
    # The standard Ingress provider would read Ingresses too (duplicate routers).
    assert providers["kubernetesIngress"]["enabled"] is False
    # Don't create a (default) `traefik` IngressClass.
    assert _values()["ingressClass"]["enabled"] is False


def test_body_size_limits_are_enforced():
    # The provider enforces proxy-body-size only through the Buffering middleware, which it
    # adds only when request buffering is on.
    nginx = _values()["providers"]["kubernetesIngressNGINX"]
    assert nginx["proxyRequestBuffering"] is True
    sizes = [
        doc["metadata"]["annotations"].get("nginx.ingress.kubernetes.io/proxy-body-size")
        for doc in yaml.safe_load_all(INGRESS.read_text())
        if doc and doc.get("kind") == "Ingress"
    ]
    assert sizes == ["25m", "12m"]


def test_forwarded_header_trust_is_injected_not_hardcoded():
    ports = _values()["ports"]
    for name in ("web", "websecure"):
        fh = ports[name]["forwardedHeaders"]
        # Filled in by CI from the cluster VPC; the file itself trusts nobody.
        assert fh["trustedIPs"] == []
        assert fh["insecure"] is False
    workflow = DEPLOY.read_text()
    assert "0.0.0.0/0" not in workflow
    assert "forwardedHeaders.insecure" not in workflow
    for name in ("web", "websecure"):
        assert f'--set "ports.{name}.forwardedHeaders.trustedIPs={{$VPC_CIDR}}"' in workflow


def test_vpc_cidr_guard_accepts_only_private_ipv4_ranges():
    workflow = DEPLOY.read_text()
    match = re.search(
        r"grep -Eq '([^']+)'; then\n\s+echo \"::error::unexpected VPC range", workflow
    )
    assert match, "VPC CIDR guard not found in deploy.yml"
    guard = re.compile(match.group(1))
    for ok in ("10.124.0.0/20", "10.10.0.0/16", "172.16.0.0/12", "192.168.32.0/20"):
        assert guard.search(ok), ok
    for bad in ("", "0.0.0.0/0", "100.64.0.0/10", "8.8.8.0/24", "10.0.0.0", "10.0.0.0/0", "::/0"):
        assert not guard.search(bad), bad


def test_nodeports_and_tls():
    values = _values()
    assert values["service"]["spec"]["type"] == "NodePort"
    assert values["ports"]["web"]["nodePort"] == 31080
    assert values["ports"]["websecure"]["nodePort"] == 31443
    assert values["ports"]["websecure"]["http"]["tls"]["enabled"] is True
    assert values["tlsOptions"]["default"]["minVersion"] == "VersionTLS12"
    assert values["providers"]["kubernetesCRD"]["defaultTLSResourcesNamespace"] == "traefik"


def test_pod_is_hardened_and_bounded():
    values = _values()
    assert values["securityContext"] == {
        "allowPrivilegeEscalation": False,
        "capabilities": {"drop": ["ALL"]},
        "readOnlyRootFilesystem": True,
    }
    assert values["podSecurityContext"]["runAsNonRoot"] is True
    assert values["podSecurityContext"]["seccompProfile"] == {"type": "RuntimeDefault"}
    assert values["resources"]["requests"]
    assert values["resources"]["limits"]
    assert values["api"]["dashboard"] is False


def test_deploy_pins_the_traefik_chart():
    workflow = DEPLOY.read_text()
    assert "helm upgrade --install traefik traefik" in workflow
    assert "--repo https://traefik.github.io/charts" in workflow
    assert re.search(
        r"--repo https://traefik\.github\.io/charts \\\n\s+--version 42\.4\.1 \\", workflow
    )
    assert "--values infra/helm/traefik-values.yaml" in workflow


INGRESS_CLASS = ROOT / "infra/k8s/ingressclass-nginx.yaml"


def test_ingress_nginx_is_no_longer_installed():
    workflow = DEPLOY.read_text()
    assert "helm upgrade --install ingress-nginx" not in workflow
    assert "use-http2" not in workflow
    assert not (ROOT / "infra/k8s/ingress-nginx.yaml").exists()


def test_nginx_ingress_class_is_repo_owned_and_handed_over_without_a_gap():
    ic = yaml.safe_load(INGRESS_CLASS.read_text())
    assert ic["kind"] == "IngressClass"
    assert ic["metadata"]["name"] == "nginx"
    # What Traefik's Ingress NGINX provider keys on (providers.kubernetesIngressNGINX).
    assert (
        ic["spec"]["controller"]
        == _values()["providers"]["kubernetesIngressNGINX"]["controllerClass"]
    )
    assert ic["metadata"]["annotations"]["helm.sh/resource-policy"] == "keep"
    assert "is-default-class" not in str(ic["metadata"])

    workflow = DEPLOY.read_text()
    traefik = workflow.index("helm upgrade --install traefik traefik")
    keep = workflow.index("kubectl annotate ingressclass nginx helm.sh/resource-policy=keep")
    drop = workflow.index("--set controller.ingressClassResource.enabled=false")
    adopt = workflow.index("kubectl apply -f infra/k8s/ingressclass-nginx.yaml")
    uninstall = workflow.index("helm uninstall ingress-nginx --namespace ingress-nginx")
    apps = workflow.index("envsubst < infra/k8s/namespace.yaml")
    # Traefik is up before ingress-nginx goes; the class is kept, released, and adopted before
    # the uninstall; all of it before the app manifests apply.
    assert traefik < keep < drop < adopt < uninstall < apps
