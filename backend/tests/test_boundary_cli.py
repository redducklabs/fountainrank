"""Slice 1b — boundary loader CLI (crawlable SEO pages, #127).

End-to-end tests for ``app.imports.boundary_cli`` against the real Overture-shaped fixture
(``overture_division_area_sample.geojson`` — a Polygon + a MultiPolygon, a feature with NO OSM
source, and a multi-entry ``sources[]``, per the Slice-1b fixture requirement). Mirrors
``test_osm_cli`` — the CLI opens its own session and commits; the test ``session`` fixture reads
the committed result.
"""

from __future__ import annotations

from pathlib import Path

import pytest
from sqlalchemy import func, select

from app.imports.boundary_cli import run_boundary_load
from app.models import PlaceBoundary

FIX = Path(__file__).parent / "fixtures" / "overture_division_area_sample.geojson"


async def _count(session) -> int:
    return (await session.execute(select(func.count()).select_from(PlaceBoundary))).scalar_one()


@pytest.mark.asyncio
async def test_cli_dry_run_then_apply(session):
    dry = await run_boundary_load(str(FIX), dry_run=True)
    assert dry.dry_run is True
    assert dry.feature_count == 4
    assert dry.inserted_count == 4  # all four would-insert
    assert await _count(session) == 0  # dry-run persists nothing

    applied = await run_boundary_load(str(FIX), dry_run=False)
    assert applied.inserted_count == 4
    assert applied.skipped_invalid_count == 0
    assert await _count(session) == 4


@pytest.mark.asyncio
async def test_cli_apply_is_idempotent(session):
    await run_boundary_load(str(FIX), dry_run=False)
    again = await run_boundary_load(str(FIX), dry_run=False)
    assert again.inserted_count == 0
    assert again.updated_count == 4
    assert await _count(session) == 4  # no duplicates on re-load


@pytest.mark.asyncio
async def test_cli_decodes_provenance_and_lowercases_country(session):
    await run_boundary_load(str(FIX), dry_run=False)
    rows = {r.name: r for r in (await session.execute(select(PlaceBoundary))).scalars().all()}
    # Multi-entry sources[] -> the boundary relation wins (relation > way > node).
    assert rows["San Diego"].osm_type == "relation"
    assert rows["San Diego"].osm_id == 253832
    assert rows["San Diego"].country_code == "us"  # lowercased
    # geoBoundaries-only feature -> nullable OSM provenance.
    assert rows["Kosovo"].osm_type is None and rows["Kosovo"].osm_id is None
    # Diacritic-folded sticky slug.
    assert rows["Lëtzebuerg"].slug == "letzebuerg"
