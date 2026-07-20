"""Slice 1b — boundary loader DB behavior (crawlable SEO pages, #127).

Integration tests for ``app.imports.boundary_load.load_boundaries`` against the local PostGIS
container (the CI mirror). Covers the load contract from spec §11.3–§11.6: idempotent upsert
keyed on ``overture_id``; ``ST_Multi`` coercion of a raw ``Polygon`` into the ``MULTIPOLYGON``
column; the ``ST_MakeValid`` + reject-still-invalid guard; the **sticky slug** (assigned once,
kept across a rename); and that duplicate ``(country_code, slug)`` non-canonical rows coexist
(canonical selection is Slice 1d).
"""

from __future__ import annotations

import pytest
from sqlalchemy import func, select, text

from app.imports.boundaries import BoundaryFeature, slugify
from app.imports.boundary_load import load_boundaries
from app.models import PlaceBoundary

_POLY = {"type": "Polygon", "coordinates": [[[0, 0], [2, 0], [2, 2], [0, 2], [0, 0]]]}
_MULTIPOLY = {
    "type": "MultiPolygon",
    "coordinates": [[[[0, 0], [2, 0], [2, 2], [0, 2], [0, 0]]]],
}
# A degenerate "polygon" (collinear ring, zero area) — ST_MakeValid cannot recover a polygon.
_DEGENERATE = {"type": "Polygon", "coordinates": [[[0, 0], [1, 1], [2, 2], [0, 0]]]}


def _feat(
    overture_id="ov-1",
    name="San Diego",
    subtype="locality",
    country_code="us",
    geometry=None,
    admin_level=None,
    osm_type="relation",
    osm_id=253832,
):
    return BoundaryFeature(
        overture_id=overture_id,
        subtype=subtype,
        place_class="land",
        admin_level=admin_level,
        osm_type=osm_type,
        osm_id=osm_id,
        name=name,
        country_code=country_code,
        slug=slugify(name),
        geometry=_POLY if geometry is None else geometry,
    )


async def _count(session) -> int:
    return (await session.execute(select(func.count()).select_from(PlaceBoundary))).scalar_one()


@pytest.mark.asyncio
async def test_load_polygon_coerces_to_multipolygon(session):
    summary = await load_boundaries(session, features=[_feat(geometry=_POLY)])
    await session.commit()
    assert summary.feature_count == 1
    assert summary.inserted_count == 1
    assert summary.updated_count == 0
    assert summary.skipped_invalid_count == 0
    # The raw Polygon must land in the MULTIPOLYGON column as a MultiPolygon.
    gtype = (
        await session.execute(text("SELECT GeometryType(boundary::geometry) FROM place_boundaries"))
    ).scalar_one()
    assert gtype == "MULTIPOLYGON"


@pytest.mark.asyncio
async def test_load_multipolygon(session):
    summary = await load_boundaries(session, features=[_feat(geometry=_MULTIPOLY)])
    await session.commit()
    assert summary.inserted_count == 1
    assert await _count(session) == 1


@pytest.mark.asyncio
async def test_load_is_idempotent_on_overture_id(session):
    await load_boundaries(session, features=[_feat()])
    await session.commit()
    summary2 = await load_boundaries(session, features=[_feat()])
    await session.commit()
    # Second load of the same overture_id updates in place — no duplicate row.
    assert summary2.inserted_count == 0
    assert summary2.updated_count == 1
    assert await _count(session) == 1


@pytest.mark.asyncio
async def test_slug_is_sticky_across_rename(session):
    await load_boundaries(session, features=[_feat(name="San Diego")])
    await session.commit()
    # Same overture_id, renamed. slug stays; name updates (spec §4.3 sticky slug).
    await load_boundaries(session, features=[_feat(name="San Diego Reborn")])
    await session.commit()
    row = (await session.execute(select(PlaceBoundary))).scalar_one()
    assert row.slug == "san-diego"  # sticky — NOT "san-diego-reborn"
    assert row.name == "San Diego Reborn"  # other fields refresh


@pytest.mark.asyncio
async def test_duplicate_country_slug_noncanonical_coexist(session):
    # Two different divisions collide on (country_code, slug); both load as is_canonical=false
    # (the partial unique index only constrains canonical rows — spec §11.5/§11.6).
    a = _feat(overture_id="ov-a", name="Springfield", subtype="locality", geometry=_POLY)
    b = _feat(overture_id="ov-b", name="Springfield", subtype="county", geometry=_MULTIPOLY)
    summary = await load_boundaries(session, features=[a, b])
    await session.commit()
    assert summary.inserted_count == 2
    slugs = (await session.execute(select(PlaceBoundary.slug, PlaceBoundary.is_canonical))).all()
    assert {s for s, _ in slugs} == {"springfield"}
    assert all(canon is False for _, canon in slugs)


@pytest.mark.asyncio
async def test_invalid_geometry_is_flagged_not_inserted(session):
    summary = await load_boundaries(session, features=[_feat(geometry=_DEGENERATE)])
    await session.commit()
    assert summary.inserted_count == 0
    assert summary.skipped_invalid_count == 1
    assert await _count(session) == 0


@pytest.mark.asyncio
async def test_dry_run_writes_nothing(session):
    summary = await load_boundaries(session, features=[_feat()], dry_run=True)
    await session.commit()
    assert summary.dry_run is True
    assert summary.inserted_count == 1  # would-insert
    assert await _count(session) == 0  # but nothing persisted


@pytest.mark.asyncio
async def test_loaded_boundary_supports_st_covers(session):
    await load_boundaries(session, features=[_feat(geometry=_POLY)])
    await session.commit()
    covered = (
        await session.execute(
            text(
                "SELECT ST_Covers(boundary, "
                "ST_SetSRID(ST_MakePoint(:lng,:lat),4326)::geography) FROM place_boundaries"
            ),
            {"lng": 1.0, "lat": 1.0},
        )
    ).scalar_one()
    assert covered is True


@pytest.mark.asyncio
async def test_persisted_fields_round_trip(session):
    await load_boundaries(
        session,
        features=[
            _feat(
                overture_id="ov-round",
                name="Bech",
                subtype="county",
                country_code="lu",
                admin_level=2,
                osm_type="relation",
                osm_id=569736,
            )
        ],
    )
    await session.commit()
    row = (
        await session.execute(select(PlaceBoundary).where(PlaceBoundary.overture_id == "ov-round"))
    ).scalar_one()
    assert row.subtype == "county"
    assert row.place_class == "land"
    assert row.admin_level == 2
    assert row.osm_type == "relation" and row.osm_id == 569736
    assert row.country_code == "lu"
    assert row.slug == "bech"
    assert row.is_canonical is False  # loader never sets canonical (Slice 1d does)
    # boundary_area is precomputed on write == ST_Area(boundary, true) — the value the membership
    # order-bys read via COALESCE(boundary_area, ST_Area(boundary)) instead of recomputing the
    # geodesic area per candidate (boundary-area precompute; unblocks large city-dense loads).
    assert row.boundary_area is not None and row.boundary_area > 0
    expected_area = (
        await session.execute(
            text(
                "SELECT ST_Area(boundary, true) FROM place_boundaries "
                "WHERE overture_id = 'ov-round'"
            )
        )
    ).scalar_one()
    assert row.boundary_area == pytest.approx(expected_area)


@pytest.mark.asyncio
async def test_conflict_update_refreshes_boundary_area(session):
    # The ON CONFLICT UPDATE must move boundary and boundary_area together — a stale precomputed
    # area would silently corrupt the membership "smallest/largest covering place" ordering.
    bigger = {"type": "Polygon", "coordinates": [[[0, 0], [4, 0], [4, 4], [0, 4], [0, 0]]]}
    await load_boundaries(session, features=[_feat(overture_id="ov-area", geometry=_POLY)])
    await session.commit()
    first_area = (
        await session.execute(
            select(PlaceBoundary.boundary_area).where(PlaceBoundary.overture_id == "ov-area")
        )
    ).scalar_one()
    # Reload the SAME overture_id with a larger geometry.
    summary = await load_boundaries(
        session, features=[_feat(overture_id="ov-area", geometry=bigger)]
    )
    await session.commit()
    assert summary.updated_count == 1
    row = (
        await session.execute(select(PlaceBoundary).where(PlaceBoundary.overture_id == "ov-area"))
    ).scalar_one()
    recomputed = (
        await session.execute(
            text(
                "SELECT ST_Area(boundary, true) FROM place_boundaries WHERE overture_id = 'ov-area'"
            )
        )
    ).scalar_one()
    assert row.boundary_area == pytest.approx(recomputed)
    assert row.boundary_area > first_area  # grew with the larger geometry — not stale


@pytest.mark.asyncio
async def test_country_code_lowercased_at_insert_boundary(session):
    # load_boundaries is a directly-callable internal API; even an uppercase country_code on a
    # hand-built feature must land lowercased so canonical (country_code, slug) uniqueness holds.
    await load_boundaries(session, features=[_feat(overture_id="ov-upper", country_code="US")])
    await session.commit()
    row = (
        await session.execute(select(PlaceBoundary).where(PlaceBoundary.overture_id == "ov-upper"))
    ).scalar_one()
    assert row.country_code == "us"
