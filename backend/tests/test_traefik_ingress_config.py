"""Guards for the Traefik ingress controller config (ingress-nginx replacement).

Traefik is Helm-installed by .github/workflows/deploy.yml from infra/helm/traefik-values.yaml.
These tests pin the security-relevant settings so a later edit can't quietly widen the
forwarded-header trust, drop the body-size limits, or make Traefik the default IngressClass.
"""

import importlib.util
import json
import re
import subprocess
import sys
from pathlib import Path

import pytest
import yaml

ROOT = Path(__file__).resolve().parents[2]
VALUES = ROOT / "infra/helm/traefik-values.yaml"
DEPLOY = ROOT / ".github/workflows/deploy.yml"
INGRESS = ROOT / "infra/k8s/ingress.yaml"
GUARDS = ROOT / "scripts/ci/traefik_guards.py"


def _guards():
    spec = importlib.util.spec_from_file_location("traefik_guards", GUARDS)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


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


@pytest.mark.parametrize(
    "cidr",
    [
        "10.124.0.0/20",
        "10.10.0.0/16",
        "10.0.0.0/8",
        "172.16.0.0/12",
        "172.31.255.0/24",
        "192.168.32.0/20",
        "192.168.0.0/16",
        "10.124.0.9/32",
    ],
)
def test_private_cidr_guard_accepts_rfc1918_networks(cidr):
    assert _guards().validate_private_cidr(cidr) == cidr


@pytest.mark.parametrize(
    "cidr",
    [
        "",
        " ",
        "10.124.0.0/20 ",
        " 10.124.0.0/20",
        "10.124.0.0/20\n",
        "10.0.0.0",
        "10.124.0.1/20",  # no prefix / host bits set
        "0.0.0.0/0",
        "10.0.0.0/0",
        "10.0.0.0/7",  # wider than any RFC 1918 block
        "192.168.0.0/8",
        "172.16.0.0/8",
        "172.16.0.0/11",  # prefix escapes the block
        "10.999.0.0/16",
        "10.124.0.0/33",
        "10.124.0.0/-1",
        "010.124.0.0/20",  # malformed
        "172.32.0.0/16",
        "172.15.0.0/16",
        "192.169.0.0/16",  # just outside the blocks
        "100.64.0.0/10",
        "8.8.8.0/24",
        "127.0.0.0/8",
        "169.254.0.0/16",  # non-RFC 1918
        "::/0",
        "fd00::/8",
        "10.124.0.0/255.255.240.0x",
    ],
)
def test_private_cidr_guard_rejects_everything_else(cidr):
    with pytest.raises(ValueError):
        _guards().validate_private_cidr(cidr)


def test_private_cidr_guard_cli_fails_closed():
    run = [sys.executable, str(GUARDS), "private-cidr"]
    ok = subprocess.run([*run, "10.124.0.0/20"], capture_output=True, text=True)
    assert ok.returncode == 0 and ok.stdout.strip() == "10.124.0.0/20"
    for bad in ("", "192.168.0.0/8"):
        res = subprocess.run([*run, bad], capture_output=True, text=True)
        assert res.returncode == 1 and res.stdout == ""


def test_deploy_validates_the_vpc_range_with_the_guard():
    workflow = DEPLOY.read_text()
    assert 'vpc_cidr="$(python3 scripts/ci/traefik_guards.py private-cidr "$vpc_cidr")"' in workflow
    assert "grep -Eq '^(10|" not in workflow  # the old regex guard is gone


def _firewall(*rules):
    return [
        {
            "name": "k8s-public-access-other",
            "inbound_rules": [{"protocol": "tcp", "ports": "31443"}],
        },
        {"name": "k8s-public-access-abc", "inbound_rules": list(rules)},
    ]


@pytest.mark.parametrize(
    ("rules", "exposed"),
    [
        ([], []),
        ([{"protocol": "tcp", "ports": "30080"}, {"protocol": "tcp", "ports": "30443"}], []),
        ([{"protocol": "udp", "ports": "31443"}], []),
        ([{"protocol": "tcp", "ports": "31443"}], [31443]),
        ([{"protocol": "tcp", "ports": "31000-31100"}], [31080]),
        ([{"protocol": "tcp", "ports": "0"}], [31080, 31443]),
        ([{"protocol": "tcp", "ports": "all"}], [31080, 31443]),
        ([{"protocol": "all", "ports": "31080"}], [31080]),
    ],
)
def test_nodeport_firewall_guard(rules, exposed):
    firewalls = _firewall(*rules)
    assert _guards().open_ports(firewalls, "k8s-public-access-abc", [31080, 31443]) == exposed


def test_nodeport_firewall_guard_cli():
    run = [sys.executable, str(GUARDS), "nodeports-not-public", "k8s-public-access-abc"]
    run += ["31080", "31443"]
    clean = subprocess.run(run, input=json.dumps(_firewall()), capture_output=True, text=True)
    assert clean.returncode == 0
    missing = subprocess.run(run, input="[]", capture_output=True, text=True)
    assert missing.returncode == 0
    for bad_input in (json.dumps(_firewall({"protocol": "tcp", "ports": "31080"})), "{}"):
        res = subprocess.run(run, input=bad_input, capture_output=True, text=True)
        assert res.returncode == 1


def test_traefik_nodeports_are_not_publicly_exposed():
    service = _values()["service"]
    # DOKS opens a NodePort Service's ports to 0.0.0.0/0 unless it opts out. With
    # externalTrafficPolicy Cluster a public caller can be SNATed into the trusted VPC range.
    assert service["annotations"]["kubernetes.digitalocean.com/firewall-managed"] == "false"
    assert service["spec"]["externalTrafficPolicy"] == "Cluster"
    workflow = DEPLOY.read_text()
    verify = workflow[workflow.index("- name: Verify Traefik NodePorts are VPC-only") :]
    verify = verify[: verify.index("- name: Render + apply namespace first")]
    assert r"kubernetes\.digitalocean\.com/firewall-managed" in verify
    assert '[ "$managed" != "false" ]' in verify
    assert "traefik_guards.py nodeports-not-public" in verify
    assert '"k8s-public-access-$CLUSTER_ID" 31080 31443' in verify
    # The check runs after the install, in the same job.
    assert workflow.index("helm upgrade --install traefik") < workflow.index(
        "- name: Verify Traefik NodePorts are VPC-only"
    )


def test_access_logs_drop_query_strings_and_headers():
    # Query strings carry the OAuth `code` on /callback (web/app/callback/route.ts never logs it).
    access_log = _values()["accessLog"]
    assert access_log["enabled"] is True
    assert access_log["fields"]["queryParameters"]["defaultMode"] == "drop"
    assert access_log["fields"]["headers"]["defaultMode"] == "drop"
    assert not access_log["fields"]["headers"].get("names")


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
