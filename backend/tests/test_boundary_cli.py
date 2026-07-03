"""Slice 1b — boundary loader CLI (crawlable SEO pages, #127).

End-to-end tests for ``app.imports.boundary_cli`` against the real Overture-shaped fixture
(``overture_division_area_sample.geojson`` — a Polygon + a MultiPolygon, a feature with NO OSM
source, and a multi-entry ``sources[]``, per the Slice-1b fixture requirement). The CLI now streams
a **GeoJSONSeq** file (one Feature per line), so each test converts the FeatureCollection fixture to
GeoJSONSeq first — keeping the single sample fixture the source of truth. Mirrors ``test_osm_cli``:
the CLI opens its own session and commits; the test ``session`` fixture reads the committed result.
"""

from __future__ import annotations

import json
from pathlib import Path

import pytest
from sqlalchemy import func, select

from app.imports.boundary_cli import run_boundary_load
from app.models import PlaceBoundary

FIX = Path(__file__).parent / "fixtures" / "overture_division_area_sample.geojson"


def _seqfile(tmp_path: Path) -> str:
    """Write the FeatureCollection fixture's features as GeoJSONSeq (one Feature per line) — the
    format the workflow's DuckDB fetch now emits and the streaming loader consumes."""
    fc = json.loads(FIX.read_text(encoding="utf-8"))
    out = tmp_path / "sample.geojsonl"
    with out.open("w", encoding="utf-8") as fh:
        for feat in fc["features"]:
            fh.write(json.dumps(feat) + "\n")
    return str(out)


async def _count(session) -> int:
    return (await session.execute(select(func.count()).select_from(PlaceBoundary))).scalar_one()


@pytest.mark.asyncio
async def test_cli_dry_run_then_apply(session, tmp_path):
    seq = _seqfile(tmp_path)
    dry = await run_boundary_load(seq, dry_run=True)
    assert dry.dry_run is True
    assert dry.feature_count == 4
    assert dry.inserted_count == 4  # all four would-insert
    assert await _count(session) == 0  # dry-run persists nothing

    applied = await run_boundary_load(seq, dry_run=False)
    assert applied.inserted_count == 4
    assert applied.skipped_invalid_count == 0
    assert await _count(session) == 4


@pytest.mark.asyncio
async def test_cli_apply_is_idempotent(session, tmp_path):
    seq = _seqfile(tmp_path)
    await run_boundary_load(seq, dry_run=False)
    again = await run_boundary_load(seq, dry_run=False)
    assert again.inserted_count == 0
    assert again.updated_count == 4
    assert await _count(session) == 4  # no duplicates on re-load


@pytest.mark.asyncio
async def test_cli_streams_in_batches(session, tmp_path):
    # A batch_size below the feature count exercises the multi-batch / per-batch-commit path — the
    # streaming fix for the country-scale OOM. Totals + persisted rows must equal a single batch.
    seq = _seqfile(tmp_path)
    summary = await run_boundary_load(seq, dry_run=False, batch_size=2)
    assert summary.feature_count == 4
    assert summary.inserted_count == 4
    assert summary.skipped_invalid_count == 0
    assert await _count(session) == 4


@pytest.mark.asyncio
async def test_cli_decodes_provenance_and_lowercases_country(session, tmp_path):
    await run_boundary_load(_seqfile(tmp_path), dry_run=False)
    rows = {r.name: r for r in (await session.execute(select(PlaceBoundary))).scalars().all()}
    # Multi-entry sources[] -> the boundary relation wins (relation > way > node).
    assert rows["San Diego"].osm_type == "relation"
    assert rows["San Diego"].osm_id == 253832
    assert rows["San Diego"].country_code == "us"  # lowercased
    # geoBoundaries-only feature -> nullable OSM provenance.
    assert rows["Kosovo"].osm_type is None and rows["Kosovo"].osm_id is None
    # Diacritic-folded sticky slug.
    assert rows["Lëtzebuerg"].slug == "letzebuerg"


@pytest.mark.asyncio
async def test_cli_rejects_maritime_twin(session, tmp_path):
    # The fixture ships San Diego's maritime twin (class='maritime'); it must never persist.
    await run_boundary_load(_seqfile(tmp_path), dry_run=False)
    maritime_id = "f1e2d3c4-b5a6-9788-6152-4c3b2a1908f7"
    got = (
        await session.execute(select(PlaceBoundary).where(PlaceBoundary.overture_id == maritime_id))
    ).scalar_one_or_none()
    assert got is None
    assert await _count(session) == 4  # only the four land features
