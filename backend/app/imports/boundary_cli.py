"""Overture boundary loader CLI — the loader entry the Slice-1c workflow ``kubectl exec``s.

Slice 1b of ``docs/plans/2026-07-02-crawlable-seo-pages.md`` (#127). Mirrors ``app.imports.cli``:
reads a DuckDB-fetched ``division_area`` GeoJSON file (spec §11.3), parses it with the pure
``app.imports.boundaries`` layer, and upserts via ``app.imports.boundary_load`` in one committed
transaction. Prints one machine-readable JSON summary line (the CLI result contract); all
diagnostics go through structured logging. Registry/release validation + the S3 fetch live in the
Slice-1c workflow, not here — this CLI only loads a local file it is handed.

Usage:
  python -m app.imports.boundary_cli --path division_area.geojson \
      --overture-release-id 2026-06-17.0 --scope-id US [--dry-run]
"""

from __future__ import annotations

import argparse
import asyncio
import json
import logging

from app.db import get_sessionmaker
from app.imports.boundaries import parse_boundary_geojson
from app.imports.boundary_load import BoundaryLoadSummary, load_boundaries
from app.logging_config import configure_logging

log = logging.getLogger(__name__)


def _parse_file(path: str):
    with open(path, encoding="utf-8") as fh:
        geojson = json.load(fh)
    return parse_boundary_geojson(geojson)


async def run_boundary_load(
    path: str,
    *,
    dry_run: bool,
    release_id: str | None = None,
    scope_id: str | None = None,
) -> BoundaryLoadSummary:
    # Parse on a worker thread — blocking file IO must not run on the event loop.
    parsed = await asyncio.to_thread(_parse_file, path)
    if parsed.skipped:
        # Skips (missing required field / unsluggable name) are a data-quality signal, not a
        # crash — log them so a thin load is diagnosable from logs alone.
        log.warning(
            "boundary_features_skipped",
            extra={"count": len(parsed.skipped), "reasons": _reason_counts(parsed.skipped)},
        )
    maker = get_sessionmaker()
    async with maker() as session:
        summary = await load_boundaries(
            session,
            features=parsed.features,
            dry_run=dry_run,
            release_id=release_id,
            scope_id=scope_id,
        )
        await session.commit()
    return summary


def _reason_counts(skipped: list[tuple[str, str]]) -> dict[str, int]:
    counts: dict[str, int] = {}
    for _, reason in skipped:
        counts[reason] = counts.get(reason, 0) + 1
    return counts


def main(argv: list[str] | None = None) -> int:
    configure_logging()
    p = argparse.ArgumentParser(prog="app.imports.boundary_cli")
    p.add_argument("--path", required=True)
    p.add_argument("--overture-release-id", default=None)
    p.add_argument("--scope-id", default=None)
    p.add_argument("--dry-run", action="store_true")
    a = p.parse_args(argv)
    summary = asyncio.run(
        run_boundary_load(
            a.path,
            dry_run=a.dry_run,
            release_id=a.overture_release_id,
            scope_id=a.scope_id,
        )
    )
    # Diagnostics already went through structured logging (load_boundaries emits the summary).
    # This ONE stdout line is the CLI's machine-readable RESULT contract for operators/CI.
    log.info("boundary_load_cli_done", extra={"dry_run": summary.dry_run})
    print(json.dumps(summary.__dict__, default=str))  # documented CLI result contract
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
