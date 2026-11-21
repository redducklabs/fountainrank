#!/bin/sh
# Removes stale FountainRank app images from a DOKS node's containerd store.
#
# Runs in the HOST mount namespace (piped in via `nsenter -t 1 -m -- sh -s`) so it
# uses the node's own `ctr`. Every deploy pulls new fountainrank-web/-backend
# images (~0.7 GB unpacked each); old tags are never removed because kubelet's
# image GC only starts at 85% disk and DOKS does not let us lower that.
#
# An image is removed only when ALL of these hold:
#   - its ref starts with IMAGE_PREFIX (our own registry; system images are never touched)
#   - its manifest digest is not used by any container on the node (running OR exited)
#   - it was pulled more than MIN_AGE_SECONDS ago (protects a deploy mid-rollout)
# Known, accepted race: on a rollback to an older image that is still cached, a pass that
# lands between the old pod's deletion and the new container's creation removes the image;
# kubelet then re-pulls it (a brief CreateContainerError), nothing worse.
# The untagged `sha256:<id>` refs CRI keeps for those same digests are removed too,
# otherwise they keep the layers alive.
#
# Usage: sh host-cleanup.sh <image-prefix> <min-age-seconds> <dry-run 0|1>
set -eu

PREFIX="${1:?image prefix required}"
MIN_AGE="${2:?min age seconds required}"
DRY_RUN="${3:-1}"

NS=k8s.io
BLOBS=/var/lib/containerd/io.containerd.content.v1.content/blobs/sha256

case "$PREFIX" in
  */*/) ;;
  *) echo "refusing: prefix '$PREFIX' must look like registry/namespace/" >&2; exit 2 ;;
esac

tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT

log() { echo "node-image-cleanup: $*"; }

log "disk before: $(df -h --output=pcent,avail /var/lib/containerd | tail -1)"

ctr -n "$NS" images ls > "$tmp/images"
ctr -n "$NS" containers ls > "$tmp/containers"

# Image refs used by any container (running or exited), then the digests behind them.
awk 'NR > 1 { print $2 }' "$tmp/containers" | sort -u > "$tmp/inuse_refs"
awk 'NR == FNR { u[$1] = 1; next } FNR > 1 && ($1 in u) { print $3 }' \
  "$tmp/inuse_refs" "$tmp/images" | sort -u > "$tmp/inuse_digests"

# Fail closed: every container's image ref must resolve to an image row, otherwise that
# container's digest would be missing from the in-use set. Never delete on a guess.
awk 'NR == FNR { if (FNR > 1) r[$1] = 1; next } !($1 in r) { print }' \
  "$tmp/images" "$tmp/inuse_refs" > "$tmp/unresolved"
if [ ! -s "$tmp/inuse_digests" ] || [ -s "$tmp/unresolved" ]; then
  log "in-use image refs did not all resolve; refusing to remove anything:" >&2
  sed 's/^/  /' "$tmp/unresolved" >&2
  exit 1
fi

now="$(date +%s)"
: > "$tmp/rm_refs"
: > "$tmp/rm_digests"
awk -v p="$PREFIX" 'FNR > 1 && index($1, p) == 1 { print $1, $3 }' "$tmp/images" |
  while read -r ref digest; do
    if grep -qxF "$digest" "$tmp/inuse_digests"; then continue; fi
    blob="$BLOBS/${digest#sha256:}"
    mtime="$(stat -c %Y "$blob" 2>/dev/null || echo "$now")"
    if [ $((now - mtime)) -lt "$MIN_AGE" ]; then continue; fi
    echo "$ref" >> "$tmp/rm_refs"
    echo "$digest" >> "$tmp/rm_digests"
  done

# CRI's untagged id refs for the digests being removed.
awk 'NR == FNR { d[$1] = 1; next } FNR > 1 && $1 ~ /^sha256:/ && ($3 in d) { print $1 }' \
  "$tmp/rm_digests" "$tmp/images" >> "$tmp/rm_refs"

count="$(wc -l < "$tmp/rm_refs" | tr -d ' ')"
if [ "$count" -eq 0 ]; then
  log "nothing to remove"
  exit 0
fi

if [ "$DRY_RUN" = "1" ]; then
  log "dry run: would remove $count refs:"
  sed 's/^/  /' "$tmp/rm_refs"
  exit 0
fi

# One ref at a time so a ref that vanished meanwhile (e.g. kubelet GC) is logged and
# skipped instead of aborting the pass.
log "removing $count refs:"
failed=0
while read -r ref; do
  if ctr -n "$NS" images rm --sync "$ref" > /dev/null 2>&1; then
    echo "  removed $ref"
  else
    echo "  FAILED to remove $ref" >&2
    failed=$((failed + 1))
  fi
done < "$tmp/rm_refs"
log "disk after: $(df -h --output=pcent,avail /var/lib/containerd | tail -1); failed=$failed"
