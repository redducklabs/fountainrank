#!/usr/bin/env bash
# Install/upgrade Traefik with forwarded-header trust for the cluster VPC, fail-closed.
# Run by .github/workflows/deploy.yml (docs/plans/2026-11-20-ingress-nginx-to-traefik.md).
#
# Traefik trusts X-Forwarded-* from the cluster VPC range (the DO LB + nodes). That is only sound
# while its NodePorts 31080/31443 are VPC-only: with externalTrafficPolicy Cluster a public caller
# can be SNATed to a node IP inside the VPC range. So, in order:
#   1. resolve the cluster id + VPC range (an IPv4 network inside an RFC 1918 block),
#   2. check that no Cloud Firewall lets a public source reach 31080/31443 on any node,
#   3. helm upgrade --install with that trust,
#   4. check the live Service opted out of the DOKS-managed public firewall, and re-check (2).
# ANY failure, at any step, withdraws the trust from an existing release (both trustedIPs set to
# [], so Traefik overwrites X-Forwarded-* itself; only the client IP degrades to the LB/node
# address) before the script exits non-zero. A deploy never leaves trust in place unverified.
#
# Inputs (env): CLUSTER_NAME. Optional: PYTHON (default python3), RUNNER_TEMP.
set -euo pipefail

: "${CLUSTER_NAME:?CLUSTER_NAME is required}"
PYTHON="${PYTHON:-python3}"
TMP_DIR="${RUNNER_TEMP:-${TMPDIR:-/tmp}}"
GUARDS="$(dirname "$0")/traefik_guards.py"
CHART_REPO="https://traefik.github.io/charts"
CHART_VERSION="42.4.1"
NAMESPACE="traefik"
PORTS=(31080 31443)

withdraw_trust() {
  if ! helm status traefik --namespace "$NAMESPACE" >/dev/null 2>&1; then
    echo "No traefik release installed: no trust to withdraw."
    return 0
  fi
  echo "Withdrawing Traefik's forwarded-header trust (trustedIPs -> [])."
  printf '%s\n' 'ports:' '  web:' '    forwardedHeaders:' '      trustedIPs: []' \
    '  websecure:' '    forwardedHeaders:' '      trustedIPs: []' \
    > "$TMP_DIR/traefik-no-trust.yaml"
  helm upgrade traefik traefik \
    --repo "$CHART_REPO" \
    --version "$CHART_VERSION" \
    --namespace "$NAMESPACE" \
    --reuse-values \
    --values "$TMP_DIR/traefik-no-trust.yaml" \
    --wait \
    || echo "::error::could not withdraw Traefik's forwarded-header trust; re-run the deploy once the cause is fixed"
}

fail() {
  echo "::error::$1"
  withdraw_trust
  exit 1
}

# 1. Cluster id + VPC range.
cluster_json="$(doctl kubernetes cluster get "$CLUSTER_NAME" --output json)" \
  || fail "could not read cluster $CLUSTER_NAME"
cluster_id="$(jq -r 'if type == "array" then .[0] else . end | .id // empty' <<<"$cluster_json")" \
  || fail "could not parse cluster $CLUSTER_NAME"
vpc_uuid="$(jq -r 'if type == "array" then .[0] else . end | .vpc_uuid // empty' <<<"$cluster_json")" \
  || fail "could not parse cluster $CLUSTER_NAME"
if [ -z "$cluster_id" ] || [ -z "$vpc_uuid" ]; then
  fail "could not resolve the id/VPC of $CLUSTER_NAME"
fi
vpc_json="$(doctl vpcs get "$vpc_uuid" --output json)" || fail "could not read VPC $vpc_uuid"
vpc_range="$(jq -r 'if type == "array" then .[0] else . end | .ip_range // empty' <<<"$vpc_json")" \
  || fail "could not parse VPC $vpc_uuid"
vpc_cidr="$("$PYTHON" "$GUARDS" private-cidr "$vpc_range")" \
  || fail "unexpected VPC range '$vpc_range' for $CLUSTER_NAME"
echo "Cluster $cluster_id VPC $vpc_uuid range $vpc_cidr"

# 2. No public path to the NodePorts before trust goes live.
"$PYTHON" "$GUARDS" nodeports-not-public "$CLUSTER_NAME" "$cluster_id" "${PORTS[@]}" \
  || fail "Traefik NodePorts are reachable from a public source (before install)"

# 3. Install/upgrade with the VPC trust.
helm upgrade --install traefik traefik \
  --repo "$CHART_REPO" \
  --version "$CHART_VERSION" \
  --namespace "$NAMESPACE" --create-namespace \
  --values infra/helm/traefik-values.yaml \
  --set "ports.web.forwardedHeaders.trustedIPs={$vpc_cidr}" \
  --set "ports.websecure.forwardedHeaders.trustedIPs={$vpc_cidr}" \
  --wait \
  || fail "helm upgrade --install traefik failed"

# 4. Re-verify against the live objects.
managed="$(kubectl --namespace "$NAMESPACE" get service traefik \
  -o jsonpath='{.metadata.annotations.kubernetes\.digitalocean\.com/firewall-managed}')" \
  || managed="<unreadable>"
if [ "$managed" != "false" ]; then
  fail "traefik Service is not firewall-managed=\"false\" (got '$managed')"
fi
"$PYTHON" "$GUARDS" nodeports-not-public "$CLUSTER_NAME" "$cluster_id" "${PORTS[@]}" \
  || fail "Traefik NodePorts are reachable from a public source (after install)"
echo "Traefik installed; NodePorts ${PORTS[*]} are VPC-only; trusting $vpc_cidr."
