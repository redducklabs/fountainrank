"""Guards for the Traefik ingress controller config (ingress-nginx replacement).

Traefik is Helm-installed by scripts/ci/install-traefik.sh (run from .github/workflows/deploy.yml)
from infra/helm/traefik-values.yaml. These tests pin the security-relevant settings so a later
edit can't quietly widen the forwarded-header trust, expose the NodePorts that trust depends on,
log secrets, drop the body-size limits, or make Traefik the default IngressClass.
"""

import importlib.util
import json
import os
import re
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
TERRAFORM = ROOT / "infra/terraform/main.tf"


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
    step = "- name: Install/upgrade Traefik (NodePort 31080/31443)\n"
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
# The fakes keep the cluster's state in files, modelling each layer separately: deploy.json is
# the traefik Deployment (generation / observedGeneration, and template args carrying the trust
# flags exactly as the chart renders them), rs.json its ReplicaSets and pods.json the pods actually
# running. A rollout (the fake Deployment controller) observes the new generation and replaces the
# ReplicaSets and pods, unless `stall` is set (the new pod never becomes ready: old ReplicaSets and
# pods keep serving, `rollout status` / `helm --wait` fail) or `lagging` is set (the controller
# never observes the new generation). Every test asserts the END STATE of the trust across all
# layers, not just which commands ran.

FAKE_LIB = r"""
write_deploy() {  # $1: template args (JSON array), $2: replicas. Bumps metadata.generation.
  local gen=0 observed=0
  if [ -e "$FAKE/deploy.json" ]; then
    gen="$(jq '.metadata.generation // 0' "$FAKE/deploy.json")"
    observed="$(jq '.status.observedGeneration // 0' "$FAKE/deploy.json")"
  fi
  jq -n --argjson args "$1" --argjson n "$2" --argjson g "$((gen + 1))" --argjson o "$observed" \
    '{metadata: {generation: $g}, status: {observedGeneration: $o},
      spec: {replicas: $n, template: {spec: {containers: [{args: $args}]}}}}' \
    > "$FAKE/deploy.json"
}
rollout() {  # the Deployment controller: observe the spec, roll ReplicaSets + pods
  [ -e "$FAKE/lagging" ] && return 1  # controller hasn't observed the new generation
  jq '.status.observedGeneration = .metadata.generation' "$FAKE/deploy.json" > "$FAKE/d.tmp"
  mv "$FAKE/d.tmp" "$FAKE/deploy.json"
  local new
  new="$(jq -c '{spec: {replicas: .spec.replicas, template: .spec.template}}' "$FAKE/deploy.json")"
  if [ -e "$FAKE/stall" ] && [ "$(jq '.spec.replicas' "$FAKE/deploy.json")" -gt 0 ]; then
    # The new ReplicaSet's pod never becomes ready: old ReplicaSets and pods keep serving.
    jq --argjson new "$new" '.items += [$new]' "$FAKE/rs.json" > "$FAKE/r.tmp"
    mv "$FAKE/r.tmp" "$FAKE/rs.json"
    return 1
  fi
  jq -n --argjson new "$new" '{items: [$new]}' > "$FAKE/rs.json"
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
      [ -e "$FAKE/rs.json" ] || echo '{"items": []}' > "$FAKE/rs.json"
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
  *"get replicasets -l app.kubernetes.io/name=traefik,app.kubernetes.io/instance=traefik-traefik "*)
    if [ -e "$FAKE/rs.json" ]; then cat "$FAKE/rs.json"; else echo '{"items": []}'; fi ;;
  "replace -f -")
    [ -e "$FAKE/replace-fails" ] && exit 1
    jq '.metadata.generation += 1' > "$FAKE/deploy.json"
    rollout || true ;;
  *"rollout status"*) [ ! -e "$FAKE/stall" ] && [ ! -e "$FAKE/lagging" ] ;;
  *"scale deployment traefik --replicas=0"*)
    [ -e "$FAKE/scale-fails" ] && exit 1
    jq '.spec.replicas = 0 | .metadata.generation += 1' "$FAKE/deploy.json" > "$FAKE/d.tmp"
    mv "$FAKE/d.tmp" "$FAKE/deploy.json"
    rollout || true ;;  # scaling to 0 removes every ReplicaSet's pods, even stalled ones
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


def _rs(args, replicas=1):
    return {
        "spec": {"replicas": replicas, "template": {"spec": {"containers": [{"args": list(args)}]}}}
    }


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

    def running(self, template_args=TRUSTED, pod_args=TRUSTED, replicas=1, rs=None):
        """A previously deployed Traefik: Deployment (fully observed), ReplicaSets, pods."""
        self.write(
            "deploy.json",
            {
                "metadata": {"generation": 1},
                "status": {"observedGeneration": 1},
                "spec": {
                    "replicas": replicas,
                    "template": {"spec": {"containers": [{"args": list(template_args)}]}},
                },
            },
        )
        if rs is None:
            rs = [_rs(template_args, replicas)]
        self.write("rs.json", {"items": rs})
        self.write("pods.json", {"items": [_pod(pod_args)] if pod_args is not None else []})

    def trust_live(self):
        """Does anything run, or stand ready to (re)create, a pod with a trust flag?"""

        def trusting(spec):
            return any("forwardedHeaders." in a for a in spec["containers"][0]["args"])

        def items(name):
            path = self.state / name
            return self.read(name)["items"] if path.exists() else []

        if any(trusting(p["spec"]) for p in items("pods.json")):
            return True
        if any(
            r["spec"]["replicas"] > 0 and trusting(r["spec"]["template"]["spec"])
            for r in items("rs.json")
        ):
            return True
        if not (self.state / "deploy.json").exists():
            return False
        deploy = self.read("deploy.json")
        if deploy["status"]["observedGeneration"] < deploy["metadata"]["generation"]:
            return True  # unreconciled: can't tell what it will do
        return deploy["spec"]["replicas"] > 0 and trusting(deploy["spec"]["template"]["spec"])

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
    fake.write("rs.json", {"items": [_rs(TRUSTED, replicas=0)]})
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


def test_install_script_sees_an_old_replicaset_that_can_recreate_a_trusted_pod(fake):
    # Interrupted withdrawal: clean template, no trusted pod right now (it just failed), but the
    # OLD ReplicaSet still wants a replica with the trusted template and would recreate it.
    fake.running(
        template_args=["--x"],
        pod_args=None,
        rs=[_rs(TRUSTED, replicas=1), _rs(["--x"], replicas=1)],
    )
    fake.write("pods.json", {"items": [_pod(TRUSTED, phase="Failed")]})
    fake.touch("stall")
    fake.write("firewalls.json", _cluster_firewalls(_rule("31443")))
    res = fake.run()
    assert res.returncode == 1
    assert "state: trusted" in res.stdout
    assert any("scale deployment traefik --replicas=0" in line for line in fake.log)
    assert not fake.trust_live()
    assert all(r["spec"]["replicas"] == 0 for r in fake.read("rs.json")["items"])


def test_install_script_does_not_trust_an_unobserved_deployment(fake):
    # The controller hasn't observed the latest spec (generation 2, observed 1): even with a clean
    # template and nothing running, containment can't be confirmed. If the controller never
    # catches up, every step's verification fails and the script says so.
    fake.running(template_args=["--x"], pod_args=None, rs=[])
    deploy = fake.read("deploy.json")
    deploy["metadata"]["generation"] = 2
    fake.write("deploy.json", deploy)
    fake.touch("lagging")
    fake.write("firewalls.json", _cluster_firewalls(_rule("31443")))
    res = fake.run()
    assert res.returncode == 1
    assert "state: trusted" in res.stdout
    assert "COULD NOT CONTAIN" in res.stdout


def test_install_script_scale_to_zero_must_be_observed(fake):
    # Scaling to 0 only counts once the controller has observed it and no ReplicaSet wants pods.
    fake.running()
    fake.write("firewalls.json", _cluster_firewalls(_rule("31443")))
    for marker in ("withdraw-helm-fails", "replace-fails", "lagging"):
        fake.touch(marker)
    res = fake.run()
    assert res.returncode == 1
    assert any("scale deployment traefik --replicas=0" in line for line in fake.log)
    assert "COULD NOT CONTAIN" in res.stdout


def _load_balancer_block() -> str:
    text = TERRAFORM.read_text()
    start = text.index('resource "digitalocean_loadbalancer" "main" {')
    depth = 0
    for index in range(start, len(text)):
        if text[index] == "{":
            depth += 1
        elif text[index] == "}":
            depth -= 1
            if depth == 0:
                return text[start : index + 1]
    raise AssertionError("unterminated digitalocean_loadbalancer.main block")


def _hcl_blocks(body: str, name: str) -> list[dict[str, str]]:
    blocks = []
    for match in re.finditer(rf"^\s*{name}\s*{{(.*?)^\s*}}", body, re.M | re.S):
        fields = {}
        for line in match.group(1).splitlines():
            line = line.split("#", 1)[0].strip()
            if "=" in line:
                key, value = (part.strip() for part in line.split("=", 1))
                fields[key] = value.strip('"')
        blocks.append(fields)
    return blocks


def test_load_balancer_forwards_all_app_traffic_to_traefik_web_over_http():
    # Phase B. Traefik's Ingress NGINX provider gives every Ingress host its own TLS option and
    # answers 421 when the TLS connection's SNI selects a different one than the Host, so the LB
    # must not re-encrypt app traffic to `websecure` (nothing proves its backend SNI matches the
    # Host). Both entry ports go to `web` over plain HTTP; the LB's X-Forwarded-Proto is trusted
    # there, so the ssl-redirect only fires for port 80.
    web = _values()["ports"]["web"]["nodePort"]
    rules = {
        (rule["entry_protocol"], rule["entry_port"]): (rule["target_protocol"], rule["target_port"])
        for rule in _hcl_blocks(_load_balancer_block(), "forwarding_rule")
    }
    assert rules == {
        ("http", "80"): ("http", str(web)),
        ("https", "443"): ("http", str(web)),
    }


def test_load_balancer_health_check_uses_the_hostless_healthz_over_https():
    # Over plain HTTP the hostless /healthz rule inherits force-ssl-redirect (the probe sends no
    # X-Forwarded-Proto) and answers 308; over https on `websecure` its router uses the `default`
    # TLS option, so the SNI check passes whatever SNI the LB sends.
    websecure = _values()["ports"]["websecure"]["nodePort"]
    (check,) = _hcl_blocks(_load_balancer_block(), "healthcheck")
    health = (check["protocol"], check["port"], check["path"])
    assert health == ("https", str(websecure), "/healthz")
    ingress = INGRESS.read_text()
    assert "- path: /healthz" in ingress


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
    traefik = workflow.index("run: bash scripts/ci/install-traefik.sh")
    keep = workflow.index("kubectl annotate ingressclass nginx helm.sh/resource-policy=keep")
    drop = workflow.index("--set controller.ingressClassResource.enabled=false")
    adopt = workflow.index("kubectl apply -f infra/k8s/ingressclass-nginx.yaml")
    uninstall = workflow.index("helm uninstall ingress-nginx --namespace ingress-nginx")
    apps = workflow.index("envsubst < infra/k8s/namespace.yaml")
    # Traefik is up before ingress-nginx goes; the class is kept, released, and adopted before
    # the uninstall; all of it before the app manifests apply.
    assert traefik < keep < drop < adopt < uninstall < apps


def _lb(**overrides) -> dict:
    """The shape `doctl compute load-balancer list --output json` prints, after phase B."""
    lb = {
        "name": "fountainrank-production-lb",
        "ip": "146.190.0.127",
        "status": "active",
        "tag": "k8s:abc",
        "forwarding_rules": [
            {
                "entry_protocol": "http",
                "entry_port": 80,
                "target_protocol": "http",
                "target_port": 31080,
            },
            {
                "entry_protocol": "https",
                "entry_port": 443,
                "target_protocol": "http",
                "target_port": 31080,
                "certificate_id": "x",
            },
        ],
        "health_check": {"protocol": "https", "port": 31443, "path": "/healthz"},
    }
    lb.update(overrides)
    return lb


def _lb_rule(entry_protocol, entry_port, target_protocol, target_port) -> dict:
    return {
        "entry_protocol": entry_protocol,
        "entry_port": entry_port,
        "target_protocol": target_protocol,
        "target_port": target_port,
    }


# The LB as it is before phase B: ingress-nginx's NodePorts, re-encrypted 443.
INGRESS_NGINX_LB = _lb(
    forwarding_rules=[_lb_rule("http", 80, "http", 30080), _lb_rule("https", 443, "https", 30443)],
    health_check={"protocol": "https", "port": 30443, "path": "/healthz"},
)


def test_lb_guard_nodeports_match_the_traefik_values():
    guards = _guards()
    ports = _values()["ports"]
    assert guards.TRAEFIK_WEB_NODEPORT == ports["web"]["nodePort"]
    assert guards.TRAEFIK_WEBSECURE_NODEPORT == ports["websecure"]["nodePort"]


def test_lb_guard_passes_the_phase_b_load_balancer(capsys):
    other = _lb(name="other", tag="k8s:zzz", status="new")
    assert (
        _guards().main(["lb-targets-traefik", "abc"], fetch_load_balancers=lambda: [other, _lb()])
        == 0
    )
    assert capsys.readouterr().out.strip() == "146.190.0.127"


@pytest.mark.parametrize(
    "balancers",
    [
        [INGRESS_NGINX_LB],
        # Half flipped, or still re-encrypting to websecure (the 421 risk).
        [
            _lb(
                forwarding_rules=[
                    _lb_rule("http", 80, "http", 31080),
                    _lb_rule("https", 443, "https", 30443),
                ]
            )
        ],
        [
            _lb(
                forwarding_rules=[
                    _lb_rule("http", 80, "http", 31080),
                    _lb_rule("https", 443, "https", 31443),
                ]
            )
        ],
        [_lb(forwarding_rules=[_lb_rule("http", 80, "http", 31080)])],
        [_lb(forwarding_rules=[*_lb()["forwarding_rules"], _lb_rule("tcp", 8443, "tcp", 30443)])],
        [_lb(forwarding_rules=[*_lb()["forwarding_rules"], _lb_rule("http", 80, "http", 31080)])],
        [_lb(health_check={"protocol": "https", "port": 30443, "path": "/healthz"})],
        [_lb(health_check={"protocol": "http", "port": 31080, "path": "/healthz"})],
        [_lb(status="errored")],
        [_lb(ip="")],
        [],  # no LB for this cluster
        [_lb(), _lb(name="twin")],  # ambiguous
        [_lb(forwarding_rules=[{"entry_port": 80}])],
        [_lb(forwarding_rules=None)],
    ],
)
def test_lb_guard_refuses_anything_short_of_the_phase_b_load_balancer(balancers):
    assert (
        _guards().main(["lb-targets-traefik", "abc"], fetch_load_balancers=lambda: balancers) == 1
    )


def test_lb_guard_fails_closed_on_doctl_errors_and_a_missing_cluster_id():
    def broken():
        raise subprocess.CalledProcessError(1, "doctl")

    assert _guards().main(["lb-targets-traefik", "abc"], fetch_load_balancers=broken) == 1
    assert _guards().main(["lb-targets-traefik", ""], fetch_load_balancers=lambda: [_lb()]) == 1


def test_ingress_nginx_is_removed_only_after_the_lb_guard():
    workflow = DEPLOY.read_text()
    # Presence is read so that a Helm/API error fails the step instead of reading as absent
    # (`helm status ... || ...` would skip the guard and still delete the namespace).
    assert "helm status" not in workflow
    listing = workflow.index(
        "helm list --all --namespace ingress-nginx --filter '^ingress-nginx$' --output json"
    )
    namespace = workflow.index("kubectl get namespace ingress-nginx --ignore-not-found")
    gate = workflow.index('if [ "$releases" = 1 ] || [ -n "$namespace" ]; then')
    guard = workflow.index('traefik_guards.py lb-targets-traefik "$cluster_id"')
    probe = workflow.index("-H 'Host: traefik-cutover-probe.invalid'")
    refuse = workflow.index('if [ "$probe" != "404 page not found" ]; then')
    keep = workflow.index("kubectl annotate ingressclass nginx helm.sh/resource-policy=keep")
    uninstall = workflow.index("helm uninstall ingress-nginx --namespace ingress-nginx")
    delete = workflow.index("kubectl delete namespace ingress-nginx")
    assert listing < namespace < gate < guard < probe < refuse < keep < uninstall < delete
    step = workflow[workflow.index("- name: Remove ingress-nginx") :]
    step = step[: step.index("\n      - name:", 1)]
    assert "set -euo pipefail" in step
    assert "continue-on-error" not in step and "|| true" not in step


# --- The "Remove ingress-nginx" deploy step, executed against fakes -----------------------

_REMOVE_FAKES = {
    "helm": """#!/usr/bin/env bash
echo "helm $*" >> "$FAKE/log"
case "$1" in
  list) [ -e "$FAKE/helm_fail" ] && { echo "Error: cluster unreachable" >&2; exit 1; }
        cat "$FAKE/releases.json" ;;
  uninstall) rm -f "$FAKE/webhook" ;;
esac
""",
    "kubectl": """#!/usr/bin/env bash
echo "kubectl $*" >> "$FAKE/log"
case "$1 $2" in
  "get namespace") [ -e "$FAKE/namespace" ] && echo namespace/ingress-nginx ;;
  "get validatingwebhookconfiguration")
    [ -e "$FAKE/webhook" ] && echo validatingwebhookconfiguration/ingress-nginx-admission ;;
  "delete namespace") rm -f "$FAKE/namespace" ;;
esac
exit 0
""",
    "doctl": '#!/usr/bin/env bash\necho "doctl $*" >> "$FAKE/log"\necho abc\n',
    "python3": """#!/usr/bin/env bash
echo "python3 $*" >> "$FAKE/log"
[ -e "$FAKE/lb_bad" ] && exit 1
echo 203.0.113.10
""",
    "curl": '#!/usr/bin/env bash\necho "curl $*" >> "$FAKE/log"\ncat "$FAKE/probe"\n',
}


def _remove_step() -> str:
    for job in yaml.safe_load(DEPLOY.read_text())["jobs"].values():
        for step in job.get("steps", []):
            if step.get("name", "").startswith("Remove ingress-nginx"):
                return step["run"]
    raise AssertionError("no Remove ingress-nginx step")


@pytest.fixture
def remove_step(tmp_path):
    if not _BASH or not shutil.which("jq"):
        pytest.skip("needs a POSIX bash + jq (set TRAEFIK_TEST_BASH on Windows)")
    bin_dir, state = tmp_path / "bin", tmp_path / "state"
    bin_dir.mkdir()
    state.mkdir()
    for name, body in _REMOVE_FAKES.items():
        (bin_dir / name).write_text(body, newline="\n")
        (bin_dir / name).chmod(0o755)
    script = tmp_path / "step.sh"
    script.write_text(_remove_step(), newline="\n")

    def run(release=None, namespace=True, webhook=True, lb_ok=True, probe="404 page not found"):
        releases = [] if release is None else [{"name": "ingress-nginx", "status": release}]
        (state / "releases.json").write_text(json.dumps(releases))
        (state / "probe").write_text(probe)
        for flag, on in (("namespace", namespace), ("webhook", webhook), ("lb_bad", not lb_ok)):
            if on:
                (state / flag).touch()
        env = {
            **os.environ,
            "PATH": f"{bin_dir}{os.pathsep}{os.environ['PATH']}",
            "FAKE": str(state),
            "CLUSTER_NAME": "c",
        }
        res = subprocess.run(
            [_BASH, str(script)], cwd=ROOT, env=env, capture_output=True, text=True
        )
        log = (state / "log").read_text().splitlines() if (state / "log").exists() else []
        return res, log

    run.state = state
    return run


_MUTATIONS = ("kubectl annotate", "helm upgrade", "helm uninstall", "kubectl delete")


def _mutated(log):
    return [line for line in log if line.startswith(_MUTATIONS)]


def test_remove_step_hands_over_a_deployed_release_after_the_lb_guard(remove_step):
    res, log = remove_step(release="deployed")
    assert res.returncode == 0, res.stderr
    assert log[0].startswith("helm list --all ")
    guard = next(i for i, line in enumerate(log) if "lb-targets-traefik" in line)
    first_mutation = log.index(_mutated(log)[0])
    assert guard < first_mutation
    assert [line.split(" ")[0:2] for line in _mutated(log)] == [
        ["kubectl", "annotate"],
        ["helm", "upgrade"],
        ["helm", "uninstall"],
        ["kubectl", "delete"],
    ]


@pytest.mark.parametrize("status", ["pending-upgrade", "pending-install", "uninstalling"])
def test_remove_step_stops_on_an_interrupted_helm_operation(remove_step, status):
    res, log = remove_step(release=status)
    assert res.returncode != 0
    assert status in res.stderr
    assert not _mutated(log)


@pytest.mark.parametrize(
    "kwargs",
    [
        {"release": "deployed", "lb_ok": False},
        {"release": "deployed", "probe": "<html><center>nginx</center></html>"},
        {"release": None, "lb_ok": False},  # a leftover namespace alone is still guarded
    ],
)
def test_remove_step_removes_nothing_unless_the_lb_targets_traefik(remove_step, kwargs):
    res, log = remove_step(**kwargs)
    assert res.returncode != 0
    assert not _mutated(log)


def test_remove_step_fails_closed_when_helm_cannot_list(remove_step):
    (remove_step.state / "helm_fail").touch()
    res, log = remove_step(release="deployed")
    assert res.returncode != 0
    assert not _mutated(log)


def test_remove_step_keeps_the_namespace_while_the_admission_webhook_is_left(remove_step):
    res, log = remove_step(release=None, namespace=True, webhook=True)
    assert res.returncode != 0
    assert "ingress-nginx-admission" in res.stderr
    assert not _mutated(log)


def test_remove_step_deletes_a_leftover_namespace_once_the_webhook_is_gone(remove_step):
    res, log = remove_step(release=None, namespace=True, webhook=False)
    assert res.returncode == 0, res.stderr
    assert [line for line in _mutated(log)] == [
        "kubectl delete namespace ingress-nginx --ignore-not-found"
    ]


def test_remove_step_is_a_no_op_once_ingress_nginx_is_gone(remove_step):
    res, log = remove_step(release=None, namespace=False, webhook=False)
    assert res.returncode == 0, res.stderr
    assert not _mutated(log)
    assert not any("lb-targets-traefik" in line for line in log)
    assert "kubectl apply -f infra/k8s/ingressclass-nginx.yaml" in log
