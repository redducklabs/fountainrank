"""OSM fountain importer CLI.

Usage:
  python -m app.imports.cli --path extract.geojson --scope-id us/ca \
      --dataset geofabrik:us/california --build-id 2026-06-21 --label "California" [--dry-run]

Parses a GeoJSON extract, merges candidates (apply or dry-run), prints a JSON run summary.
Never logs secrets or raw source URLs (spec §10).
"""

from __future__ import annotations

import argparse
import asyncio
import json
import logging

from app.config import get_settings
from app.db import get_sessionmaker
from app.imports.merge import RunScope, RunSummary, merge_candidates
from app.imports.osm import ParseResult, parse_osm_geojson
from app.logging_config import configure_logging

log = logging.getLogger(__name__)


def _parse_file(path: str) -> ParseResult:
    s = get_settings()
    with open(path, encoding="utf-8") as fh:
        geojson = json.load(fh)
    return parse_osm_geojson(
        geojson,
        max_key_len=s.osm_tag_max_key_len,
        max_value_len=s.osm_tag_max_value_len,
        max_tags_bytes=s.osm_tags_max_bytes,
    )


async def run_import(path: str, *, scope: RunScope, dry_run: bool) -> RunSummary:
    # Parse on a worker thread — blocking file IO must not run on the event loop.
    parsed = await asyncio.to_thread(_parse_file, path)
    maker = get_sessionmaker()
    async with maker() as session:
        summary = await merge_candidates(
            session,
            scope=scope,
            candidates=parsed.candidates,
            skipped=parsed.skipped,
            dry_run=dry_run,
        )
        await session.commit()
    return summary


def main(argv: list[str] | None = None) -> int:
    configure_logging()
    p = argparse.ArgumentParser(prog="app.imports.cli")
    p.add_argument("--path", required=True)
    p.add_argument("--scope-id", required=True)
    p.add_argument("--dataset", required=True)
    p.add_argument("--build-id", required=True)
    p.add_argument("--label", required=True)
    p.add_argument("--system", default="osm")
    p.add_argument("--scope-bounds-wkt", default=None)
    p.add_argument("--dry-run", action="store_true")
    a = p.parse_args(argv)
    scope = RunScope(
        source_system=a.system,
        source_dataset=a.dataset,
        source_build_id=a.build_id,
        source_label=a.label,
        scope_id=a.scope_id,
        scope_bounds_wkt=a.scope_bounds_wkt,
    )
    summary = asyncio.run(run_import(a.path, scope=scope, dry_run=a.dry_run))
    # Diagnostics already went through structured logging (merge_candidates emits the run
    # summary). This ONE stdout line is the CLI's machine-readable RESULT contract for
    # operators/CI — intentionally not a diagnostic print.
    log.info(
        "osm_import_cli_done", extra={"run_id": str(summary.run_id), "dry_run": summary.dry_run}
    )
    print(json.dumps(summary.__dict__, default=str))  # documented CLI result contract
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
