#!/usr/bin/env python3
"""Fail-closed deploy guards for the Traefik ingress controller (.github/workflows/deploy.yml).

Stdlib-only so they run on a bare GitHub runner.

  private-cidr <cidr>
      Validate the cluster VPC range that Traefik trusts for X-Forwarded-* headers. It must be
      a strict IPv4 network (no host bits set) that lies entirely inside one RFC 1918 block.
      Prints the normalized CIDR on success; exits 1 otherwise.

  nodeports-not-public <droplet-tag> <droplet-ids> <port> [<port> ...]
      Check, with `doctl compute firewall list --output json`, that no DigitalOcean Cloud
      Firewall applied to the cluster's nodes (by the `k8s:<cluster-id>` droplet tag, or by
      droplet ID from the comma-separated <droplet-ids>) lets a non-RFC 1918 source reach any of
      the given TCP ports. Cloud firewalls are allow-lists, so
      that is exactly "the port is not publicly reachable", whatever the firewall is called. It
      also fails when no firewall applies at all (an unfirewalled droplet accepts everything).
      Firewalls still reconciling (status other than "succeeded", or pending_changes) are
      re-read for a bounded time; a "failed" firewall, or one that never settles, fails.

The forwarded-header trust in infra/helm/traefik-values.yaml is only sound while the Traefik
NodePorts are reachable from the VPC alone, so the second check backs up the Service's
`kubernetes.digitalocean.com/firewall-managed: "false"` annotation.
"""

from __future__ import annotations

import ipaddress
import json
import subprocess
import sys
import time
from collections.abc import Callable, Iterable

RFC1918 = tuple(
    ipaddress.IPv4Network(block) for block in ("10.0.0.0/8", "172.16.0.0/12", "192.168.0.0/16")
)

# Exit codes / verdicts of the firewall check.
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


def _is_private_source(address: str) -> bool:
    """True only for an IPv4 address/network inside an RFC 1918 block (anything else: public)."""
    try:
        network = ipaddress.ip_network(address, strict=False)
    except ValueError:
        return False
    return isinstance(network, ipaddress.IPv4Network) and any(
        network.subnet_of(block) for block in RFC1918
    )


def check_firewalls(
    firewalls: list[dict], tag: str, droplets: Iterable[str], ports: Iterable[int]
) -> tuple[str, str]:
    """Verdict (OK / EXPOSED / PENDING) for the firewalls applied to the cluster's nodes."""
    wanted = set(ports)
    nodes = {str(d) for d in droplets}
    applied = [
        fw
        for fw in firewalls
        if tag in (fw.get("tags") or []) or nodes & {str(d) for d in fw.get("droplet_ids") or []}
    ]
    if not applied:
        return EXPOSED, f"no Cloud Firewall applies to tag {tag}: every port is open"
    exposed: set[int] = set()
    for fw in applied:
        name = fw.get("name", "?")
        status = fw.get("status")
        if status == "failed":
            return EXPOSED, f"firewall {name} failed to apply"
        if status != "succeeded" or fw.get("pending_changes"):
            return PENDING, f"firewall {name} is still applying (status {status!r})"
        for rule in fw.get("inbound_rules") or []:
            if rule.get("protocol") not in ("tcp", "all"):
                continue
            addresses = (rule.get("sources") or {}).get("addresses") or []
            if all(_is_private_source(a) for a in addresses):
                continue
            exposed |= wanted.intersection(_rule_ports(str(rule.get("ports", ""))))
    if exposed:
        return EXPOSED, f"port(s) {sorted(exposed)} are open to a non-RFC 1918 source"
    names = ", ".join(sorted(fw.get("name", "?") for fw in applied))
    return OK, f"no public rule for {sorted(wanted)} on {names}"


def _doctl_firewalls() -> list[dict]:
    out = subprocess.run(
        ["doctl", "compute", "firewall", "list", "--output", "json"],
        check=True,
        capture_output=True,
        text=True,
    ).stdout
    firewalls = json.loads(out)
    if not isinstance(firewalls, list):
        raise ValueError("doctl returned something other than a JSON list of firewalls")
    return firewalls


def poll_firewalls(
    fetch: Callable[[], list[dict]],
    tag: str,
    droplets: list[str],
    ports: list[int],
    attempts: int = 18,
    delay: float = 10.0,
    sleep: Callable[[float], None] = time.sleep,
) -> tuple[str, str]:
    """Re-read while firewalls are reconciling; give up (as EXPOSED) after `attempts` reads."""
    detail = ""
    for attempt in range(attempts):
        verdict, detail = check_firewalls(fetch(), tag, droplets, ports)
        if verdict != PENDING:
            return verdict, detail
        if attempt + 1 < attempts:
            sleep(delay)
    return EXPOSED, f"firewalls never settled: {detail}"


def main(argv: list[str], fetch: Callable[[], list[dict]] = _doctl_firewalls) -> int:
    if len(argv) == 2 and argv[0] == "private-cidr":
        try:
            print(validate_private_cidr(argv[1]))
        except ValueError as exc:
            print(f"::error::unexpected VPC range: {exc} (want an RFC 1918 CIDR)", file=sys.stderr)
            return 1
        return 0
    if len(argv) >= 4 and argv[0] == "nodeports-not-public":
        try:
            droplets = [d for d in argv[2].split(",") if d]
            if not droplets:
                raise ValueError("no node droplet IDs given")
            ports = [int(p) for p in argv[3:]]
            verdict, detail = poll_firewalls(fetch, argv[1], droplets, ports)
        except (subprocess.CalledProcessError, ValueError, TypeError, AttributeError) as exc:
            verdict, detail = EXPOSED, f"could not check the firewalls: {exc}"
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
