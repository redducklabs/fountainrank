#!/usr/bin/env python3
"""Fail-closed deploy guards for the Traefik ingress controller (.github/workflows/deploy.yml).

Two checks, both stdlib-only so they run on a bare GitHub runner:

  private-cidr <cidr>
      Validate the cluster VPC range that Traefik trusts for X-Forwarded-* headers. It must be
      a strict IPv4 network (no host bits set) that lies entirely inside one RFC 1918 block.
      Prints the normalized CIDR on success; exits 1 otherwise.

  nodeports-not-public <firewall-name> <port> [<port> ...]  (firewall list JSON on stdin)
      Check the `doctl compute firewall list --output json` output: the named DOKS public-access
      firewall must have no inbound rule that opens any of the given ports. A missing firewall
      passes (nothing is open). Exits 1 if any port is open.

The forwarded-header trust in infra/helm/traefik-values.yaml is only sound while the Traefik
NodePorts are reachable from the VPC alone, so the second check backs up the Service's
`kubernetes.digitalocean.com/firewall-managed: "false"` annotation.
"""

from __future__ import annotations

import ipaddress
import json
import sys
from collections.abc import Iterable

RFC1918 = tuple(
    ipaddress.IPv4Network(block) for block in ("10.0.0.0/8", "172.16.0.0/12", "192.168.0.0/16")
)


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


def open_ports(firewalls: list[dict], name: str, ports: Iterable[int]) -> list[int]:
    """Ports from `ports` that any TCP inbound rule of firewall `name` opens."""
    wanted = set(ports)
    found: set[int] = set()
    for firewall in firewalls:
        if firewall.get("name") != name:
            continue
        for rule in firewall.get("inbound_rules") or []:
            if rule.get("protocol") not in ("tcp", "all"):
                continue
            found |= wanted.intersection(_rule_ports(str(rule.get("ports", ""))))
    return sorted(found)


def main(argv: list[str]) -> int:
    if len(argv) == 2 and argv[0] == "private-cidr":
        try:
            print(validate_private_cidr(argv[1]))
        except ValueError as exc:
            print(f"::error::unexpected VPC range: {exc} (want an RFC 1918 CIDR)", file=sys.stderr)
            return 1
        return 0
    if len(argv) >= 3 and argv[0] == "nodeports-not-public":
        firewalls = json.load(sys.stdin)
        if not isinstance(firewalls, list):
            print("::error::expected a JSON list of firewalls on stdin", file=sys.stderr)
            return 1
        exposed = open_ports(firewalls, argv[1], (int(p) for p in argv[2:]))
        if exposed:
            print(
                f"::error::firewall {argv[1]} opens Traefik NodePort(s) {exposed} to the public; "
                "the forwarded-header trust requires VPC-only NodePorts",
                file=sys.stderr,
            )
            return 1
        print(f"firewall {argv[1]}: no public rule for {', '.join(argv[2:])}")
        return 0
    print(__doc__, file=sys.stderr)
    return 2


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
