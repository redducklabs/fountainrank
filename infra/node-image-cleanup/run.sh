#!/bin/sh
# Container entrypoint for the node-image-cleanup DaemonSet. Runs host-cleanup.sh in the
# node's mount namespace once at start, then every INTERVAL_SECONDS. A failed pass is
# logged and retried on the next interval; it never crashes the pod into a restart loop.
set -u

: "${IMAGE_PREFIX:?IMAGE_PREFIX required}"
: "${MIN_AGE_SECONDS:?MIN_AGE_SECONDS required}"
: "${INTERVAL_SECONDS:?INTERVAL_SECONDS required}"
# Default to dry run: going live must be an explicit DRY_RUN=0 in the manifest.
DRY_RUN="${DRY_RUN:-1}"

# PID 1 gets no default SIGTERM handling; exit promptly on pod termination.
trap 'echo "node-image-cleanup: terminating"; exit 0' TERM INT

echo "node-image-cleanup: start node=${NODE_NAME:-unknown} prefix=$IMAGE_PREFIX min_age=${MIN_AGE_SECONDS}s interval=${INTERVAL_SECONDS}s dry_run=$DRY_RUN"
while :; do
  rc=0
  nsenter -t 1 -m -- sh -s -- "$IMAGE_PREFIX" "$MIN_AGE_SECONDS" "$DRY_RUN" \
    < /scripts/host-cleanup.sh || rc=$?
  if [ "$rc" -ne 0 ]; then
    echo "node-image-cleanup: pass FAILED (exit $rc); retrying next interval" >&2
  fi
  sleep "$INTERVAL_SECONDS" &
  wait $!
done
