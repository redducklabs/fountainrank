#!/usr/bin/env python3
"""Fail-closed deploy guards for the Traefik ingress controller (scripts/ci/install-traefik.sh).

Stdlib-only so they run on a bare GitHub runner.

  private-cidr <cidr>
      Validate the cluster VPC range that Traefik trusts for X-Forwarded-* headers. It must be
      a strict IPv4 network (no host bits set) that lies entirely inside one RFC 1918 block.
      Prints the normalized CIDR on success; exits 1 otherwise.

  nodeports-not-public <cluster-name> <cluster-id> <port> [<port> ...]
      Check with doctl that no public source can reach the given TCP ports on ANY node of the
      cluster. DigitalOcean Cloud Firewalls are allow-lists and an unfirewalled droplet accepts
      everything, so for every node (from `doctl kubernetes cluster node-pool list`):
        * its real tags are read (`doctl compute droplet list`); a firewall applies to it via ANY
          of those tags or via its droplet ID, and at least one must apply. A node whose
          droplet can't be found fails (its firewalls can't be determined);
        * no inbound TCP rule of an applied firewall that covers a port may allow a source other
          than an RFC 1918 IPv4 range. Resource selectors (droplet IDs, tags, load balancers,
          clusters) can't be proven VPC-only, so they count as public, as do IPv6 and
          unparseable addresses;
        * every applied firewall must have status "succeeded" and no pending_changes. While one is
          still applying it is re-read for a bounded time; "failed", or never settling, fails.
      Any doctl/parse error fails closed. Exits 0 only when every node passes.

  lb-targets-traefik <cluster-id>
      Check with doctl that the cluster's load balancer (the one whose droplet tag is
      k8s:<cluster-id>; exactly one must exist) is active and already targets Traefik as
      infra/terraform/main.tf declares it after migration phase B: exactly http 80 -> http 31080
      and https 443 -> http 31080, health check https 31443 /healthz. Prints the load balancer's
      IP on success; exits 1 otherwise, and on any doctl/parse error. The deploy runs it before
      removing ingress-nginx: doing that while the LB still targets ingress-nginx (phase B merged
      but not applied, or reverted) would be an outage.

The forwarded-header trust in infra/helm/traefik-values.yaml is only sound while the Traefik
NodePorts are reachable from the VPC alone, so this backs up the Service's
`kubernetes.digitalocean.com/firewall-managed: "false"` annotation.
"""

from __future__ import annotations

import ipaddress
import json
import subprocess
import sys
import time
from collections.abc import Callable, Iterable
from dataclasses import dataclass

RFC1918 = tuple(
    ipaddress.IPv4Network(block) for block in ("10.0.0.0/8", "172.16.0.0/12", "192.168.0.0/16")
)

# Verdicts of the firewall check.
OK, EXPOSED, PENDING = "ok", "exposed", "pending"


def validate_private_cidr(value: str) -> str:
    """Return the normalized CIDR, or raise ValueError if it isn't an RFC 1918 IPv4 network."""
    if not value or value != value.strip() or "/" not in value:
        raise ValueError(f"not an IPv4 CIDR: {value!r}")
    try:
        network = ipaddress.IPv4Network(value, strict=True)
    except (ipaddress.AddressValueError, ipaddress.NetmaskValueError, ValueError) as exc:
        raise ValueError(f"not a valid IPv4 network: {value!r} ({exc})") from exc
    if not any(network.subnet_of(block) for block in RFC1918):
        raise ValueError(f"{value!r} is not inside an RFC 1918 block")
    return str(network)


def _rule_ports(spec: str) -> range:
    """DO firewall `ports`: "80", "8000-9000", or "0"/"all"/"" for every port."""
    spec = (spec or "").strip()
    if spec in ("", "0", "all"):
        return range(1, 65536)
    low, sep, high = spec.partition("-")
    return range(int(low), int(high if sep else low) + 1)


def _is_private_address(address: object) -> bool:
    """True only for an IPv4 address/network inside an RFC 1918 block (anything else: public)."""
    try:
        network = ipaddress.ip_network(str(address), strict=False)
    except ValueError:
        return False
    return isinstance(network, ipaddress.IPv4Network) and any(
        network.subnet_of(block) for block in RFC1918
    )


def _sources_are_private(sources: dict | None) -> bool:
    """A rule's sources are VPC-only iff they are non-empty RFC 1918 addresses and nothing else."""
    sources = sources or {}
    addresses = sources.get("addresses") or []
    selectors = {k: v for k, v in sources.items() if k != "addresses" and v}
    return bool(addresses) and not selectors and all(_is_private_address(a) for a in addresses)


@dataclass(frozen=True)
class Cluster:
    # Node droplet ID -> that droplet's tags (None: the droplet wasn't found).
    nodes: dict[str, frozenset[str] | None]


def check_firewalls(
    firewalls: list[dict], cluster: Cluster, ports: Iterable[int]
) -> tuple[str, str]:
    """Verdict (OK / EXPOSED / PENDING) for every node of `cluster`."""
    wanted = set(ports)
    if not cluster.nodes:
        return EXPOSED, "no node droplets to check"
    unknown = sorted(n for n, tags in cluster.nodes.items() if tags is None)
    if unknown:
        return EXPOSED, f"node droplet(s) {unknown} not found: their firewalls can't be checked"

    def applies(fw: dict, node: str) -> bool:
        by_tag = bool(set(fw.get("tags") or []) & (cluster.nodes[node] or frozenset()))
        return by_tag or node in {str(d) for d in fw.get("droplet_ids") or []}

    applied = [fw for fw in firewalls if any(applies(fw, n) for n in cluster.nodes)]
    uncovered = sorted(n for n in cluster.nodes if not any(applies(fw, n) for fw in applied))
    if uncovered:
        return EXPOSED, f"no Cloud Firewall applies to node(s) {uncovered}: every port is open"
    for fw in applied:
        name, status = fw.get("name", "?"), fw.get("status")
        if status == "failed":
            return EXPOSED, f"firewall {name} failed to apply"
        if status != "succeeded" or fw.get("pending_changes"):
            return PENDING, f"firewall {name} is still applying (status {status!r})"
    exposed: dict[int, list[str]] = {}
    for fw in applied:
        for rule in fw.get("inbound_rules") or []:
            if rule.get("protocol") not in ("tcp", "all"):
                continue
            if _sources_are_private(rule.get("sources")):
                continue
            for port in wanted.intersection(_rule_ports(str(rule.get("ports", "")))):
                exposed.setdefault(port, []).append(fw.get("name", "?"))
    if exposed:
        detail = "; ".join(f"{p} via {', '.join(sorted(n))}" for p, n in sorted(exposed.items()))
        return EXPOSED, f"port(s) open to a non-RFC 1918 or unverifiable source: {detail}"
    names = ", ".join(sorted(fw.get("name", "?") for fw in applied))
    return OK, f"no public rule for {sorted(wanted)} on nodes {sorted(cluster.nodes)} ({names})"


def _doctl_json(*args: str) -> object:
    out = subprocess.run(
        ["doctl", *args, "--output", "json"], check=True, capture_output=True, text=True
    ).stdout
    return json.loads(out)


def _as_list(value: object, what: str) -> list:
    if not isinstance(value, list):
        raise ValueError(f"doctl {what}: expected a JSON list")
    return value


def doctl_cluster(cluster_name: str, cluster_id: str) -> Cluster:
    pools = _as_list(
        _doctl_json("kubernetes", "cluster", "node-pool", "list", cluster_name), "pools"
    )
    nodes = {
        str(node["droplet_id"])
        for pool in pools
        for node in pool.get("nodes") or []
        if node.get("droplet_id")
    }
    droplets = _as_list(_doctl_json("compute", "droplet", "list"), "droplets")
    tags = {str(d["id"]): frozenset(d.get("tags") or []) for d in droplets}
    # cluster_id is only used to sanity-check that these really are this cluster's nodes.
    for node in nodes:
        if node in tags and f"k8s:{cluster_id}" not in tags[node]:
            raise ValueError(f"node droplet {node} doesn't carry k8s:{cluster_id}")
    return Cluster({node: tags.get(node) for node in nodes})


def doctl_firewalls() -> list[dict]:
    return _as_list(_doctl_json("compute", "firewall", "list"), "firewalls")


def doctl_load_balancers() -> list[dict]:
    return _as_list(_doctl_json("compute", "load-balancer", "list"), "load balancers")


# Traefik's NodePorts (ports.web/websecure.nodePort in infra/helm/traefik-values.yaml; a test
# asserts they agree) and the LB that phase B points at them.
TRAEFIK_WEB_NODEPORT = 31080
TRAEFIK_WEBSECURE_NODEPORT = 31443
LB_FORWARDING = frozenset(
    {
        ("http", 80, "http", TRAEFIK_WEB_NODEPORT),
        ("https", 443, "http", TRAEFIK_WEB_NODEPORT),
    }
)
LB_HEALTH_CHECK = ("https", TRAEFIK_WEBSECURE_NODEPORT, "/healthz")


def check_load_balancer(balancers: list[dict], cluster_id: str) -> str:
    """Return the IP of the cluster's LB if it targets Traefik; raise ValueError otherwise."""
    if not cluster_id:
        raise ValueError("cluster id is required")
    tag = f"k8s:{cluster_id}"
    matches = [lb for lb in balancers if isinstance(lb, dict) and lb.get("tag") == tag]
    if len(matches) != 1:
        raise ValueError(f"expected one load balancer tagged {tag}, found {len(matches)}")
    lb = matches[0]
    label = f"load balancer {lb.get('name')!r}"
    problems = []
    if lb.get("status") != "active":
        problems.append(f"status is {lb.get('status')!r}, not 'active'")
    rules = _as_list(lb.get("forwarding_rules"), "forwarding rules")
    forwarding = {
        (r["entry_protocol"], r["entry_port"], r["target_protocol"], r["target_port"])
        for r in rules
    }
    if len(rules) != len(LB_FORWARDING) or forwarding != LB_FORWARDING:
        problems.append(f"forwards {sorted(forwarding)}, not {sorted(LB_FORWARDING)}")
    check = lb.get("health_check") or {}
    health = (check.get("protocol"), check.get("port"), check.get("path"))
    if health != LB_HEALTH_CHECK:
        problems.append(f"health-checks {health}, not {LB_HEALTH_CHECK}")
    ip = lb.get("ip")
    if not isinstance(ip, str) or not ip:
        problems.append("has no IP")
    if problems:
        raise ValueError(f"{label} does not target Traefik: " + "; ".join(problems))
    return ip


def poll_firewalls(
    fetch: Callable[[], list[dict]],
    cluster: Cluster,
    ports: list[int],
    attempts: int = 18,
    delay: float = 10.0,
    sleep: Callable[[float], None] = time.sleep,
) -> tuple[str, str]:
    """Re-read while firewalls are reconciling; give up (as EXPOSED) after `attempts` reads."""
    detail = ""
    for attempt in range(attempts):
        verdict, detail = check_firewalls(fetch(), cluster, ports)
        if verdict != PENDING:
            return verdict, detail
        if attempt + 1 < attempts:
            sleep(delay)
    return EXPOSED, f"firewalls never settled: {detail}"


def main(
    argv: list[str],
    get_cluster: Callable[[str, str], Cluster] = doctl_cluster,
    fetch: Callable[[], list[dict]] = doctl_firewalls,
    sleep: Callable[[float], None] = time.sleep,
    fetch_load_balancers: Callable[[], list[dict]] = doctl_load_balancers,
) -> int:
    if len(argv) == 2 and argv[0] == "lb-targets-traefik":
        try:
            print(check_load_balancer(fetch_load_balancers(), argv[1]))
        except (subprocess.CalledProcessError, OSError, ValueError, TypeError, KeyError) as exc:
            print(
                f"::error::refusing to remove ingress-nginx: {exc}. Apply migration phase B "
                "(terraform.yml) and verify it first.",
                file=sys.stderr,
            )
            return 1
        return 0
    if len(argv) == 2 and argv[0] == "private-cidr":
        try:
            print(validate_private_cidr(argv[1]))
        except ValueError as exc:
            print(f"::error::unexpected VPC range: {exc} (want an RFC 1918 CIDR)", file=sys.stderr)
            return 1
        return 0
    if len(argv) >= 4 and argv[0] == "nodeports-not-public":
        try:
            if not argv[1] or not argv[2]:
                raise ValueError("cluster name and id are required")
            ports = [int(p) for p in argv[3:]]
            verdict, detail = poll_firewalls(
                fetch, get_cluster(argv[1], argv[2]), ports, sleep=sleep
            )
        except (subprocess.CalledProcessError, OSError, ValueError, TypeError, KeyError) as exc:
            verdict, detail = EXPOSED, f"could not check the firewalls: {exc}"
        except AttributeError as exc:
            verdict, detail = EXPOSED, f"unexpected doctl output: {exc}"
        if verdict != OK:
            print(
                f"::error::Traefik NodePorts are not VPC-only: {detail}. The forwarded-header "
                "trust requires that no public source can reach them.",
                file=sys.stderr,
            )
            return 1
        print(detail)
        return 0
    print(__doc__, file=sys.stderr)
    return 2


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
