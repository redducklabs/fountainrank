#!/usr/bin/env bash
# Install/upgrade Traefik with forwarded-header trust for the cluster VPC, fail-closed.
# Run by .github/workflows/deploy.yml (docs/plans/2026-11-20-ingress-nginx-to-traefik.md).
#
# Traefik trusts X-Forwarded-* from the cluster VPC range (the DO LB + nodes). That is only sound
# while its NodePorts 31080/31443 are VPC-only: with externalTrafficPolicy Cluster a public caller
# can be SNATed to a node IP inside the VPC range. So, in order:
#   1. fetch the pinned chart once (the same local copy serves the install and any withdrawal),
#   2. resolve the cluster id + VPC range (an IPv4 network inside an RFC 1918 block),
#   3. check that no Cloud Firewall lets a public source reach 31080/31443 on any node,
#   4. helm upgrade --install with that trust,
#   5. check the live Service opted out of the DOKS-managed public firewall, and re-check (3).
# ANY failure withdraws the trust from whatever Traefik is running before exiting non-zero, and
# verifies it against the live Deployment, escalating until it holds:
#   a. helm upgrade --reuse-values with both trustedIPs = [] (the chart then renders no trust
#      flags; Traefik overwrites X-Forwarded-* itself, only the client IP degrades),
#   b. if that fails or doesn't take: strip the trust flags from the live Deployment directly,
#   c. if that fails too: scale Traefik to 0 (an outage beats forgeable forwarded headers).
# Inputs (env): CLUSTER_NAME. Optional: PYTHON (default python3), RUNNER_TEMP.
set -euo pipefail

: "${CLUSTER_NAME:?CLUSTER_NAME is required}"
PYTHON="${PYTHON:-python3}"
TMP_DIR="${RUNNER_TEMP:-${TMPDIR:-/tmp}}"
GUARDS="$(dirname "$0")/traefik_guards.py"
CHART_REPO="https://traefik.github.io/charts"
CHART_VERSION="42.4.1"
CHART_TGZ=""
NAMESPACE="traefik"
PORTS=(31080 31443)
TRUST_FLAGS='forwardedHeaders\.(trustedIPs|insecure)'

# Prints `contained` (no Deployment, no trust flags in its pod template, or scaled to zero),
# `trusted`, or `unknown` (the API couldn't be read).
trust_state() {
  local out
  out="$(kubectl --namespace "$NAMESPACE" get deployment traefik --ignore-not-found -o json)" \
    || { echo unknown; return 0; }
  if [ -z "$out" ]; then echo contained; return 0; fi
  jq -r --arg re "$TRUST_FLAGS" '
    ([.spec.template.spec.containers[].args[]? | select(test($re))] | length) as $flags
    | if $flags == 0 or ((.spec.replicas == 0) and ((.status.replicas // 0) == 0))
      then "contained" else "trusted" end' <<<"$out" || echo unknown
}

withdraw_trust() {
  local state
  state="$(trust_state)"
  if [ "$state" = contained ]; then
    echo "No forwarded-header trust is live: nothing to withdraw."
    return 0
  fi
  echo "::warning::Withdrawing Traefik's forwarded-header trust (state: $state)."
  if [ -n "$CHART_TGZ" ]; then
    printf '%s\n' 'ports:' '  web:' '    forwardedHeaders:' '      trustedIPs: []' \
      '  websecure:' '    forwardedHeaders:' '      trustedIPs: []' \
      > "$TMP_DIR/traefik-no-trust.yaml"
    if helm upgrade traefik "$CHART_TGZ" --namespace "$NAMESPACE" --reuse-values \
      --values "$TMP_DIR/traefik-no-trust.yaml" --wait --timeout 5m \
      && [ "$(trust_state)" = contained ]; then
      echo "Trust withdrawn via helm."
      return 0
    fi
    echo "::warning::helm could not withdraw the trust; patching the live Deployment."
  fi
  local deploy
  if deploy="$(kubectl --namespace "$NAMESPACE" get deployment traefik -o json)" \
    && jq --arg re "$TRUST_FLAGS" \
      '.spec.template.spec.containers |= map(.args |= ((. // []) | map(select(test($re) | not))))' \
      <<<"$deploy" | kubectl replace -f - \
    && kubectl --namespace "$NAMESPACE" rollout status deployment traefik --timeout 5m \
    && [ "$(trust_state)" = contained ]; then
    echo "Trust withdrawn by patching the Deployment (the next deploy reconciles it via helm)."
    return 0
  fi
  echo "::error::could not strip the trust flags; scaling Traefik to 0 as a last resort."
  if kubectl --namespace "$NAMESPACE" scale deployment traefik --replicas=0 \
    && kubectl --namespace "$NAMESPACE" rollout status deployment traefik --timeout 5m \
    && [ "$(trust_state)" = contained ]; then
    echo "::error::Traefik is scaled to 0: it serves no traffic until the next good deploy."
    return 0
  fi
  echo "::error::COULD NOT CONTAIN Traefik's forwarded-header trust; act on the cluster now."
  return 1
}

fail() {
  echo "::error::$1"
  withdraw_trust || true
  exit 1
}

# 1. The pinned chart, fetched once.
mkdir -p "$TMP_DIR/traefik-chart"
helm pull traefik --repo "$CHART_REPO" --version "$CHART_VERSION" \
  --destination "$TMP_DIR/traefik-chart" \
  || fail "could not fetch chart traefik $CHART_VERSION"
CHART_TGZ="$TMP_DIR/traefik-chart/traefik-$CHART_VERSION.tgz"
[ -f "$CHART_TGZ" ] || { CHART_TGZ=""; fail "chart traefik-$CHART_VERSION.tgz missing after pull"; }

# 2. Cluster id + VPC range.
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

# 3. No public path to the NodePorts before trust goes live.
"$PYTHON" "$GUARDS" nodeports-not-public "$CLUSTER_NAME" "$cluster_id" "${PORTS[@]}" \
  || fail "Traefik NodePorts are reachable from a public source (before install)"

# 4. Install/upgrade with the VPC trust.
helm upgrade --install traefik "$CHART_TGZ" \
  --namespace "$NAMESPACE" --create-namespace \
  --values infra/helm/traefik-values.yaml \
  --set "ports.web.forwardedHeaders.trustedIPs={$vpc_cidr}" \
  --set "ports.websecure.forwardedHeaders.trustedIPs={$vpc_cidr}" \
  --wait \
  || fail "helm upgrade --install traefik failed"

# 5. Re-verify against the live objects.
managed="$(kubectl --namespace "$NAMESPACE" get service traefik \
  -o jsonpath='{.metadata.annotations.kubernetes\.digitalocean\.com/firewall-managed}')" \
  || managed="<unreadable>"
if [ "$managed" != "false" ]; then
  fail "traefik Service is not firewall-managed=\"false\" (got '$managed')"
fi
"$PYTHON" "$GUARDS" nodeports-not-public "$CLUSTER_NAME" "$cluster_id" "${PORTS[@]}" \
  || fail "Traefik NodePorts are reachable from a public source (after install)"
echo "Traefik installed; NodePorts ${PORTS[*]} are VPC-only; trusting $vpc_cidr."
