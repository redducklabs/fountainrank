"""Guards for the Traefik ingress controller config (ingress-nginx replacement).

Traefik is Helm-installed by scripts/ci/install-traefik.sh (run from .github/workflows/deploy.yml)
from infra/helm/traefik-values.yaml. These tests pin the security-relevant settings so a later
edit can't quietly widen the forwarded-header trust, expose the NodePorts that trust depends on,
log secrets, drop the body-size limits, or make Traefik the default IngressClass.
"""

import importlib.util
import json
import os
import shutil
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
INSTALL = ROOT / "scripts/ci/install-traefik.sh"


def _guards():
    if "traefik_guards" not in sys.modules:
        spec = importlib.util.spec_from_file_location("traefik_guards", GUARDS)
        module = importlib.util.module_from_spec(spec)
        sys.modules["traefik_guards"] = module  # dataclasses resolve their module here
        spec.loader.exec_module(module)
    return sys.modules["traefik_guards"]


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
    script = INSTALL.read_text()
    for text in (DEPLOY.read_text(), script):
        assert "0.0.0.0/0" not in text
        assert "forwardedHeaders.insecure" not in text
    for name in ("web", "websecure"):
        assert f'--set "ports.{name}.forwardedHeaders.trustedIPs={{$vpc_cidr}}"' in script


def test_traefik_nodeports_are_not_publicly_exposed():
    service = _values()["service"]
    # DOKS opens a NodePort Service's ports to 0.0.0.0/0 unless it opts out. With
    # externalTrafficPolicy Cluster a public caller can be SNATed into the trusted VPC range.
    assert service["annotations"]["kubernetes.digitalocean.com/firewall-managed"] == "false"
    assert service["spec"]["externalTrafficPolicy"] == "Cluster"


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


def test_deploy_runs_the_install_script_and_pins_the_chart():
    workflow = DEPLOY.read_text()
    step = "- name: Install/upgrade Traefik (NodePort 31080/31443, alongside ingress-nginx)\n"
    assert step + "        run: bash scripts/ci/install-traefik.sh\n" in workflow
    assert workflow.index(step) < workflow.index("- name: Render + apply namespace first")
    assert "helm upgrade --install traefik" not in workflow  # only via the script
    script = INSTALL.read_text()
    assert 'CHART_REPO="https://traefik.github.io/charts"' in script
    assert 'CHART_VERSION="42.4.1"' in script
    assert "--values infra/helm/traefik-values.yaml" in script
    assert script.startswith("#!/usr/bin/env bash\n")
    assert "\nset -euo pipefail\n" in script


# --- private-cidr guard ----------------------------------------------------------------------


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
        "10.0.0.0",  # no prefix
        "10.124.0.1/20",  # host bits set
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


# --- nodeports-not-public guard --------------------------------------------------------------

TAG = "k8s:abc"
PORTS = [31080, 31443]
PUBLIC = {"addresses": ["0.0.0.0/0", "::/0"]}
VPC = {"addresses": ["10.0.0.0/8", "172.16.0.0/12", "192.168.0.0/16"]}


def _cluster(nodes=("111", "222"), tagged=None):
    guards = _guards()
    return guards.Cluster(TAG, frozenset(nodes), frozenset(nodes if tagged is None else tagged))


def _fw(name, rules, tags=(TAG,), droplets=(), status="succeeded", pending=()):
    return {
        "name": name,
        "status": status,
        "pending_changes": list(pending),
        "tags": list(tags),
        "droplet_ids": [int(d) for d in droplets],
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
        # Resource selectors can't be proven VPC-only: they count as public.
        (_cluster_firewalls(_rule("31443", sources={"droplet_ids": [999]})), "exposed"),
        (_cluster_firewalls(_rule("31443", sources={"tags": ["other"]})), "exposed"),
        (_cluster_firewalls(_rule("31443", sources={"load_balancer_uids": ["lb"]})), "exposed"),
        (_cluster_firewalls(_rule("31443", sources={"kubernetes_ids": ["k"]})), "exposed"),
        (
            _cluster_firewalls(
                _rule("31443", sources={"addresses": ["10.0.0.0/8"], "droplet_ids": [999]})
            ),
            "exposed",
        ),
        (_cluster_firewalls(_rule("31443", sources={})), "exposed"),
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
    assert _guards().check_firewalls(firewalls, _cluster(), PORTS)[0] == verdict


def test_nodeport_firewall_guard_requires_every_node_to_be_covered():
    guards = _guards()
    # A firewall attached to node 111 only, by droplet ID: node 222 has none, so it is wide open.
    partial = [_fw("only-111", [], tags=(), droplets=("111",))]
    verdict, detail = guards.check_firewalls(partial, _cluster(), PORTS)
    assert verdict == "exposed" and "'222'" in detail
    # The cluster-tag firewalls only cover nodes that really carry the tag.
    verdict, detail = guards.check_firewalls(_cluster_firewalls(), _cluster(tagged=("111",)), PORTS)
    assert verdict == "exposed" and "'222'" in detail
    # ...unless that node has its own (clean) firewall by droplet ID.
    own = [*_cluster_firewalls(), _fw("own-222", [], tags=(), droplets=("222",))]
    assert guards.check_firewalls(own, _cluster(tagged=("111",)), PORTS)[0] == "ok"
    # No nodes at all is a failure, not a vacuous pass.
    assert guards.check_firewalls(_cluster_firewalls(), _cluster(nodes=()), PORTS)[0] == "exposed"


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
    verdict, _ = guards.poll_firewalls(lambda: next(reads), _cluster(), PORTS, sleep=sleeps.append)
    assert verdict == "ok"
    assert len(sleeps) == 2

    later = iter([_cluster_firewalls(status="waiting"), _cluster_firewalls(_rule("31443"))])
    verdict, _ = guards.poll_firewalls(lambda: next(later), _cluster(), PORTS, sleep=lambda _: None)
    assert verdict == "exposed"


def test_nodeport_firewall_guard_gives_up_if_never_settled():
    sleeps = []
    verdict, detail = _guards().poll_firewalls(
        lambda: _cluster_firewalls(status="waiting"),
        _cluster(),
        PORTS,
        attempts=4,
        sleep=sleeps.append,
    )
    assert verdict == "exposed" and "never settled" in detail
    assert len(sleeps) == 3


def _raise(exc):
    def fn(*_):
        raise exc

    return fn


@pytest.mark.parametrize(
    ("get_cluster", "fetch", "args", "code"),
    [
        (lambda *_: _cluster(), lambda: _cluster_firewalls(), ["c", "abc", "31080", "31443"], 0),
        (
            lambda *_: _cluster(),
            lambda: _cluster_firewalls(_rule("31080")),
            ["c", "abc", "31080"],
            1,
        ),
        (lambda *_: _cluster(), lambda: _cluster_firewalls(), ["c", "", "31080"], 1),
        (lambda *_: _cluster(), lambda: _cluster_firewalls(), ["c", "abc", "port"], 1),
        (lambda *_: _cluster(nodes=()), lambda: _cluster_firewalls(), ["c", "abc", "31080"], 1),
        (_raise(ValueError("not a list")), lambda: [], ["c", "abc", "31080"], 1),
        (lambda *_: _cluster(), _raise(OSError("doctl missing")), ["c", "abc", "31080"], 1),
        (lambda *_: _cluster(), _raise(KeyError("droplet_id")), ["c", "abc", "31080"], 1),
        (lambda *_: _cluster(), lambda: ["not a dict"], ["c", "abc", "31080"], 1),
    ],
)
def test_nodeport_firewall_guard_cli_fails_closed(get_cluster, fetch, args, code):
    guards = _guards()
    argv = ["nodeports-not-public", *args]
    assert guards.main(argv, get_cluster=get_cluster, fetch=fetch, sleep=lambda _: None) == code


# --- install-traefik.sh, end to end against fake doctl/helm/kubectl --------------------------

FAKE_DOCTL = r"""#!/usr/bin/env bash
echo "doctl $*" >> "$FAKE/log"
case "$*" in
  "kubernetes cluster get "*) f=cluster ;;
  "vpcs get "*) f=vpc ;;
  "kubernetes cluster node-pool list "*) f=pools ;;
  "compute droplet list "*) f=droplets ;;
  "compute firewall list "*)
    if [ -e "$FAKE/installed" ] && [ -e "$FAKE/firewalls.after.json" ]; then f=firewalls.after
    else f=firewalls; fi ;;
  *) echo "unexpected doctl $*" >&2; exit 2 ;;
esac
[ -e "$FAKE/$f.json" ] || { echo "doctl: $f failed" >&2; exit 1; }
cat "$FAKE/$f.json"
"""

FAKE_HELM = r"""#!/usr/bin/env bash
echo "helm $*" >> "$FAKE/log"
case "$1" in
  status) [ -e "$FAKE/release" ] ;;
  upgrade)
    if [ "$2" = "--install" ]; then
      touch "$FAKE/release" "$FAKE/installed"
      [ ! -e "$FAKE/helm-fails" ]
    fi ;;
  *) exit 2 ;;
esac
"""

FAKE_KUBECTL = r"""#!/usr/bin/env bash
echo "kubectl $*" >> "$FAKE/log"
cat "$FAKE/annotation"
"""

_BASH = os.environ.get("TRAEFIK_TEST_BASH") or (None if os.name == "nt" else shutil.which("bash"))


@pytest.fixture
def fake(tmp_path):
    if not _BASH:
        pytest.skip("needs a POSIX bash (set TRAEFIK_TEST_BASH on Windows)")
    bin_dir = tmp_path / "bin"
    bin_dir.mkdir()
    for name, body in (("doctl", FAKE_DOCTL), ("helm", FAKE_HELM), ("kubectl", FAKE_KUBECTL)):
        path = bin_dir / name
        path.write_text(body, newline="\n")
        path.chmod(0o755)
    state = tmp_path / "state"
    state.mkdir()

    def write(name, data):
        (state / name).write_text(data if isinstance(data, str) else json.dumps(data))

    write("cluster.json", {"id": "abc", "vpc_uuid": "vpc-1"})
    write("vpc.json", {"ip_range": "10.124.0.0/20"})
    write("pools.json", [{"nodes": [{"droplet_id": "111"}, {"droplet_id": "222"}]}])
    write("droplets.json", [{"id": 111}, {"id": 222}])
    write("firewalls.json", _cluster_firewalls())
    write("annotation", "false")

    def run():
        env = {
            **os.environ,
            "PATH": f"{bin_dir}{os.pathsep}{os.environ['PATH']}",
            "FAKE": str(state),
            "CLUSTER_NAME": "c",
            "PYTHON": sys.executable,
            "RUNNER_TEMP": str(tmp_path),
        }
        res = subprocess.run(
            [_BASH, str(INSTALL)], cwd=ROOT, env=env, capture_output=True, text=True
        )
        log = (state / "log").read_text() if (state / "log").exists() else ""
        helm = [line for line in log.splitlines() if line.startswith("helm upgrade")]
        installs = [line for line in helm if line.startswith("helm upgrade --install")]
        withdrawals = [line for line in helm if "--reuse-values" in line]
        return res, installs, withdrawals

    run.write = write
    run.state = state
    run.tmp = tmp_path
    return run


def test_install_script_happy_path_installs_with_vpc_trust(fake):
    res, installs, withdrawals = fake()
    assert res.returncode == 0, res.stderr
    assert len(installs) == 1 and not withdrawals
    assert "--set ports.web.forwardedHeaders.trustedIPs={10.124.0.0/20}" in installs[0]
    assert "--set ports.websecure.forwardedHeaders.trustedIPs={10.124.0.0/20}" in installs[0]
    assert "--version 42.4.1" in installs[0]


def test_install_script_pre_check_failure_withdraws_trust_from_existing_release(fake):
    (fake.state / "release").touch()
    fake.write("firewalls.json", _cluster_firewalls(_rule("31443")))
    res, installs, withdrawals = fake()
    assert res.returncode == 1
    assert not installs  # trust never goes live behind a public NodePort
    assert len(withdrawals) == 1
    no_trust = yaml.safe_load((fake.tmp / "traefik-no-trust.yaml").read_text())
    assert no_trust == {
        "ports": {
            "web": {"forwardedHeaders": {"trustedIPs": []}},
            "websecure": {"forwardedHeaders": {"trustedIPs": []}},
        }
    }
    assert "--version 42.4.1" in withdrawals[0] and "traefik-no-trust.yaml" in withdrawals[0]


def test_install_script_pre_check_failure_without_release_installs_nothing(fake):
    fake.write("firewalls.json", _cluster_firewalls(_rule("31080")))
    res, installs, withdrawals = fake()
    assert res.returncode == 1 and not installs and not withdrawals


@pytest.mark.parametrize(
    "breakage",
    ["helm-fails", "annotation", "after-firewall", "bad-vpc", "no-cluster", "no-nodes"],
)
def test_install_script_every_failure_withdraws_trust(fake, breakage):
    (fake.state / "release").touch()  # a previously deployed release is running
    if breakage == "helm-fails":
        (fake.state / "helm-fails").touch()
    elif breakage == "annotation":
        fake.write("annotation", "")
    elif breakage == "after-firewall":
        fake.write("firewalls.after.json", _cluster_firewalls(_rule("31443")))
    elif breakage == "bad-vpc":
        fake.write("vpc.json", {"ip_range": "192.168.0.0/8"})
    elif breakage == "no-cluster":
        (fake.state / "cluster.json").unlink()
    elif breakage == "no-nodes":
        fake.write("pools.json", [])
    res, installs, withdrawals = fake()
    assert res.returncode == 1, res.stdout
    assert len(withdrawals) == 1, (res.stdout, res.stderr)
    if breakage in ("bad-vpc", "no-cluster", "no-nodes"):
        assert not installs
