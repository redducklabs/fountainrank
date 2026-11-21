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


def _cluster(nodes=("111", "222"), tags=None):
    """Nodes -> real droplet tags (default: every node carries the cluster tag + k8s)."""
    tags = tags or {}
    return _guards().Cluster(
        {n: (tags[n] if n in tags else frozenset({TAG, "k8s"})) for n in nodes}
    )


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
    # Tag firewalls only cover nodes that really carry the tag.
    untagged = _cluster(tags={"222": frozenset({"k8s"})})
    verdict, detail = guards.check_firewalls(_cluster_firewalls(), untagged, PORTS)
    assert verdict == "exposed" and "'222'" in detail
    # ...unless that node has its own (clean) firewall by droplet ID.
    own = [*_cluster_firewalls(), _fw("own-222", [], tags=(), droplets=("222",))]
    assert guards.check_firewalls(own, untagged, PORTS)[0] == "ok"
    # A node droplet that can't be found can't be checked.
    missing = _cluster(tags={"222": None})
    verdict, detail = guards.check_firewalls(_cluster_firewalls(), missing, PORTS)
    assert verdict == "exposed" and "'222'" in detail
    # No nodes at all is a failure, not a vacuous pass.
    assert guards.check_firewalls(_cluster_firewalls(), _cluster(nodes=()), PORTS)[0] == "exposed"


def test_nodeport_firewall_guard_follows_every_tag_a_node_carries():
    guards = _guards()
    # Node 222 also carries `public-workers`; a firewall attached through that tag opens 31443.
    tags = {"222": frozenset({TAG, "k8s", "public-workers"})}
    extra = _fw("public-workers-fw", [_rule("31443")], tags=("public-workers",))
    verdict, detail = guards.check_firewalls(
        [*_cluster_firewalls(), extra], _cluster(tags=tags), PORTS
    )
    assert verdict == "exposed" and "public-workers-fw" in detail
    # The same firewall doesn't matter when no node carries its tag.
    assert guards.check_firewalls([*_cluster_firewalls(), extra], _cluster(), PORTS)[0] == "ok"


def test_doctl_cluster_reads_real_node_tags(monkeypatch):
    guards = _guards()
    responses = {
        ("kubernetes", "cluster", "node-pool", "list", "c"): [
            {"nodes": [{"droplet_id": "111"}, {"droplet_id": 222}, {"droplet_id": ""}]}
        ],
        ("compute", "droplet", "list"): [
            {"id": 111, "tags": [TAG, "k8s"]},
            {"id": 222, "tags": [TAG, "public-workers"]},
            {"id": 999, "tags": ["other"]},
        ],
    }
    monkeypatch.setattr(guards, "_doctl_json", lambda *args: responses[args])
    cluster = guards.doctl_cluster("c", "abc")
    assert cluster.nodes == {
        "111": frozenset({TAG, "k8s"}),
        "222": frozenset({TAG, "public-workers"}),
    }
    # A "node" that doesn't carry this cluster's tag means the wrong cluster id: fail closed.
    with pytest.raises(ValueError):
        guards.doctl_cluster("c", "other-id")
    responses[("compute", "droplet", "list")] = {"not": "a list"}
    with pytest.raises(ValueError):
        guards.doctl_cluster("c", "abc")


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
#
# The fakes keep the cluster's state in files, with the Deployment and its pods modelled
# separately: deploy.json is the traefik Deployment (template args carry the trust flags exactly
# as the chart renders them) and pods.json the pods actually running. A rollout replaces the pods
# from the template unless the `stall` marker is set (an unschedulable replacement: old pods keep
# serving, `rollout status` / `helm --wait` fail). Every test asserts the END STATE of the trust in
# the running pods, not just which commands ran.

FAKE_LIB = r"""
write_deploy() {  # $1: template args (JSON array), $2: replicas
  jq -n --argjson args "$1" --argjson n "$2" \
    '{spec: {replicas: $n, template: {spec: {containers: [{args: $args}]}}}}' \
    > "$FAKE/deploy.json"
}
rollout() {  # pods follow the template unless the rollout stalls
  [ -e "$FAKE/stall" ] && return 1
  jq '{items: [range(.spec.replicas) as $_
                | {spec: .spec.template.spec, status: {phase: "Running"}}]}' \
    "$FAKE/deploy.json" > "$FAKE/pods.json"
}
"""

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

FAKE_HELM = (
    r"""#!/usr/bin/env bash
echo "helm $*" >> "$FAKE/log"
"""
    + FAKE_LIB
    + r"""
case "$1" in
  pull)
    [ -e "$FAKE/pull-fails" ] && exit 1
    while [ $# -gt 0 ]; do [ "$1" = --destination ] && dest="$2"; shift; done
    touch "$dest/traefik-42.4.1.tgz" ;;
  upgrade)
    if [ "$2" = "--install" ]; then
      touch "$FAKE/installed"
      cidr="$(sed -n 's/.*ports\.web\.forwardedHeaders\.trustedIPs={\([^}]*\)}.*/\1/p' <<<"$*")"
      write_deploy "[\"--x\", \"--entryPoints.web.forwardedHeaders.trustedIPs=$cidr\",
                     \"--entryPoints.websecure.forwardedHeaders.trustedIPs=$cidr\"]" 1
      rollout || exit 1
      [ ! -e "$FAKE/helm-fails" ]
    else
      [ -e "$FAKE/withdraw-helm-fails" ] && exit 1
      write_deploy '["--x"]' 1
      rollout  # --wait: fails if the rollout stalls
    fi ;;
  *) exit 2 ;;
esac
"""
)

FAKE_KUBECTL = (
    r"""#!/usr/bin/env bash
echo "kubectl $*" >> "$FAKE/log"
[ -e "$FAKE/kubectl-fails" ] && exit 1
"""
    + FAKE_LIB
    + r"""
case "$*" in
  *"get service traefik"*) cat "$FAKE/annotation" ;;
  *"get deployment traefik --ignore-not-found"*)
    [ ! -e "$FAKE/deploy.json" ] || cat "$FAKE/deploy.json" ;;
  *"get deployment traefik"*) [ -e "$FAKE/deploy.json" ] && cat "$FAKE/deploy.json" ;;
  *"get pods -l app.kubernetes.io/name=traefik,app.kubernetes.io/instance=traefik-traefik "*)
    if [ -e "$FAKE/pods.json" ]; then cat "$FAKE/pods.json"; else echo '{"items": []}'; fi ;;
  "replace -f -")
    [ -e "$FAKE/replace-fails" ] && exit 1
    cat > "$FAKE/deploy.json"
    rollout || true ;;
  *"rollout status"*) [ ! -e "$FAKE/stall" ] ;;
  *"scale deployment traefik --replicas=0"*)
    [ -e "$FAKE/scale-fails" ] && exit 1
    jq '.spec.replicas = 0' "$FAKE/deploy.json" > "$FAKE/d.tmp"
    mv "$FAKE/d.tmp" "$FAKE/deploy.json"
    echo '{"items": []}' > "$FAKE/pods.json" ;;  # scaling down removes even stalled pods
  *) echo "unexpected kubectl $*" >&2; exit 2 ;;
esac
"""
)

_BASH = os.environ.get("TRAEFIK_TEST_BASH") or (None if os.name == "nt" else shutil.which("bash"))
TRUSTED = [
    "--x",
    "--entryPoints.web.forwardedHeaders.trustedIPs=10.124.0.0/20",
    "--entryPoints.websecure.forwardedHeaders.trustedIPs=10.124.0.0/20",
]


def _pod(args, phase="Running"):
    return {"spec": {"containers": [{"args": list(args)}]}, "status": {"phase": phase}}


class _Fake:
    def __init__(self, tmp_path):
        self.tmp = tmp_path
        self.bin = tmp_path / "bin"
        self.state = tmp_path / "state"
        self.bin.mkdir()
        self.state.mkdir()
        for name, body in (("doctl", FAKE_DOCTL), ("helm", FAKE_HELM), ("kubectl", FAKE_KUBECTL)):
            path = self.bin / name
            path.write_text(body, newline="\n")
            path.chmod(0o755)
        self.write("cluster.json", {"id": "abc", "vpc_uuid": "vpc-1"})
        self.write("vpc.json", {"ip_range": "10.124.0.0/20"})
        self.write("pools.json", [{"nodes": [{"droplet_id": "111"}, {"droplet_id": "222"}]}])
        self.write("droplets.json", [{"id": 111, "tags": [TAG]}, {"id": 222, "tags": [TAG]}])
        self.write("firewalls.json", _cluster_firewalls())
        self.write("annotation", "false")

    def write(self, name, data):
        (self.state / name).write_text(data if isinstance(data, str) else json.dumps(data))

    def read(self, name):
        return json.loads((self.state / name).read_text())

    def touch(self, name):
        (self.state / name).touch()

    def running(self, template_args=TRUSTED, pod_args=TRUSTED, replicas=1):
        """A previously deployed Traefik: its Deployment template and its running pods."""
        self.write(
            "deploy.json",
            {
                "spec": {
                    "replicas": replicas,
                    "template": {"spec": {"containers": [{"args": list(template_args)}]}},
                }
            },
        )
        self.write("pods.json", {"items": [_pod(pod_args)] if pod_args is not None else []})

    def trust_live(self):
        """Does any running pod carry a trust flag (or will the Deployment create one)?"""
        pods = self.read("pods.json")["items"] if (self.state / "pods.json").exists() else []
        if any("forwardedHeaders." in a for p in pods for a in p["spec"]["containers"][0]["args"]):
            return True
        if not (self.state / "deploy.json").exists():
            return False
        deploy = self.read("deploy.json")
        args = deploy["spec"]["template"]["spec"]["containers"][0]["args"]
        return deploy["spec"]["replicas"] > 0 and any("forwardedHeaders." in a for a in args)

    def run(self):
        env = {
            **os.environ,
            "PATH": f"{self.bin}{os.pathsep}{os.environ['PATH']}",
            "FAKE": str(self.state),
            "CLUSTER_NAME": "c",
            "PYTHON": sys.executable,
            "RUNNER_TEMP": str(self.tmp),
            "TRAEFIK_CONTAIN_ATTEMPTS": "2",
            "TRAEFIK_CONTAIN_POLL": "0",
        }
        res = subprocess.run(
            [_BASH, str(INSTALL)], cwd=ROOT, env=env, capture_output=True, text=True
        )
        log_path = self.state / "log"
        self.log = log_path.read_text().splitlines() if log_path.exists() else []
        self.installs = [line for line in self.log if line.startswith("helm upgrade --install")]
        self.withdrawals = [line for line in self.log if "--reuse-values" in line]
        return res


@pytest.fixture
def fake(tmp_path):
    if not _BASH or not shutil.which("jq"):
        pytest.skip("needs a POSIX bash + jq (set TRAEFIK_TEST_BASH on Windows)")
    return _Fake(tmp_path)


def test_install_script_happy_path_installs_with_vpc_trust(fake):
    res = fake.run()
    assert res.returncode == 0, res.stderr
    assert len(fake.installs) == 1 and not fake.withdrawals
    install = fake.installs[0]
    assert "--set ports.web.forwardedHeaders.trustedIPs={10.124.0.0/20}" in install
    assert "--set ports.websecure.forwardedHeaders.trustedIPs={10.124.0.0/20}" in install
    assert "traefik-chart/traefik-42.4.1.tgz" in install  # the pulled, pinned chart
    assert any(
        "helm pull traefik --repo https://traefik.github.io/charts --version 42.4.1" in line
        for line in fake.log
    )
    assert fake.trust_live()  # the happy path keeps the (verified) trust


def test_install_script_pre_check_failure_withdraws_trust_from_running_traefik(fake):
    fake.running()
    fake.write("firewalls.json", _cluster_firewalls(_rule("31443")))
    res = fake.run()
    assert res.returncode == 1
    assert not fake.installs  # trust never (re)goes live behind a public NodePort
    assert len(fake.withdrawals) == 1 and "traefik-no-trust.yaml" in fake.withdrawals[0]
    assert not fake.trust_live()
    no_trust = yaml.safe_load((fake.tmp / "traefik-no-trust.yaml").read_text())
    assert no_trust == {
        "ports": {
            "web": {"forwardedHeaders": {"trustedIPs": []}},
            "websecure": {"forwardedHeaders": {"trustedIPs": []}},
        }
    }


def test_install_script_pre_check_failure_without_traefik_changes_nothing(fake):
    fake.write("firewalls.json", _cluster_firewalls(_rule("31080")))
    res = fake.run()
    assert res.returncode == 1
    assert not fake.installs and not fake.withdrawals
    assert not (fake.state / "deploy.json").exists()


@pytest.mark.parametrize(
    "breakage",
    [
        "helm-fails",
        "annotation",
        "after-firewall",
        "bad-vpc",
        "no-cluster",
        "no-nodes",
        "untagged-node",
        "pull-fails",
    ],
)
def test_install_script_every_failure_ends_without_live_trust(fake, breakage):
    fake.running()
    if breakage in ("helm-fails", "pull-fails"):
        fake.touch(breakage)
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
    elif breakage == "untagged-node":
        fake.write("droplets.json", [{"id": 111, "tags": [TAG]}, {"id": 222, "tags": []}])
    res = fake.run()
    assert res.returncode == 1, res.stdout
    assert not fake.trust_live(), (res.stdout, res.stderr)
    if breakage not in ("helm-fails", "annotation", "after-firewall"):
        assert not fake.installs
    if breakage == "pull-fails":
        # No chart to helm-withdraw with: the live Deployment is patched directly.
        assert not fake.withdrawals
        assert "kubectl replace -f -" in fake.log


def test_install_script_falls_back_to_patching_the_deployment(fake):
    fake.running()
    fake.write("firewalls.json", _cluster_firewalls(_rule("31443")))
    fake.touch("withdraw-helm-fails")  # e.g. the API rejects the upgrade
    res = fake.run()
    assert res.returncode == 1
    assert "kubectl replace -f -" in fake.log
    assert not fake.trust_live()
    deploy = json.loads((fake.state / "deploy.json").read_text())
    assert deploy["spec"]["replicas"] == 1  # still serving, just without the trust
    assert deploy["spec"]["template"]["spec"]["containers"][0]["args"] == ["--x"]


def test_install_script_scales_to_zero_as_last_resort(fake):
    fake.running()
    fake.write("firewalls.json", _cluster_firewalls(_rule("31443")))
    fake.touch("withdraw-helm-fails")
    fake.touch("replace-fails")
    res = fake.run()
    assert res.returncode == 1
    assert any("scale deployment traefik --replicas=0" in line for line in fake.log)
    assert not fake.trust_live()
    assert "scaled to 0" in res.stdout


def test_install_script_reports_when_containment_is_impossible(fake):
    fake.running()
    fake.write("firewalls.json", _cluster_firewalls(_rule("31443")))
    for marker in ("withdraw-helm-fails", "replace-fails", "scale-fails"):
        fake.touch(marker)
    res = fake.run()
    assert res.returncode == 1
    assert fake.trust_live()
    assert "COULD NOT CONTAIN" in res.stdout


def test_install_script_treats_an_unreadable_cluster_as_trusted(fake):
    # The API can't be read (not "no release"): containment is attempted and its failure reported.
    fake.running()
    fake.write("firewalls.json", _cluster_firewalls(_rule("31443")))
    fake.touch("kubectl-fails")
    fake.touch("withdraw-helm-fails")
    res = fake.run()
    assert res.returncode == 1
    assert "state: unknown" in res.stdout
    assert "COULD NOT CONTAIN" in res.stdout


def test_install_script_judges_trust_by_running_pods_not_the_template(fake):
    # An earlier withdrawal was interrupted: the template is clean, but the replacement pod never
    # became ready, so the OLD pod still serves with trust. The rollout is still stalled.
    fake.running(template_args=["--x"], pod_args=TRUSTED)
    fake.touch("stall")
    fake.write("firewalls.json", _cluster_firewalls(_rule("31443")))
    res = fake.run()
    assert res.returncode == 1
    assert "state: trusted" in res.stdout  # not "nothing to withdraw"
    # helm --wait and the patch's rollout both stall, so it escalates to scaling to 0.
    assert len(fake.withdrawals) == 1
    assert "kubectl replace -f -" in fake.log
    assert any("scale deployment traefik --replicas=0" in line for line in fake.log)
    assert not fake.trust_live()
    assert fake.read("pods.json") == {"items": []}


def test_install_script_ignores_finished_pods_and_scaled_down_templates(fake):
    # Trust flags only on a Failed pod and on a template scaled to 0: nothing runs with trust.
    fake.running(pod_args=None, replicas=0)
    fake.write("pods.json", {"items": [_pod(TRUSTED, phase="Failed")]})
    fake.write("firewalls.json", _cluster_firewalls(_rule("31443")))
    res = fake.run()
    assert res.returncode == 1
    assert "nothing to withdraw" in res.stdout
    assert not fake.withdrawals


def test_install_script_treats_a_trusted_template_with_replicas_as_trusted(fake):
    # No pod yet, but the Deployment is about to create a trusted one.
    fake.running(pod_args=None)
    fake.write("firewalls.json", _cluster_firewalls(_rule("31443")))
    res = fake.run()
    assert res.returncode == 1
    assert "state: trusted" in res.stdout
    assert not fake.trust_live()
