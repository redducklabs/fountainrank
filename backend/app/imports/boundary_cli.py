"""Overture boundary loader CLI — the loader entry the Slice-1c workflow ``kubectl exec``s.

Slice 1b of ``docs/plans/2026-07-02-crawlable-seo-pages.md`` (#127), streaming-hardened after the
first real US dispatch OOM-killed the pod. Reads a DuckDB-fetched ``division_area`` **GeoJSONSeq**
file (one GeoJSON Feature per line — spec §11.3) and upserts it via ``app.imports.boundary_load`` in
**committed batches**, so a country-scale file (US ~35k full-resolution polygons) is never fully
materialized in memory. Prints one machine-readable JSON summary line (the CLI result contract); all
diagnostics go through structured logging. Registry/release validation + the S3 fetch live in the
Slice-1c workflow, not here — this CLI only streams a local file it is handed.

Usage:
  python -m app.imports.boundary_cli --path division_area.geojsonl \
      --overture-release-id 2026-06-17.0 --scope-id overture:us [--dry-run]
"""

from __future__ import annotations

import argparse
import asyncio
import json
import logging
from typing import TextIO

from app.db import get_sessionmaker
from app.imports.boundaries import BoundaryFeature, parse_boundary_feature
from app.imports.boundary_load import (
    BoundaryLoadSummary,
    apply_boundary_feature,
    log_boundary_load_complete,
)
from app.logging_config import configure_logging
from app.membership import refresh_all_memberships

log = logging.getLogger(__name__)

# Features per committed batch. Bounds peak memory (only one batch of parsed features + their
# geometries is resident) and transaction size on country-scale loads (US ~35k) that previously
# OOM-killed the loader pod. The idempotent overture_id upsert makes a partially-committed load
# safe to re-run.
_BATCH_SIZE = 1000


def _read_batch(fh: TextIO, batch_size: int, skip_counts: dict[str, int]) -> list[BoundaryFeature]:
    """Read up to ``batch_size`` valid features from a GeoJSONSeq stream (one Feature per line).

    Runs off the event loop (via ``asyncio.to_thread``) so blocking file IO never stalls it. Skips
    (missing field / non-land / unsluggable name) are tallied by reason into ``skip_counts`` rather
    than retained. Returns ``[]`` at EOF. The file object is its own iterator, so successive calls
    resume where the previous one left off.
    """
    batch: list[BoundaryFeature] = []
    for line in fh:
        # DuckDB's GeoJSONSeq is newline-delimited with no record-separator byte; lstrip 0x1e
        # defensively in case a future GDAL writes RFC 8142 sequences.
        line = line.strip().lstrip("\x1e").strip()
        if not line:
            continue
        feature, skip = parse_boundary_feature(json.loads(line))
        if feature is None:
            _, reason = skip
            skip_counts[reason] = skip_counts.get(reason, 0) + 1
        else:
            batch.append(feature)
            if len(batch) >= batch_size:
                break
    return batch


async def run_boundary_load(
    path: str,
    *,
    dry_run: bool,
    release_id: str | None = None,
    scope_id: str | None = None,
    batch_size: int = _BATCH_SIZE,
    refresh_membership: bool = True,
) -> BoundaryLoadSummary:
    """Stream a GeoJSONSeq ``division_area`` file into ``place_boundaries`` in committed batches.

    Reads one line at a time so a country-scale file (US ~35k full-resolution polygons) never has to
    be fully materialized — the previous whole-file ``json.load`` OOM-killed the loader pod.

    After a successful non-dry-run load, re-derives precomputed fountain membership + counts +
    ``is_canonical`` / ``parent_id`` over the whole DB (#127 Slice 1d — "deterministic refresh on
    boundary load"), unless ``refresh_membership`` is False (e.g. loading several countries then
    refreshing once via ``app.imports.membership_cli``). Skipped on dry-run.
    """
    skip_counts: dict[str, int] = {}
    summary = BoundaryLoadSummary(dry_run=dry_run)
    maker = get_sessionmaker()
    # Open/read/close all run off the event loop (ASYNC230) — passing `open` as a reference to
    # to_thread keeps blocking file IO out of the loop, as the pre-streaming loader did.
    fh = await asyncio.to_thread(open, path, encoding="utf-8")
    try:
        async with maker() as session:
            while True:
                batch = await asyncio.to_thread(_read_batch, fh, batch_size, skip_counts)
                if not batch:
                    break
                for feature in batch:
                    await apply_boundary_feature(session, feature, dry_run=dry_run, summary=summary)
                # Commit per batch: bounds transaction size; the idempotent upsert makes a partially
                # committed load safe to re-run. A dry-run's SQL writes nothing, so this is a no-op.
                await session.commit()
            if refresh_membership and not dry_run:
                # All boundaries are now committed — re-derive fountain membership in one set-based
                # pass and commit it as its own transaction (its own structured summary log).
                await refresh_all_memberships(session)
                await session.commit()
    finally:
        await asyncio.to_thread(fh.close)
    if skip_counts:
        # Skips are a data-quality signal, not a crash — log them so a thin load is diagnosable
        # from logs alone.
        log.warning(
            "boundary_features_skipped",
            extra={"count": sum(skip_counts.values()), "reasons": skip_counts},
        )
    log_boundary_load_complete(summary, release_id=release_id, scope_id=scope_id)
    return summary


def main(argv: list[str] | None = None) -> int:
    configure_logging()
    p = argparse.ArgumentParser(prog="app.imports.boundary_cli")
    p.add_argument("--path", required=True)
    p.add_argument("--overture-release-id", default=None)
    p.add_argument("--scope-id", default=None)
    p.add_argument("--dry-run", action="store_true")
    # Opt out of the post-load membership refresh (#127 Slice 1d) — e.g. load several countries
    # then refresh once with app.imports.membership_cli. Default: refresh after every non-dry load.
    p.add_argument("--skip-membership-refresh", action="store_true")
    a = p.parse_args(argv)
    summary = asyncio.run(
        run_boundary_load(
            a.path,
            dry_run=a.dry_run,
            release_id=a.overture_release_id,
            scope_id=a.scope_id,
            refresh_membership=not a.skip_membership_refresh,
        )
    )
    # Diagnostics already went through structured logging (run_boundary_load emits the summary).
    # This ONE stdout line is the CLI's machine-readable RESULT contract for operators/CI.
    log.info("boundary_load_cli_done", extra={"dry_run": summary.dry_run})
    print(json.dumps(summary.__dict__, default=str))  # documented CLI result contract
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
