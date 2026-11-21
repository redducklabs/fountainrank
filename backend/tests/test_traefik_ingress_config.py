"""Guards for the Traefik ingress controller config (ingress-nginx replacement).

Traefik is Helm-installed by .github/workflows/deploy.yml from infra/helm/traefik-values.yaml.
These tests pin the security-relevant settings so a later edit can't quietly widen the
forwarded-header trust, drop the body-size limits, or make Traefik the default IngressClass.
"""

import importlib.util
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


TAG = "k8s:abc"
NODES = ["111", "222"]
PORTS = [31080, 31443]
PUBLIC = {"addresses": ["0.0.0.0/0", "::/0"]}
VPC = {"addresses": ["10.0.0.0/8", "172.16.0.0/12", "192.168.0.0/16"]}


def _fw(name, rules, tags=(TAG,), droplets=(), status="succeeded", pending=()):
    return {
        "name": name,
        "status": status,
        "pending_changes": list(pending),
        "tags": list(tags),
        "droplet_ids": list(droplets),
        "inbound_rules": list(rules),
    }


def _cluster_firewalls(*public_rules, **public_kw):
    """The two DOKS-managed firewalls plus another cluster's (ignored) public firewall."""
    worker = [{"protocol": p, "ports": "0", "sources": VPC} for p in ("tcp", "udp", "icmp")]
    return [
        _fw("k8s-abc-worker", worker),
        _fw("k8s-public-access-abc", public_rules, **public_kw),
        _fw(
            "k8s-public-access-other",
            [{"protocol": "tcp", "ports": "31443", "sources": PUBLIC}],
            tags=("k8s:other",),
        ),
    ]


def _rule(ports, protocol="tcp", sources=PUBLIC):
    return {"protocol": protocol, "ports": ports, "sources": sources}


@pytest.mark.parametrize(
    ("firewalls", "verdict"),
    [
        (_cluster_firewalls(), "ok"),
        (_cluster_firewalls(_rule("30080"), _rule("30443")), "ok"),  # ingress-nginx today
        (_cluster_firewalls(_rule("31443", protocol="udp")), "ok"),
        (_cluster_firewalls(_rule("31443", sources={"addresses": ["10.124.0.0/20"]})), "ok"),
        (_cluster_firewalls(_rule("31443", sources={"tags": ["k8s:abc"]})), "ok"),
        (_cluster_firewalls(_rule("31443")), "exposed"),
        (_cluster_firewalls(_rule("31000-31100")), "exposed"),
        (_cluster_firewalls(_rule("0")), "exposed"),
        (_cluster_firewalls(_rule("all")), "exposed"),
        (_cluster_firewalls(_rule("31080", protocol="all")), "exposed"),
        (_cluster_firewalls(_rule("31443", sources={"addresses": ["203.0.113.0/24"]})), "exposed"),
        (_cluster_firewalls(_rule("31443", sources={"addresses": ["fd00::/8"]})), "exposed"),
        (_cluster_firewalls(_rule("31443", sources={"addresses": ["bogus"]})), "exposed"),
        (
            _cluster_firewalls(_rule("31443", sources={"addresses": ["10.0.0.0/8", "0.0.0.0/0"]})),
            "exposed",
        ),
        # Applied by droplet ID instead of the cluster tag.
        (
            [*_cluster_firewalls(), _fw("hand-made", [_rule("31080")], tags=(), droplets=("222",))],
            "exposed",
        ),
        ([_fw("unrelated", [_rule("31080")], tags=("x",), droplets=("999",))], "exposed"),
        ([], "exposed"),  # no firewall on the nodes at all: every port is open
        (_cluster_firewalls(status="failed"), "exposed"),
        (_cluster_firewalls(status="waiting"), "pending"),
        (_cluster_firewalls(pending=[{"droplet_id": 111, "removing": False}]), "pending"),
    ],
)
def test_nodeport_firewall_guard(firewalls, verdict):
    assert _guards().check_firewalls(firewalls, TAG, NODES, PORTS)[0] == verdict


def test_nodeport_firewall_guard_waits_for_reconciliation_then_decides():
    guards = _guards()
    reads = iter(
        [
            _cluster_firewalls(status="waiting"),
            _cluster_firewalls(pending=[{"droplet_id": 111}]),
            _cluster_firewalls(),
        ]
    )
    sleeps = []
    verdict, _ = guards.poll_firewalls(lambda: next(reads), TAG, NODES, PORTS, sleep=sleeps.append)
    assert verdict == "ok"
    assert len(sleeps) == 2

    later = iter([_cluster_firewalls(status="waiting"), _cluster_firewalls(_rule("31443"))])
    verdict, _ = guards.poll_firewalls(lambda: next(later), TAG, NODES, PORTS, sleep=lambda _: None)
    assert verdict == "exposed"


def test_nodeport_firewall_guard_gives_up_if_never_settled():
    sleeps = []
    verdict, detail = _guards().poll_firewalls(
        lambda: _cluster_firewalls(status="waiting"),
        TAG,
        NODES,
        PORTS,
        attempts=4,
        sleep=sleeps.append,
    )
    assert verdict == "exposed" and "never settled" in detail
    assert len(sleeps) == 3


@pytest.mark.parametrize(
    ("fetch_result", "args", "code"),
    [
        (_cluster_firewalls(), [TAG, "111,222", "31080", "31443"], 0),
        (_cluster_firewalls(_rule("31080")), [TAG, "111,222", "31080", "31443"], 1),
        (_cluster_firewalls(status="failed"), [TAG, "111", "31080"], 1),
        (_cluster_firewalls(), [TAG, "", "31080"], 1),  # no node IDs: fail closed
        (_cluster_firewalls(), [TAG, "111", "port"], 1),
        (None, [TAG, "111", "31080"], 1),  # doctl output wasn't a list
    ],
)
def test_nodeport_firewall_guard_cli_fails_closed(fetch_result, args, code):
    def fetch():
        if fetch_result is None:
            raise ValueError("doctl returned something other than a JSON list of firewalls")
        return fetch_result

    assert _guards().main(["nodeports-not-public", *args], fetch=fetch) == code


def _step(workflow: str, name: str) -> str:
    body = workflow[workflow.index(f"- name: {name}") :]
    return body[: body.index("\n      - name:", 1)]


def test_traefik_nodeports_are_not_publicly_exposed():
    service = _values()["service"]
    # DOKS opens a NodePort Service's ports to 0.0.0.0/0 unless it opts out. With
    # externalTrafficPolicy Cluster a public caller can be SNATed into the trusted VPC range.
    assert service["annotations"]["kubernetes.digitalocean.com/firewall-managed"] == "false"
    assert service["spec"]["externalTrafficPolicy"] == "Cluster"

    workflow = DEPLOY.read_text()
    guard = (
        "traefik_guards.py nodeports-not-public \\\n"
        '            "k8s:$CLUSTER_ID" "$NODE_DROPLETS" 31080 31443'
    )
    before = _step(workflow, "Check Traefik NodePorts are VPC-only (before install)")
    after = _step(workflow, "Verify Traefik NodePorts are VPC-only (after install)")
    assert guard in before and guard in after
    assert r"kubernetes\.digitalocean\.com/firewall-managed" in after
    assert '[ "$managed" != "false" ]' in after
    assert '|| managed="<unreadable>"' in after
    # Every failure path withdraws the forwarded-header trust before failing the deploy.
    assert after.count('revoke_trust "') == 2
    assert '|| revoke_trust "' in after
    revoke = after[after.index("revoke_trust() {") : after.index("\n          }\n")]
    assert revoke.count("'      trustedIPs: []'") == 2
    assert "--reuse-values" in revoke and "--version 42.4.1" in revoke
    assert revoke.rstrip().endswith("exit 1")
    # Order: resolve -> check -> install (with trust) -> verify, all before the app manifests.
    order = [
        "- name: Resolve cluster VPC range",
        "- name: Check Traefik NodePorts are VPC-only (before install)",
        "helm upgrade --install traefik traefik",
        "- name: Verify Traefik NodePorts are VPC-only (after install)",
        "- name: Render + apply namespace first",
    ]
    positions = [workflow.index(s) for s in order]
    assert positions == sorted(positions)
    resolve = _step(workflow, "Resolve cluster VPC range (Traefik forwarded-header trust)")
    assert 'echo "node_droplets=$node_droplets" >> "$GITHUB_OUTPUT"' in resolve
    assert 'if [ -z "$node_droplets" ]; then' in resolve


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
