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


def _validate_source_identity(scope: RunScope) -> None:
    # Persist only non-secret labels/ids (spec §5.4). A credentialed/raw URL in any
    # identity field would land in osm_fountain_import_runs / fountain_provenances; refuse it.
    for name, value in (
        ("system", scope.source_system),
        ("dataset", scope.source_dataset),
        ("build-id", scope.source_build_id),
        ("label", scope.source_label),
        ("scope-id", scope.scope_id),
    ):
        if value and "://" in value:
            raise ValueError(
                f"--{name} looks like a URL; pass a non-secret label/id only "
                f"(strip URLs/credentials per the runbook)"
            )


def _resolve_scope_bounds_wkt(inline: str | None, file_path: str | None) -> str | None:
    # A large (country/continent) polygon can exceed `kubectl exec` ARG_MAX as a CLI arg, so the
    # PBF path streams the WKT into a file and passes --scope-bounds-wkt-file. The two are mutually
    # exclusive.
    if inline is not None and file_path is not None:
        raise ValueError("pass only one of --scope-bounds-wkt / --scope-bounds-wkt-file")
    if file_path is not None:
        with open(file_path, encoding="utf-8") as fh:
            return fh.read().strip() or None
    return inline


async def run_import(
    path: str, *, scope: RunScope, dry_run: bool, require_scope_bounds: bool = False
) -> RunSummary:
    _validate_source_identity(scope)
    # Fail-closed guard (spec §5): merge._mark_scope_removals removes across the WHOLE scope_id with
    # NO spatial guard when scope_bounds is absent. A non-dry-run without a validated polygon must
    # never reach the DB — refuse before any write. Callers that don't require it (existing small
    # bbox imports/tests) are unaffected.
    if require_scope_bounds and not dry_run and not (scope.scope_bounds_wkt or "").strip():
        raise ValueError(
            "scope_bounds is required for a non-dry-run import but none was provided "
            "(--require-scope-bounds)"
        )
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
    p.add_argument("--scope-bounds-wkt-file", default=None)
    p.add_argument("--require-scope-bounds", action="store_true")
    p.add_argument("--dry-run", action="store_true")
    a = p.parse_args(argv)
    scope = RunScope(
        source_system=a.system,
        source_dataset=a.dataset,
        source_build_id=a.build_id,
        source_label=a.label,
        scope_id=a.scope_id,
        scope_bounds_wkt=_resolve_scope_bounds_wkt(a.scope_bounds_wkt, a.scope_bounds_wkt_file),
    )
    summary = asyncio.run(
        run_import(
            a.path, scope=scope, dry_run=a.dry_run, require_scope_bounds=a.require_scope_bounds
        )
    )
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
