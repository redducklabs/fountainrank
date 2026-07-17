"""Slice 1d — precomputed fountain -> place membership (crawlable SEO pages, #127).

Integration tests for ``app.membership`` against the local PostGIS container (the CI mirror).
Covers the city-assignment ladder (spec §11.5) the plan mandates: overlapping tiers (a locality
inside a county), slug collisions across subtypes, a scope with partial locality coverage, an
unmatched point -> country-only, plus ``fountain_count`` / ``is_canonical`` / ``parent_id`` and
refresh correctness. Boundaries are simple lon/lat squares with known containment; the seeded
``place_scope_config`` (us = {locality, localadmin}, lu = {locality, localadmin, county}) drives
the eligible sets, and a fake country ``zz`` exercises the code default.
"""

from __future__ import annotations

import uuid
from pathlib import Path

import pytest
from httpx import ASGITransport, AsyncClient
from sqlalchemy import text

from app.config import Settings, get_settings
from app.imports.membership_cli import run_membership_backfill
from app.imports.merge import RunScope, merge_candidates, rollback_run
from app.imports.osm import OsmCandidate
from app.main import app
from app.membership import (
    rebuild_place_boundary_cells,
    recompute_fountain_membership,
    refresh_all_memberships,
    refresh_country_memberships,
)

BACKEND = Path(__file__).resolve().parents[1]

_ADMIN_HEADERS = {"X-Dev-User": "admin-sub"}


@pytest.fixture
def _admin_settings():
    app.dependency_overrides[get_settings] = lambda: Settings(
        dev_auth_enabled=True, admin_subjects=["admin-sub"]
    )
    yield
    app.dependency_overrides.pop(get_settings, None)


@pytest.fixture
async def admin_client(_admin_settings):
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        yield ac


@pytest.fixture(autouse=True)
async def _two_level_scope_default(session):
    """Most legacy membership tests target the pre-existing two-level city ladder. Region-tier
    behavior is enabled explicitly in the new hierarchy tests below."""
    await session.execute(
        text("UPDATE place_scope_config SET eligible_region_subtypes = ARRAY[]::text[]")
    )


def _sq(x0: float, y0: float, x1: float, y1: float) -> str:
    """A CCW square POLYGON WKT ((lng lat) order)."""
    return f"POLYGON(({x0} {y0}, {x1} {y0}, {x1} {y1}, {x0} {y1}, {x0} {y0}))"


async def _add_boundary(
    session,
    *,
    overture_id: str,
    subtype: str,
    country_code: str,
    name: str,
    slug: str,
    wkt: str,
    admin_level: int | None = None,
):
    row = (
        await session.execute(
            text(
                """
                INSERT INTO place_boundaries
                    (id, overture_id, subtype, class, admin_level, name, country_code, slug,
                     is_canonical, fountain_count, boundary, created_at, updated_at)
                VALUES (gen_random_uuid(), :oid, :subtype, 'land', :al, :name, :cc, :slug,
                        false, 0, ST_Multi(ST_GeomFromText(:wkt, 4326))::geography, now(), now())
                RETURNING id
                """
            ),
            {
                "oid": overture_id,
                "subtype": subtype,
                "al": admin_level,
                "name": name,
                "cc": country_code,
                "slug": slug,
                "wkt": wkt,
            },
        )
    ).one()
    return row.id


async def _add_fountain(session, lat: float, lng: float, *, hidden: bool = False):
    row = (
        await session.execute(
            text(
                """
                INSERT INTO fountains (id, location, is_hidden, created_source)
                VALUES (gen_random_uuid(),
                        ST_SetSRID(ST_MakePoint(:lng, :lat), 4326)::geography,
                        :hidden, 'admin_import')
                RETURNING id
                """
            ),
            {"lat": lat, "lng": lng, "hidden": hidden},
        )
    ).one()
    return row.id


async def _membership(session, fid):
    return (
        await session.execute(
            text(
                "SELECT country_place_id, region_place_id, city_place_id "
                "FROM fountains WHERE id = :fid"
            ),
            {"fid": fid},
        )
    ).one()


async def _enable_region_tier(session, country_code: str = "us"):
    await session.execute(
        text(
            "UPDATE place_scope_config SET eligible_region_subtypes = ARRAY['region']::text[] "
            "WHERE country_code = :cc"
        ),
        {"cc": country_code},
    )


async def _count(session, place_id) -> int:
    return (
        await session.execute(
            text("SELECT fountain_count FROM place_boundaries WHERE id = :id"), {"id": place_id}
        )
    ).scalar_one()


async def _is_canonical(session, place_id) -> bool:
    return (
        await session.execute(
            text("SELECT is_canonical FROM place_boundaries WHERE id = :id"), {"id": place_id}
        )
    ).scalar_one()


async def _parent(session, place_id):
    return (
        await session.execute(
            text("SELECT parent_id FROM place_boundaries WHERE id = :id"), {"id": place_id}
        )
    ).scalar_one()


@pytest.mark.asyncio
async def test_us_county_is_not_a_city(session):
    """US eligible set is {locality, localadmin}: a fountain in a locality inside a county picks
    the locality; the county never becomes the city (spec §11.5 — US counties are not cities)."""
    us = await _add_boundary(
        session,
        overture_id="us",
        subtype="country",
        country_code="us",
        name="United States",
        slug="united-states",
        wkt=_sq(0, 0, 10, 10),
    )
    county = await _add_boundary(
        session,
        overture_id="us-county",
        subtype="county",
        country_code="us",
        name="San Diego County",
        slug="san-diego-county",
        wkt=_sq(0, 0, 5, 5),
    )
    city = await _add_boundary(
        session,
        overture_id="us-city",
        subtype="locality",
        country_code="us",
        name="San Diego",
        slug="san-diego",
        wkt=_sq(1, 1, 2, 2),
    )
    fid = await _add_fountain(session, lat=1.5, lng=1.5)
    await refresh_all_memberships(session)

    m = await _membership(session, fid)
    assert m.country_place_id == us
    assert m.city_place_id == city
    assert await _count(session, city) == 1
    assert await _count(session, us) == 1
    assert await _count(session, county) == 0  # county is not a city and not a country -> no count


@pytest.mark.asyncio
async def test_overlapping_eligible_tiers_pick_most_specific(session):
    """When multiple ELIGIBLE tiers cover a point (locality inside a county, both eligible in LU),
    the higher-priority subtype wins (locality > county)."""
    lu = await _add_boundary(
        session,
        overture_id="lu",
        subtype="country",
        country_code="lu",
        name="Luxembourg",
        slug="luxembourg",
        wkt=_sq(0, 0, 10, 10),
    )
    county = await _add_boundary(
        session,
        overture_id="lu-canton",
        subtype="county",
        country_code="lu",
        name="Canton",
        slug="canton",
        wkt=_sq(0, 0, 5, 5),
    )
    loc = await _add_boundary(
        session,
        overture_id="lu-loc",
        subtype="locality",
        country_code="lu",
        name="Ville",
        slug="ville",
        wkt=_sq(1, 1, 2, 2),
    )
    fid = await _add_fountain(session, lat=1.5, lng=1.5)
    await refresh_all_memberships(session)

    m = await _membership(session, fid)
    assert m.country_place_id == lu
    assert m.city_place_id == loc  # locality beats the covering county
    assert await _count(session, county) == 0


@pytest.mark.asyncio
async def test_smallest_area_breaks_same_subtype_tie(session):
    """Two localities of the same subtype covering the point -> smallest area wins (spec §11.5)."""
    await _add_boundary(
        session,
        overture_id="us",
        subtype="country",
        country_code="us",
        name="United States",
        slug="united-states",
        wkt=_sq(0, 0, 10, 10),
    )
    big = await _add_boundary(
        session,
        overture_id="big",
        subtype="locality",
        country_code="us",
        name="Big",
        slug="big",
        wkt=_sq(0, 0, 5, 5),
    )
    small = await _add_boundary(
        session,
        overture_id="small",
        subtype="locality",
        country_code="us",
        name="Small",
        slug="small",
        wkt=_sq(1, 1, 2, 2),
    )
    fid = await _add_fountain(session, lat=1.5, lng=1.5)  # inside both localities
    await refresh_all_memberships(session)

    m = await _membership(session, fid)
    assert m.city_place_id == small
    assert await _count(session, small) == 1
    assert await _count(session, big) == 0


@pytest.mark.asyncio
async def test_lu_county_opt_in_and_partial_coverage(session):
    """LU opts county into its eligible set: a fountain in a commune (subtype=county) gets that
    commune as its city, while a fountain elsewhere in LU with no covering commune -> country-only
    (partial locality coverage -> country page, never a coarser forced tier)."""
    lu = await _add_boundary(
        session,
        overture_id="lu",
        subtype="country",
        country_code="lu",
        name="Luxembourg",
        slug="luxembourg",
        wkt=_sq(0, 0, 10, 10),
    )
    commune = await _add_boundary(
        session,
        overture_id="lu-commune",
        subtype="county",
        country_code="lu",
        name="Esch",
        slug="esch",
        wkt=_sq(1, 1, 2, 2),
    )
    inside = await _add_fountain(session, lat=1.5, lng=1.5)
    outside = await _add_fountain(session, lat=8.0, lng=8.0)  # in LU, in no commune
    await refresh_all_memberships(session)

    mi = await _membership(session, inside)
    assert mi.country_place_id == lu
    assert mi.city_place_id == commune  # county eligible for LU

    mo = await _membership(session, outside)
    assert mo.country_place_id == lu
    assert mo.city_place_id is None  # partial coverage -> country-only

    assert await _count(session, commune) == 1
    assert await _count(session, lu) == 2  # both fountains are in the country


@pytest.mark.asyncio
async def test_unmatched_country_only_and_no_country(session):
    """A US point outside every city -> country-only; a point in no loaded country -> both NULL."""
    us = await _add_boundary(
        session,
        overture_id="us",
        subtype="country",
        country_code="us",
        name="United States",
        slug="united-states",
        wkt=_sq(0, 0, 10, 10),
    )
    await _add_boundary(
        session,
        overture_id="us-city",
        subtype="locality",
        country_code="us",
        name="San Diego",
        slug="san-diego",
        wkt=_sq(1, 1, 2, 2),
    )
    country_only = await _add_fountain(session, lat=8.0, lng=8.0)  # in US, no city
    nowhere = await _add_fountain(session, lat=50.0, lng=50.0)  # no boundary at all
    summary = await refresh_all_memberships(session)

    mc = await _membership(session, country_only)
    assert mc.country_place_id == us and mc.city_place_id is None
    mn = await _membership(session, nowhere)
    assert mn.country_place_id is None and mn.city_place_id is None

    assert summary.fountains_total == 2
    assert summary.matched_country == 1
    assert summary.country_only == 1
    assert summary.unmatched == 1


@pytest.mark.asyncio
async def test_default_eligible_for_unconfigured_country(session):
    """An explicit two-level scope still uses the default city ladder: locality/localadmin are
    cities and counties are not."""
    await session.execute(
        text(
            """
            INSERT INTO place_scope_config
                (country_code, eligible_city_subtypes, eligible_region_subtypes, city_routes_ready)
            VALUES ('zz', ARRAY['locality', 'localadmin']::text[], ARRAY[]::text[], false)
            """
        )
    )
    await _add_boundary(
        session,
        overture_id="zz",
        subtype="country",
        country_code="zz",
        name="Zedland",
        slug="zedland",
        wkt=_sq(0, 0, 10, 10),
    )
    zz_county = await _add_boundary(
        session,
        overture_id="zz-county",
        subtype="county",
        country_code="zz",
        name="Zcounty",
        slug="zcounty",
        wkt=_sq(0, 0, 5, 5),
    )
    zz_loc = await _add_boundary(
        session,
        overture_id="zz-loc",
        subtype="localadmin",
        country_code="zz",
        name="Ztown",
        slug="ztown",
        wkt=_sq(1, 1, 2, 2),
    )
    in_county_only = await _add_fountain(session, lat=4.0, lng=4.0)  # county but no localadmin
    in_town = await _add_fountain(session, lat=1.5, lng=1.5)
    await refresh_all_memberships(session)

    assert (await _membership(session, in_county_only)).city_place_id is None  # county not eligible
    assert (await _membership(session, in_town)).city_place_id == zz_loc
    assert await _count(session, zz_county) == 0


@pytest.mark.asyncio
async def test_canonical_slug_collision_prefers_subtype_then_count(session):
    """One canonical place per (country_code, slug): across subtypes the higher-priority subtype
    wins; among the same subtype the larger fountain_count wins (spec §4.3/§11.5)."""
    await _add_boundary(
        session,
        overture_id="us",
        subtype="country",
        country_code="us",
        name="United States",
        slug="united-states",
        wkt=_sq(0, 0, 40, 40),
    )
    # Same slug 'riverside' across subtypes -> locality is canonical (priority beats localadmin).
    loc = await _add_boundary(
        session,
        overture_id="riv-loc",
        subtype="locality",
        country_code="us",
        name="Riverside",
        slug="riverside",
        wkt=_sq(1, 1, 2, 2),
    )
    la = await _add_boundary(
        session,
        overture_id="riv-la",
        subtype="localadmin",
        country_code="us",
        name="Riverside",
        slug="riverside",
        wkt=_sq(10, 10, 11, 11),
    )
    # Same slug 'springfield' same subtype -> larger fountain_count is canonical.
    spring_big = await _add_boundary(
        session,
        overture_id="spring-big",
        subtype="locality",
        country_code="us",
        name="Springfield",
        slug="springfield",
        wkt=_sq(20, 20, 21, 21),
    )
    spring_small = await _add_boundary(
        session,
        overture_id="spring-small",
        subtype="locality",
        country_code="us",
        name="Springfield",
        slug="springfield",
        wkt=_sq(30, 30, 31, 31),
    )
    await _add_fountain(session, lat=20.5, lng=20.5)  # spring_big
    await _add_fountain(session, lat=20.5, lng=20.7)  # spring_big
    await _add_fountain(session, lat=30.5, lng=30.5)  # spring_small
    await refresh_all_memberships(session)

    assert await _is_canonical(session, loc) is True
    assert await _is_canonical(session, la) is False
    assert await _is_canonical(session, spring_big) is True  # 2 fountains > 1
    assert await _is_canonical(session, spring_small) is False


@pytest.mark.asyncio
async def test_parent_id_containment(session):
    """parent_id is derived by containment: cities/counties -> their country; country -> NULL."""
    us = await _add_boundary(
        session,
        overture_id="us",
        subtype="country",
        country_code="us",
        name="United States",
        slug="united-states",
        wkt=_sq(0, 0, 10, 10),
    )
    county = await _add_boundary(
        session,
        overture_id="us-county",
        subtype="county",
        country_code="us",
        name="County",
        slug="county",
        wkt=_sq(0, 0, 5, 5),
    )
    city = await _add_boundary(
        session,
        overture_id="us-city",
        subtype="locality",
        country_code="us",
        name="City",
        slug="city",
        wkt=_sq(1, 1, 2, 2),
    )
    await refresh_all_memberships(session)

    assert await _parent(session, us) is None
    assert await _parent(session, county) is None
    assert await _parent(session, city) == us


@pytest.mark.asyncio
async def test_hidden_fountains_excluded_from_counts(session):
    """fountain_count is NON-HIDDEN only (the public number + the >= K gate)."""
    us = await _add_boundary(
        session,
        overture_id="us",
        subtype="country",
        country_code="us",
        name="United States",
        slug="united-states",
        wkt=_sq(0, 0, 10, 10),
    )
    city = await _add_boundary(
        session,
        overture_id="us-city",
        subtype="locality",
        country_code="us",
        name="San Diego",
        slug="san-diego",
        wkt=_sq(1, 1, 2, 2),
    )
    await _add_fountain(session, lat=1.5, lng=1.5)
    await _add_fountain(session, lat=1.6, lng=1.6, hidden=True)
    await refresh_all_memberships(session)

    assert await _count(session, city) == 1
    assert await _count(session, us) == 1


@pytest.mark.asyncio
async def test_single_fountain_recompute_matches_and_increments(session):
    """The incremental single-fountain path assigns the same place as the full refresh and keeps
    fountain_count correct as fountains are added one at a time (user-add / OSM per-row path)."""
    us = await _add_boundary(
        session,
        overture_id="us",
        subtype="country",
        country_code="us",
        name="United States",
        slug="united-states",
        wkt=_sq(0, 0, 10, 10),
    )
    city = await _add_boundary(
        session,
        overture_id="us-city",
        subtype="locality",
        country_code="us",
        name="San Diego",
        slug="san-diego",
        wkt=_sq(1, 1, 2, 2),
    )
    await refresh_all_memberships(session)  # boundary-load equivalent before adds
    f1 = await _add_fountain(session, lat=1.5, lng=1.5)
    await recompute_fountain_membership(session, f1)
    m1 = await _membership(session, f1)
    assert m1.country_place_id == us and m1.city_place_id == city
    assert await _count(session, city) == 1
    assert await _count(session, us) == 1

    f2 = await _add_fountain(session, lat=1.6, lng=1.6)
    await recompute_fountain_membership(session, f2)
    assert await _count(session, city) == 2
    assert await _count(session, us) == 2


@pytest.mark.asyncio
async def test_refresh_is_idempotent(session):
    """Running the full refresh twice is a no-op on the second pass (stable counts + canonical)."""
    await _add_boundary(
        session,
        overture_id="us",
        subtype="country",
        country_code="us",
        name="United States",
        slug="united-states",
        wkt=_sq(0, 0, 10, 10),
    )
    city = await _add_boundary(
        session,
        overture_id="us-city",
        subtype="locality",
        country_code="us",
        name="San Diego",
        slug="san-diego",
        wkt=_sq(1, 1, 2, 2),
    )
    await _add_fountain(session, lat=1.5, lng=1.5)
    s1 = await refresh_all_memberships(session)
    s2 = await refresh_all_memberships(session)
    assert s1 == s2
    assert await _count(session, city) == 1
    assert await _is_canonical(session, city) is True


@pytest.mark.asyncio
async def test_cells_subdivide_large_polygon_and_assign(session):
    """The perf fix (#127): a high-vertex boundary is broken into MULTIPLE ST_Subdivide cells, and
    point-in-polygon via those cells still assigns correctly. Guards the whole reason the cells
    table exists — probing the ~136k-vertex US polygon per fountain ran the backfill 40+ min; via
    small cells the same PIP is ~7s."""
    # A ~256-vertex circle (quad_segs=64), comfortably over the 128-vertex subdivide threshold, as a
    # country polygon — so the rebuild MUST split it into several cells (unlike the small test
    # squares elsewhere, which subdivide to a single cell).
    place_id = (
        await session.execute(
            text(
                """
                INSERT INTO place_boundaries
                    (id, overture_id, subtype, class, name, country_code, slug,
                     is_canonical, fountain_count, boundary, created_at, updated_at)
                VALUES (gen_random_uuid(), 'big-country', 'country', 'land', 'Bigland', 'bg',
                        'bigland', false, 0,
                        ST_Multi(ST_Buffer(ST_SetSRID(ST_MakePoint(0, 0), 4326), 5,
                                           'quad_segs=64'))::geography,
                        now(), now())
                RETURNING id
                """
            )
        )
    ).scalar_one()
    npoints = (
        await session.execute(
            text("SELECT ST_NPoints(boundary::geometry) FROM place_boundaries WHERE id = :id"),
            {"id": place_id},
        )
    ).scalar_one()
    assert npoints > 128  # a genuinely large polygon, so ST_Subdivide(…, 128) must split it

    total_cells = await rebuild_place_boundary_cells(session)
    per_place = (
        await session.execute(
            text("SELECT count(*) FROM place_boundary_cells WHERE place_id = :id"),
            {"id": place_id},
        )
    ).scalar_one()
    assert per_place > 1  # the large polygon was subdivided into multiple cells
    assert total_cells == per_place  # this is the only boundary, so its cells are all of them

    fid = await _add_fountain(session, lat=0.0, lng=0.0)  # centre of the circle
    await refresh_all_memberships(session, rebuild_cells=False)
    await recompute_fountain_membership(session, fid)
    m = await _membership(session, fid)
    assert m.country_place_id == place_id  # PIP via the subdivided cells still finds the country
    assert m.city_place_id is None  # no city boundary loaded


# --- Refresh triggers: user add (API), OSM import, backfill CLI ---


@pytest.mark.asyncio
async def test_add_fountain_via_api_assigns_membership(session, client):
    """The user-add path (POST /fountains) assigns membership + bumps counts in the add's txn."""
    us = await _add_boundary(
        session,
        overture_id="us",
        subtype="country",
        country_code="us",
        name="United States",
        slug="united-states",
        wkt=_sq(0, 0, 10, 10),
    )
    city = await _add_boundary(
        session,
        overture_id="us-city",
        subtype="locality",
        country_code="us",
        name="San Diego",
        slug="san-diego",
        wkt=_sq(1, 1, 2, 2),
    )
    await refresh_all_memberships(session)  # boundary-load equivalent before adds
    await session.commit()  # the API request runs in its own session — commit so it sees these

    resp = await client.post(
        "/api/v1/fountains", json={"location": {"latitude": 1.5, "longitude": 1.5}}
    )
    assert resp.status_code == 201
    fid = uuid.UUID(resp.json()["id"])

    m = await _membership(session, fid)
    assert m.country_place_id == us
    assert m.city_place_id == city
    assert await _count(session, city) == 1


@pytest.mark.asyncio
async def test_osm_import_assigns_membership(session):
    """The OSM import path (merge_candidates) assigns membership to inserted fountains."""
    us = await _add_boundary(
        session,
        overture_id="us",
        subtype="country",
        country_code="us",
        name="United States",
        slug="united-states",
        wkt=_sq(0, 0, 10, 10),
    )
    city = await _add_boundary(
        session,
        overture_id="us-city",
        subtype="locality",
        country_code="us",
        name="San Diego",
        slug="san-diego",
        wkt=_sq(1, 1, 2, 2),
    )
    await rebuild_place_boundary_cells(session)  # boundaries loaded (cells built) before the import
    scope = RunScope(
        source_system="osm",
        source_dataset="test:membership",
        source_build_id="b1",
        source_label="membership test",
        scope_id="test:membership",
        scope_bounds_wkt=None,
    )
    cand = OsmCandidate(
        source_external_id="osm:node:1",
        osm_type="node",
        osm_id=1,
        latitude=1.5,
        longitude=1.5,
        tags={"amenity": "drinking_water"},
        confidence="high",
        geometry_kind="point",
    )
    await merge_candidates(session, scope=scope, candidates=[cand], skipped=[], dry_run=False)
    await session.commit()

    m = (await session.execute(text("SELECT country_place_id, city_place_id FROM fountains"))).one()
    assert m.country_place_id == us
    assert m.city_place_id == city
    assert await _count(session, city) == 1


@pytest.mark.asyncio
async def test_osm_rollback_refreshes_counts(session):
    """Rolling back an import hides its inserted fountains, so fountain_count must drop back."""
    await _add_boundary(
        session,
        overture_id="us",
        subtype="country",
        country_code="us",
        name="United States",
        slug="united-states",
        wkt=_sq(0, 0, 10, 10),
    )
    city = await _add_boundary(
        session,
        overture_id="us-city",
        subtype="locality",
        country_code="us",
        name="San Diego",
        slug="san-diego",
        wkt=_sq(1, 1, 2, 2),
    )
    await rebuild_place_boundary_cells(session)  # boundaries loaded (cells built) before the import
    scope = RunScope(
        source_system="osm",
        source_dataset="test:rollback",
        source_build_id="b1",
        source_label="rollback test",
        scope_id="test:rollback",
        scope_bounds_wkt=None,
    )
    cand = OsmCandidate(
        source_external_id="osm:node:9",
        osm_type="node",
        osm_id=9,
        latitude=1.5,
        longitude=1.5,
        tags={"amenity": "drinking_water"},
        confidence="high",
        geometry_kind="point",
    )
    run = await merge_candidates(session, scope=scope, candidates=[cand], skipped=[], dry_run=False)
    assert await _count(session, city) == 1

    await rollback_run(session, run.run_id)
    assert await _count(session, city) == 0  # hidden rolled-back insert no longer counts


@pytest.mark.asyncio
async def test_backfill_cli_assigns_committed(session):
    """The backfill CLI opens its own session and commits a full refresh — the one-time catch-up
    for fountains that predate a boundary load (Slice 1c loaded boundaries before membership)."""
    us = await _add_boundary(
        session,
        overture_id="us",
        subtype="country",
        country_code="us",
        name="United States",
        slug="united-states",
        wkt=_sq(0, 0, 10, 10),
    )
    city = await _add_boundary(
        session,
        overture_id="us-city",
        subtype="locality",
        country_code="us",
        name="San Diego",
        slug="san-diego",
        wkt=_sq(1, 1, 2, 2),
    )
    fid = await _add_fountain(session, lat=1.5, lng=1.5)
    await session.commit()  # the CLI opens its own session — commit so it sees these

    summary = await run_membership_backfill()
    assert summary.fountains_total == 1
    assert summary.matched_city == 1
    assert summary.canonical_places == 1

    m = await _membership(session, fid)
    assert m.country_place_id == us
    assert m.city_place_id == city
    assert await _count(session, city) == 1
    assert await _is_canonical(session, city) is True


# --- Admin mutations keep membership + counts consistent (Codex PR review, finding 1) ---


async def _us_and_city(session):
    us = await _add_boundary(
        session,
        overture_id="us",
        subtype="country",
        country_code="us",
        name="United States",
        slug="united-states",
        wkt=_sq(0, 0, 10, 10),
    )
    city = await _add_boundary(
        session,
        overture_id="us-city",
        subtype="locality",
        country_code="us",
        name="San Diego",
        slug="san-diego",
        wkt=_sq(1, 1, 2, 2),
    )
    return us, city


@pytest.mark.asyncio
async def test_admin_hide_unhide_updates_counts(session, admin_client):
    """Admin hide/unhide of a fountain must adjust fountain_count (non-hidden only)."""
    _, city = await _us_and_city(session)
    fid = await _add_fountain(session, lat=1.5, lng=1.5)
    await refresh_all_memberships(session)
    await session.commit()
    assert await _count(session, city) == 1

    hide = await admin_client.patch(
        f"/api/v1/admin/fountains/{fid}", headers=_ADMIN_HEADERS, json={"is_hidden": True}
    )
    assert hide.status_code == 200
    assert await _count(session, city) == 0

    unhide = await admin_client.patch(
        f"/api/v1/admin/fountains/{fid}", headers=_ADMIN_HEADERS, json={"is_hidden": False}
    )
    assert unhide.status_code == 200
    assert await _count(session, city) == 1


@pytest.mark.asyncio
async def test_admin_move_reassigns_membership(session, admin_client):
    """Admin moving a fountain re-assigns its city and shifts the old/new counts."""
    await _add_boundary(
        session,
        overture_id="us",
        subtype="country",
        country_code="us",
        name="United States",
        slug="united-states",
        wkt=_sq(0, 0, 10, 10),
    )
    city_a = await _add_boundary(
        session,
        overture_id="city-a",
        subtype="locality",
        country_code="us",
        name="Alpha",
        slug="alpha",
        wkt=_sq(1, 1, 2, 2),
    )
    city_b = await _add_boundary(
        session,
        overture_id="city-b",
        subtype="locality",
        country_code="us",
        name="Beta",
        slug="beta",
        wkt=_sq(5, 5, 6, 6),
    )
    fid = await _add_fountain(session, lat=1.5, lng=1.5)  # in Alpha
    await refresh_all_memberships(session)
    await session.commit()
    assert await _count(session, city_a) == 1 and await _count(session, city_b) == 0

    moved = await admin_client.patch(
        f"/api/v1/admin/fountains/{fid}",
        headers=_ADMIN_HEADERS,
        json={"location": {"latitude": 5.5, "longitude": 5.5}},
    )
    assert moved.status_code == 200
    m = await _membership(session, fid)
    assert m.city_place_id == city_b
    assert await _count(session, city_a) == 0
    assert await _count(session, city_b) == 1


@pytest.mark.asyncio
async def test_admin_delete_updates_counts(session, admin_client):
    """Admin deleting a fountain must drop its place counts."""
    us, city = await _us_and_city(session)
    fid = await _add_fountain(session, lat=1.5, lng=1.5)
    await refresh_all_memberships(session)
    await session.commit()
    assert await _count(session, city) == 1 and await _count(session, us) == 1

    deleted = await admin_client.delete(f"/api/v1/admin/fountains/{fid}", headers=_ADMIN_HEADERS)
    assert deleted.status_code == 204
    assert await _count(session, city) == 0
    assert await _count(session, us) == 0


@pytest.mark.asyncio
async def test_canonical_reselects_on_count_change(session):
    """A count change re-selects the canonical owner for the affected (country_code, slug) group,
    so is_canonical never drifts stale between full refreshes (Codex PR review, finding 2)."""
    await _add_boundary(
        session,
        overture_id="us",
        subtype="country",
        country_code="us",
        name="United States",
        slug="united-states",
        wkt=_sq(0, 0, 20, 20),
    )
    # Two distinct 'springfield' localities (a real slug collision). overture_id 'spring-a' sorts
    # before 'spring-b', so A wins the count tie — the test drives B strictly ahead on count.
    spring_a = await _add_boundary(
        session,
        overture_id="spring-a",
        subtype="locality",
        country_code="us",
        name="Springfield",
        slug="springfield",
        wkt=_sq(1, 1, 2, 2),
    )
    spring_b = await _add_boundary(
        session,
        overture_id="spring-b",
        subtype="locality",
        country_code="us",
        name="Springfield",
        slug="springfield",
        wkt=_sq(10, 10, 11, 11),
    )
    await refresh_all_memberships(session)  # boundary-load equivalent before adds
    fa = await _add_fountain(session, lat=1.5, lng=1.5)  # Springfield A
    await recompute_fountain_membership(session, fa)
    assert await _is_canonical(session, spring_a) is True  # A: 1, B: 0
    assert await _is_canonical(session, spring_b) is False

    fb1 = await _add_fountain(session, lat=10.5, lng=10.5)  # Springfield B
    await recompute_fountain_membership(session, fb1)  # A: 1, B: 1 -> tie -> A (overture_id)
    assert await _is_canonical(session, spring_a) is True

    fb2 = await _add_fountain(session, lat=10.6, lng=10.6)  # Springfield B
    await recompute_fountain_membership(session, fb2)  # B: 2 > A: 1 -> B canonical
    assert await _is_canonical(session, spring_b) is True
    assert await _is_canonical(session, spring_a) is False


@pytest.mark.asyncio
async def test_region_tier_allows_same_city_slug_under_different_parents(session):
    await _enable_region_tier(session)
    us = await _add_boundary(
        session,
        overture_id="us",
        subtype="country",
        country_code="us",
        name="United States",
        slug="united-states",
        wkt=_sq(0, 0, 20, 20),
    )
    oregon = await _add_boundary(
        session,
        overture_id="region-or",
        subtype="region",
        country_code="us",
        name="Oregon",
        slug="oregon",
        wkt=_sq(0, 0, 8, 8),
    )
    maine = await _add_boundary(
        session,
        overture_id="region-me",
        subtype="region",
        country_code="us",
        name="Maine",
        slug="maine",
        wkt=_sq(10, 10, 18, 18),
    )
    portland_or = await _add_boundary(
        session,
        overture_id="portland-or",
        subtype="locality",
        country_code="us",
        name="Portland",
        slug="portland",
        wkt=_sq(1, 1, 2, 2),
    )
    portland_me = await _add_boundary(
        session,
        overture_id="portland-me",
        subtype="locality",
        country_code="us",
        name="Portland",
        slug="portland",
        wkt=_sq(11, 11, 12, 12),
    )
    for lat, lng in ((1.5, 1.5), (11.5, 11.5)):
        await _add_fountain(session, lat=lat, lng=lng)

    await refresh_all_memberships(session)

    assert await _parent(session, oregon) == us
    assert await _parent(session, maine) == us
    assert await _parent(session, portland_or) == oregon
    assert await _parent(session, portland_me) == maine
    assert await _is_canonical(session, portland_or) is True
    assert await _is_canonical(session, portland_me) is True
    assert await _count(session, us) == 2
    assert await _count(session, oregon) == 1
    assert await _count(session, maine) == 1


@pytest.mark.asyncio
async def test_region_tier_city_without_region_parent_is_not_canonical_or_assigned(session):
    await _enable_region_tier(session)
    await _add_boundary(
        session,
        overture_id="us",
        subtype="country",
        country_code="us",
        name="United States",
        slug="united-states",
        wkt=_sq(0, 0, 10, 10),
    )
    city = await _add_boundary(
        session,
        overture_id="orphan-city",
        subtype="locality",
        country_code="us",
        name="Orphan City",
        slug="orphan-city",
        wkt=_sq(1, 1, 2, 2),
    )
    fid = await _add_fountain(session, lat=1.5, lng=1.5)

    await refresh_all_memberships(session)

    assert await _parent(session, city) is None
    assert await _is_canonical(session, city) is False
    assert (await _membership(session, fid)).city_place_id is None
    assert await _count(session, city) == 0


@pytest.mark.asyncio
async def test_region_canonicality_ignores_fountain_counts(session):
    await _enable_region_tier(session)
    await _add_boundary(
        session,
        overture_id="us",
        subtype="country",
        country_code="us",
        name="United States",
        slug="united-states",
        wkt=_sq(0, 0, 10, 10),
    )
    large = await _add_boundary(
        session,
        overture_id="large-region",
        subtype="region",
        country_code="us",
        name="Duplicate",
        slug="duplicate",
        wkt=_sq(0, 0, 10, 10),
    )
    small = await _add_boundary(
        session,
        overture_id="small-region",
        subtype="region",
        country_code="us",
        name="Duplicate",
        slug="duplicate",
        wkt=_sq(1, 1, 2, 2),
    )
    await _add_fountain(session, lat=1.5, lng=1.5)

    await refresh_all_memberships(session)

    assert await _count(session, small) == 1
    assert await _is_canonical(session, large) is True
    assert await _is_canonical(session, small) is False


@pytest.mark.asyncio
async def test_admin_delete_updates_region_count(session, admin_client):
    await _enable_region_tier(session)
    await _add_boundary(
        session,
        overture_id="us",
        subtype="country",
        country_code="us",
        name="United States",
        slug="united-states",
        wkt=_sq(0, 0, 10, 10),
    )
    region = await _add_boundary(
        session,
        overture_id="region",
        subtype="region",
        country_code="us",
        name="Region",
        slug="region",
        wkt=_sq(0, 0, 10, 10),
    )
    city = await _add_boundary(
        session,
        overture_id="city",
        subtype="locality",
        country_code="us",
        name="City",
        slug="city",
        wkt=_sq(1, 1, 2, 2),
    )
    fid = await _add_fountain(session, lat=1.5, lng=1.5)
    await refresh_all_memberships(session)
    await session.commit()
    assert await _count(session, region) == 1
    assert await _count(session, city) == 1

    deleted = await admin_client.delete(f"/api/v1/admin/fountains/{fid}", headers=_ADMIN_HEADERS)

    assert deleted.status_code == 204
    assert await _count(session, region) == 0
    assert await _count(session, city) == 0


async def _membership_snapshot(session):
    rows = (
        await session.execute(
            text(
                """
                SELECT overture_id, place_kind, parent_id, is_canonical, fountain_count
                FROM place_boundaries
                ORDER BY overture_id
                """
            )
        )
    ).all()
    fountains = (
        await session.execute(
            text(
                """
                SELECT id, country_place_id, region_place_id, city_place_id
                FROM fountains
                ORDER BY id
                """
            )
        )
    ).all()
    return rows, fountains


@pytest.mark.asyncio
async def test_migration_backfill_matches_refresh_all_memberships(session):
    await _enable_region_tier(session)
    await _add_boundary(
        session,
        overture_id="us",
        subtype="country",
        country_code="us",
        name="United States",
        slug="united-states",
        wkt=_sq(0, 0, 20, 20),
    )
    await _add_boundary(
        session,
        overture_id="region",
        subtype="region",
        country_code="us",
        name="Region",
        slug="region",
        wkt=_sq(0, 0, 20, 20),
    )
    await _add_boundary(
        session,
        overture_id="city-a",
        subtype="locality",
        country_code="us",
        name="City",
        slug="city",
        wkt=_sq(1, 1, 2, 2),
    )
    await _add_boundary(
        session,
        overture_id="city-b",
        subtype="localadmin",
        country_code="us",
        name="City",
        slug="city",
        wkt=_sq(1, 1, 3, 3),
    )
    await _add_fountain(session, lat=1.5, lng=1.5)
    await rebuild_place_boundary_cells(session)

    sql = (BACKEND / "migrations/sql/0025_backfill.sql").read_text(encoding="utf-8")
    for statement in sql.split(";"):
        if statement.strip():
            await session.execute(text(statement))
    frozen_snapshot = await _membership_snapshot(session)

    await session.execute(
        text(
            "UPDATE fountains "
            "SET country_place_id = NULL, region_place_id = NULL, city_place_id = NULL"
        )
    )
    await session.execute(
        text(
            "UPDATE place_boundaries "
            "SET place_kind = NULL, parent_id = NULL, is_canonical = false, fountain_count = 0"
        )
    )
    await refresh_all_memberships(session, rebuild_cells=False)

    assert await _membership_snapshot(session) == frozen_snapshot


def _stable_uuid(name: str) -> uuid.UUID:
    return uuid.uuid5(uuid.NAMESPACE_URL, f"fountainrank-test:{name}")


async def _reset_scoped_fixture(session) -> None:
    await session.execute(
        text("TRUNCATE fountains, place_boundary_cells, place_boundaries RESTART IDENTITY CASCADE")
    )


async def _add_scoped_boundary(
    session,
    *,
    key: str,
    overture_id: str,
    subtype: str,
    country_code: str,
    name: str,
    slug: str,
    wkt: str,
):
    boundary_id = _stable_uuid(f"boundary:{key}")
    await session.execute(
        text(
            """
            INSERT INTO place_boundaries
                (id, overture_id, subtype, class, name, country_code, slug, is_canonical,
                 fountain_count, boundary, created_at, updated_at)
            VALUES (:id, :oid, :subtype, 'land', :name, :cc, :slug, false, 0,
                    ST_Multi(ST_GeomFromText(:wkt, 4326))::geography, now(), now())
            """
        ),
        {
            "id": boundary_id,
            "oid": overture_id,
            "subtype": subtype,
            "name": name,
            "cc": country_code,
            "slug": slug,
            "wkt": wkt,
        },
    )
    return boundary_id


async def _add_scoped_fountain(session, key: str, lat: float, lng: float):
    fountain_id = _stable_uuid(f"fountain:{key}")
    await session.execute(
        text(
            """
            INSERT INTO fountains (id, location, is_hidden, created_source)
            VALUES (:id, ST_SetSRID(ST_MakePoint(:lng, :lat), 4326)::geography,
                    false, 'admin_import')
            """
        ),
        {"id": fountain_id, "lat": lat, "lng": lng},
    )
    return fountain_id


async def _set_scoped_boundary_wkt(session, key: str, wkt: str) -> None:
    await session.execute(
        text(
            """
            UPDATE place_boundaries
            SET boundary = ST_Multi(ST_GeomFromText(:wkt, 4326))::geography
            WHERE id = :id
            """
        ),
        {"id": _stable_uuid(f"boundary:{key}"), "wkt": wkt},
    )


async def _set_scoped_boundary_subtype(session, key: str, subtype: str) -> None:
    await session.execute(
        text("UPDATE place_boundaries SET subtype = :subtype WHERE id = :id"),
        {"id": _stable_uuid(f"boundary:{key}"), "subtype": subtype},
    )


async def _seed_country_a_scoped_base(session) -> None:
    await _add_scoped_boundary(
        session,
        key="a-country",
        overture_id="z-a-country",
        subtype="country",
        country_code="aa",
        name="Country A",
        slug="country-a",
        wkt=_sq(0, 0, 12, 10),
    )
    await _add_scoped_boundary(
        session,
        key="a-region",
        overture_id="z-a-region",
        subtype="region",
        country_code="aa",
        name="A Region",
        slug="region",
        wkt=_sq(0, 0, 12, 10),
    )
    await _add_scoped_boundary(
        session,
        key="a-city",
        overture_id="z-a-city",
        subtype="locality",
        country_code="aa",
        name="A City",
        slug="city",
        wkt=_sq(1, 1, 11, 9),
    )


async def _seed_country_b_scoped_base(session) -> None:
    await _add_scoped_boundary(
        session,
        key="b-country",
        overture_id="a-b-country",
        subtype="country",
        country_code="bb",
        name="Country B",
        slug="country-b",
        wkt=_sq(10, 0, 20, 10),
    )
    await _add_scoped_boundary(
        session,
        key="b-region",
        overture_id="a-b-region",
        subtype="region",
        country_code="bb",
        name="B Region",
        slug="region",
        wkt=_sq(10, 0, 20, 10),
    )
    await _add_scoped_boundary(
        session,
        key="b-city",
        overture_id="a-b-city",
        subtype="locality",
        country_code="bb",
        name="B City",
        slug="city",
        wkt=_sq(10.25, 1, 19, 9),
    )


async def _seed_two_country_scoped_base(session) -> None:
    await _seed_country_a_scoped_base(session)
    await _seed_country_b_scoped_base(session)


async def _assert_same_group_cities_do_not_overlap(session) -> None:
    overlaps = (
        await session.execute(
            text(
                """
                SELECT count(*)
                FROM place_boundaries a
                JOIN place_boundaries b
                  ON a.id < b.id
                 AND a.country_code = b.country_code
                 AND a.parent_id = b.parent_id
                 AND a.slug = b.slug
                 AND a.place_kind = 'city'
                 AND b.place_kind = 'city'
                WHERE ST_Overlaps(a.boundary::geometry, b.boundary::geometry)
                   OR ST_Contains(a.boundary::geometry, b.boundary::geometry)
                   OR ST_Contains(b.boundary::geometry, a.boundary::geometry)
                """
            )
        )
    ).scalar_one()
    assert overlaps == 0


async def _scoped_parity_snapshot(session, setup) -> tuple:
    await _reset_scoped_fixture(session)
    await setup(session)
    await refresh_country_memberships(session, "bb")
    await _assert_same_group_cities_do_not_overlap(session)
    scoped = await _membership_snapshot(session)

    await _reset_scoped_fixture(session)
    await setup(session)
    await refresh_all_memberships(session)
    await _assert_same_group_cities_do_not_overlap(session)
    full = await _membership_snapshot(session)
    assert scoped == full
    return scoped


async def _setup_first_load_b(session) -> None:
    await _seed_country_a_scoped_base(session)
    await refresh_all_memberships(session)
    await _seed_country_b_scoped_base(session)
    await _add_scoped_fountain(session, "b-new", lat=2, lng=11)


async def _setup_b_shrinks_into_a(session) -> None:
    await _seed_two_country_scoped_base(session)
    await _add_scoped_fountain(session, "cross-to-a", lat=2, lng=10.5)
    await refresh_all_memberships(session)
    await _set_scoped_boundary_wkt(session, "b-country", _sq(11, 0, 20, 10))
    await _set_scoped_boundary_wkt(session, "b-region", _sq(11, 0, 20, 10))
    await _set_scoped_boundary_wkt(session, "b-city", _sq(11.25, 1, 19, 9))


async def _setup_b_expands_over_a(session) -> None:
    await _seed_two_country_scoped_base(session)
    await _set_scoped_boundary_wkt(session, "b-country", _sq(12, 0, 20, 10))
    await _set_scoped_boundary_wkt(session, "b-region", _sq(12, 0, 20, 10))
    await _set_scoped_boundary_wkt(session, "b-city", _sq(12.25, 1, 19, 9))
    await _add_scoped_fountain(session, "cross-to-b", lat=2, lng=10.5)
    await refresh_all_memberships(session)
    await _set_scoped_boundary_wkt(session, "b-country", _sq(10, 0, 20, 10))
    await _set_scoped_boundary_wkt(session, "b-region", _sq(10, 0, 20, 10))
    await _set_scoped_boundary_wkt(session, "b-city", _sq(10.25, 1, 19, 9))


async def _setup_shared_border_point(session) -> None:
    await _seed_country_a_scoped_base(session)
    await refresh_all_memberships(session)
    await _seed_country_b_scoped_base(session)
    await _add_scoped_fountain(session, "border", lat=2, lng=10)


async def _setup_b_city_becomes_ineligible(session) -> None:
    await _seed_two_country_scoped_base(session)
    await _add_scoped_fountain(session, "b-city-tier-change", lat=2, lng=11)
    await refresh_all_memberships(session)
    await _set_scoped_boundary_subtype(session, "b-city", "neighborhood")


async def _setup_b_city_loses_parent(session) -> None:
    await _seed_two_country_scoped_base(session)
    await _add_scoped_fountain(session, "b-null-parent", lat=2, lng=11)
    await refresh_all_memberships(session)
    await _set_scoped_boundary_wkt(session, "b-region", _sq(15, 0, 20, 10))


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "setup",
    [
        _setup_first_load_b,
        _setup_b_shrinks_into_a,
        _setup_b_expands_over_a,
        _setup_shared_border_point,
        _setup_b_city_becomes_ineligible,
        _setup_b_city_loses_parent,
    ],
)
async def test_refresh_country_memberships_matches_full_refresh_under_mutation(session, setup):
    await _scoped_parity_snapshot(session, setup)


@pytest.mark.asyncio
async def test_refresh_country_memberships_is_idempotent(session):
    await _reset_scoped_fixture(session)
    await _setup_first_load_b(session)
    await refresh_country_memberships(session, "bb")
    once = await _membership_snapshot(session)
    await refresh_country_memberships(session, "bb")
    assert await _membership_snapshot(session) == once


# --- compute/publish seam runs the behavior suite on BOTH compositions (Codex PR#245 finding 2) --
#
# The refresh runs two ways that differ ONLY in transaction layout, so both must produce the same
# membership. `full_refresh` / `country_refresh` are parametrized over them; the tests assert the
# EXPECTED assignments / counts / canonical winners on each fixture (the oracle is the expected
# value, never one composition compared against the other — that would be circular now that
# `refresh_all_memberships` IS compute+publish):
#   - "single_txn": the caller-owned single transaction (`refresh_all_memberships` /
#     `refresh_country_memberships`) — the OSM merge-path layout.
#   - "staged_pinned": `run_staged_membership_refresh` — TWO transactions (compute→commit→
#     publish→commit) on one pinned connection (the loader/CLI layout). The fixtures are committed
#     first (a separate connection can't see the test session's open transaction) and the session's
#     view is refreshed after, so a transaction-boundary-specific difference would surface.


@pytest.fixture(params=["single_txn", "staged_pinned"])
def full_refresh(request, session, engine):
    from app.membership import RefreshScope, run_staged_membership_refresh

    async def _run():
        if request.param == "single_txn":
            return await refresh_all_memberships(session)
        await session.commit()  # commit the fixtures so the pinned connection sees them
        summary = await run_staged_membership_refresh(engine, RefreshScope(rebuild_cells=True))
        await session.rollback()  # drop the stale snapshot; reads below see the committed result
        return summary

    return _run


@pytest.fixture(params=["single_txn", "staged_pinned"])
def country_refresh(request, session, engine):
    from app.membership import RefreshScope, run_staged_membership_refresh

    async def _run(cc: str):
        if request.param == "single_txn":
            return await refresh_country_memberships(session, cc)
        await session.commit()
        summary = await run_staged_membership_refresh(engine, RefreshScope(country_code=cc))
        await session.rollback()
        return summary

    return _run


@pytest.mark.asyncio
async def test_ladder_county_not_a_city_both_compositions(session, full_refresh):
    us = await _add_boundary(
        session,
        overture_id="us",
        subtype="country",
        country_code="us",
        name="United States",
        slug="united-states",
        wkt=_sq(0, 0, 10, 10),
    )
    county = await _add_boundary(
        session,
        overture_id="us-county",
        subtype="county",
        country_code="us",
        name="County",
        slug="county",
        wkt=_sq(0, 0, 5, 5),
    )
    city = await _add_boundary(
        session,
        overture_id="us-city",
        subtype="locality",
        country_code="us",
        name="San Diego",
        slug="san-diego",
        wkt=_sq(1, 1, 2, 2),
    )
    fid = await _add_fountain(session, lat=1.5, lng=1.5)
    await full_refresh()
    m = await _membership(session, fid)
    assert m.country_place_id == us
    assert m.city_place_id == city
    assert await _count(session, city) == 1
    assert await _count(session, us) == 1
    assert await _count(session, county) == 0


@pytest.mark.asyncio
async def test_smallest_area_breaks_tie_both_compositions(session, full_refresh):
    await _add_boundary(
        session,
        overture_id="us",
        subtype="country",
        country_code="us",
        name="US",
        slug="united-states",
        wkt=_sq(0, 0, 10, 10),
    )
    big = await _add_boundary(
        session,
        overture_id="big",
        subtype="locality",
        country_code="us",
        name="Big",
        slug="big",
        wkt=_sq(0, 0, 5, 5),
    )
    small = await _add_boundary(
        session,
        overture_id="small",
        subtype="locality",
        country_code="us",
        name="Small",
        slug="small",
        wkt=_sq(1, 1, 2, 2),
    )
    fid = await _add_fountain(session, lat=1.5, lng=1.5)  # inside both localities
    await full_refresh()
    assert (await _membership(session, fid)).city_place_id == small
    assert await _count(session, small) == 1
    assert await _count(session, big) == 0


@pytest.mark.asyncio
async def test_canonical_slug_collision_both_compositions(session, full_refresh):
    await _add_boundary(
        session,
        overture_id="us",
        subtype="country",
        country_code="us",
        name="US",
        slug="united-states",
        wkt=_sq(0, 0, 40, 40),
    )
    loc = await _add_boundary(
        session,
        overture_id="riv-loc",
        subtype="locality",
        country_code="us",
        name="Riverside",
        slug="riverside",
        wkt=_sq(1, 1, 2, 2),
    )
    la = await _add_boundary(
        session,
        overture_id="riv-la",
        subtype="localadmin",
        country_code="us",
        name="Riverside",
        slug="riverside",
        wkt=_sq(10, 10, 11, 11),
    )
    spring_big = await _add_boundary(
        session,
        overture_id="spring-big",
        subtype="locality",
        country_code="us",
        name="Springfield",
        slug="springfield",
        wkt=_sq(20, 20, 21, 21),
    )
    spring_small = await _add_boundary(
        session,
        overture_id="spring-small",
        subtype="locality",
        country_code="us",
        name="Springfield",
        slug="springfield",
        wkt=_sq(30, 30, 31, 31),
    )
    await _add_fountain(session, lat=20.5, lng=20.5)
    await _add_fountain(session, lat=20.5, lng=20.7)
    await _add_fountain(session, lat=30.5, lng=30.5)
    await full_refresh()
    assert await _is_canonical(session, loc) is True  # subtype priority beats localadmin
    assert await _is_canonical(session, la) is False
    # larger count wins the same-subtype tie
    assert await _is_canonical(session, spring_big) is True
    assert await _is_canonical(session, spring_small) is False


@pytest.mark.asyncio
async def test_hidden_excluded_from_counts_both_compositions(session, full_refresh):
    us = await _add_boundary(
        session,
        overture_id="us",
        subtype="country",
        country_code="us",
        name="US",
        slug="united-states",
        wkt=_sq(0, 0, 10, 10),
    )
    city = await _add_boundary(
        session,
        overture_id="us-city",
        subtype="locality",
        country_code="us",
        name="San Diego",
        slug="san-diego",
        wkt=_sq(1, 1, 2, 2),
    )
    await _add_fountain(session, lat=1.5, lng=1.5)
    await _add_fountain(session, lat=1.6, lng=1.6, hidden=True)
    await full_refresh()
    assert await _count(session, city) == 1
    assert await _count(session, us) == 1


@pytest.mark.asyncio
async def test_unmatched_country_only_both_compositions(session, full_refresh):
    us = await _add_boundary(
        session,
        overture_id="us",
        subtype="country",
        country_code="us",
        name="US",
        slug="united-states",
        wkt=_sq(0, 0, 10, 10),
    )
    await _add_boundary(
        session,
        overture_id="us-city",
        subtype="locality",
        country_code="us",
        name="San Diego",
        slug="san-diego",
        wkt=_sq(1, 1, 2, 2),
    )
    country_only = await _add_fountain(session, lat=8.0, lng=8.0)  # in US, no city
    nowhere = await _add_fountain(session, lat=50.0, lng=50.0)  # no boundary at all
    summary = await full_refresh()
    assert (await _membership(session, country_only)).country_place_id == us
    assert (await _membership(session, country_only)).city_place_id is None
    assert (await _membership(session, nowhere)).country_place_id is None
    assert summary.matched_country == 1
    assert summary.country_only == 1
    assert summary.unmatched == 1


@pytest.mark.asyncio
async def test_region_tier_both_compositions(session, full_refresh):
    await _enable_region_tier(session)
    us = await _add_boundary(
        session,
        overture_id="us",
        subtype="country",
        country_code="us",
        name="US",
        slug="united-states",
        wkt=_sq(0, 0, 20, 20),
    )
    oregon = await _add_boundary(
        session,
        overture_id="region-or",
        subtype="region",
        country_code="us",
        name="Oregon",
        slug="oregon",
        wkt=_sq(0, 0, 8, 8),
    )
    maine = await _add_boundary(
        session,
        overture_id="region-me",
        subtype="region",
        country_code="us",
        name="Maine",
        slug="maine",
        wkt=_sq(10, 10, 18, 18),
    )
    portland_or = await _add_boundary(
        session,
        overture_id="portland-or",
        subtype="locality",
        country_code="us",
        name="Portland",
        slug="portland",
        wkt=_sq(1, 1, 2, 2),
    )
    portland_me = await _add_boundary(
        session,
        overture_id="portland-me",
        subtype="locality",
        country_code="us",
        name="Portland",
        slug="portland",
        wkt=_sq(11, 11, 12, 12),
    )
    for lat, lng in ((1.5, 1.5), (11.5, 11.5)):
        await _add_fountain(session, lat=lat, lng=lng)
    await full_refresh()
    assert await _parent(session, portland_or) == oregon
    assert await _parent(session, portland_me) == maine
    assert await _is_canonical(session, portland_or) is True
    assert await _is_canonical(session, portland_me) is True  # same slug, different parents
    assert await _count(session, us) == 2
    assert await _count(session, oregon) == 1
    assert await _count(session, maine) == 1


@pytest.mark.asyncio
async def test_country_scope_first_load_both_compositions(session, country_refresh):
    """Scoped refresh of country 'bb' after loading its boundaries assigns + canonicalizes exactly
    that country's places, on both the single-transaction and pinned-connection compositions."""
    await _reset_scoped_fixture(session)
    await _setup_first_load_b(session)
    await country_refresh("bb")
    b_city = _stable_uuid("boundary:b-city")
    b_country = _stable_uuid("boundary:b-country")
    fid = _stable_uuid("fountain:b-new")
    m = await _membership(session, fid)
    assert m.country_place_id == b_country
    assert m.city_place_id == b_city
    assert await _count(session, b_city) == 1
    assert await _is_canonical(session, b_city) is True


@pytest.mark.asyncio
async def test_country_scope_matches_expected_after_mutation_both_compositions(
    session, country_refresh
):
    """A boundary shrink (B recedes, a fountain crosses into A) re-derives correctly under a scoped
    refresh of 'bb' on both compositions — the expected final assignment is the oracle."""
    await _reset_scoped_fixture(session)
    await _seed_two_country_scoped_base(session)
    await _add_scoped_fountain(session, "cross-to-a", lat=2, lng=10.5)
    await refresh_all_memberships(session)
    await _set_scoped_boundary_wkt(session, "b-country", _sq(11, 0, 20, 10))
    await _set_scoped_boundary_wkt(session, "b-region", _sq(11, 0, 20, 10))
    await _set_scoped_boundary_wkt(session, "b-city", _sq(11.25, 1, 19, 9))
    await country_refresh("bb")
    # The fountain at lng=10.5 is now outside B (which starts at lng=11) → it belongs to A's city.
    fid = _stable_uuid("fountain:cross-to-a")
    a_city = _stable_uuid("boundary:a-city")
    assert (await _membership(session, fid)).city_place_id == a_city
    await _assert_same_group_cities_do_not_overlap(session)


@pytest.mark.asyncio
async def test_staged_refresh_is_generation_closed_adversarial(session):
    """Adversarial generation change — the canonical-region winner flips AND a region drops out of
    the region tier. A staged refresh started from the PREVIOUS generation's live state must equal
    the legacy single-transaction backfill run on the NEW generation, proving compute reads only the
    STAGED (new-generation) place_kind / is_canonical, never live residue."""
    await _enable_region_tier(session)
    await _add_boundary(
        session,
        overture_id="us",
        subtype="country",
        country_code="us",
        name="US",
        slug="united-states",
        wkt=_sq(0, 0, 20, 20),
    )
    # Two regions share slug 'dup'; alpha is larger in gen1 (canonical), beta is smaller.
    alpha = await _add_boundary(
        session,
        overture_id="alpha",
        subtype="region",
        country_code="us",
        name="Dup",
        slug="dup",
        wkt=_sq(0, 0, 20, 20),
    )
    beta = await _add_boundary(
        session,
        overture_id="beta",
        subtype="region",
        country_code="us",
        name="Dup",
        slug="dup",
        wkt=_sq(1, 1, 3, 3),
    )
    # gamma qualifies as a region in gen1, then is demoted to a county in gen2.
    gamma = await _add_boundary(
        session,
        overture_id="gamma",
        subtype="region",
        country_code="us",
        name="Gamma",
        slug="gamma",
        wkt=_sq(10, 10, 15, 15),
    )
    await _add_boundary(
        session,
        overture_id="town",
        subtype="locality",
        country_code="us",
        name="Town",
        slug="town",
        wkt=_sq(1, 1, 2, 2),
    )
    await _add_fountain(session, lat=1.5, lng=1.5)
    await _add_fountain(session, lat=12.0, lng=12.0)  # inside gamma

    # Generation 1 refresh — live tables now carry gen-1 place_kind / canonical / parent.
    await refresh_all_memberships(session)
    assert await _is_canonical(session, alpha) is True  # larger area wins in gen1
    assert await _is_canonical(session, beta) is False

    # Mutate boundaries to generation 2: flip the winner (beta now larger) + demote gamma.
    await session.execute(
        text(
            "UPDATE place_boundaries SET boundary = "
            "ST_Multi(ST_GeomFromText(:wkt, 4326))::geography WHERE id = :id"
        ),
        {"wkt": _sq(0, 0, 2, 2), "id": alpha},
    )
    await session.execute(
        text(
            "UPDATE place_boundaries SET boundary = "
            "ST_Multi(ST_GeomFromText(:wkt, 4326))::geography WHERE id = :id"
        ),
        {"wkt": _sq(0, 0, 20, 20), "id": beta},
    )
    await session.execute(
        text("UPDATE place_boundaries SET subtype = 'county' WHERE id = :id"), {"id": gamma}
    )

    # Staged refresh from the gen-1 residue.
    await refresh_all_memberships(session)
    staged = await _membership_snapshot(session)

    # Legacy single-transaction oracle on the SAME gen-2 boundary rows from a clean slate.
    await session.execute(
        text(
            "UPDATE fountains SET country_place_id = NULL, region_place_id = NULL, "
            "city_place_id = NULL"
        )
    )
    await session.execute(
        text(
            "UPDATE place_boundaries SET place_kind = NULL, parent_id = NULL, "
            "is_canonical = false, fountain_count = 0"
        )
    )
    await rebuild_place_boundary_cells(session)
    sql = (BACKEND / "migrations/sql/0025_backfill.sql").read_text(encoding="utf-8")
    for statement in sql.split(";"):
        if statement.strip():
            await session.execute(text(statement))
    legacy = await _membership_snapshot(session)

    assert staged == legacy
    # And the generation actually changed: beta is now canonical, gamma is no longer a region.
    assert await _is_canonical(session, beta) is True
    assert await _is_canonical(session, alpha) is False


@pytest.mark.asyncio
async def test_reset_first_publish_reparents_shared_slug_cities(session):
    """Two previous-generation canonical cities that share a slug get re-parented under ONE new
    parent (and a region drops out of the tier). The reset-first publish order must clear the old
    canonical flags BEFORE applying the new parent, so the apply never collides on
    uq_place_boundaries_city_canonical; the refresh converges to exactly one canonical winner."""
    await _enable_region_tier(session)
    us = await _add_boundary(
        session,
        overture_id="us",
        subtype="country",
        country_code="us",
        name="US",
        slug="united-states",
        wkt=_sq(0, 0, 20, 20),
    )
    oregon = await _add_boundary(
        session,
        overture_id="oregon",
        subtype="region",
        country_code="us",
        name="Oregon",
        slug="oregon",
        wkt=_sq(0, 0, 10, 10),
    )
    maine = await _add_boundary(
        session,
        overture_id="maine",
        subtype="region",
        country_code="us",
        name="Maine",
        slug="maine",
        wkt=_sq(10, 10, 20, 20),
    )
    p_or = await _add_boundary(
        session,
        overture_id="portland-or",
        subtype="locality",
        country_code="us",
        name="Portland",
        slug="portland",
        wkt=_sq(1, 1, 2, 2),
    )
    p_me = await _add_boundary(
        session,
        overture_id="portland-me",
        subtype="locality",
        country_code="us",
        name="Portland",
        slug="portland",
        wkt=_sq(11, 11, 12, 12),
    )
    await _add_fountain(session, lat=1.5, lng=1.5)
    await _add_fountain(session, lat=11.5, lng=11.5)

    # Gen 1: two Portlands, canonical under DIFFERENT parents (Oregon, Maine).
    await refresh_all_memberships(session)
    assert await _parent(session, p_or) == oregon
    assert await _parent(session, p_me) == maine
    assert await _is_canonical(session, p_or) is True
    assert await _is_canonical(session, p_me) is True

    # Gen 2: Oregon expands over both Portlands; Maine drops out of the region tier (subtype
    # transition → partial-index participation change). Both Portlands re-parent under Oregon.
    await session.execute(
        text(
            "UPDATE place_boundaries SET boundary = "
            "ST_Multi(ST_GeomFromText(:wkt, 4326))::geography WHERE id = :id"
        ),
        {"wkt": _sq(0, 0, 20, 20), "id": oregon},
    )
    await session.execute(
        text("UPDATE place_boundaries SET subtype = 'county' WHERE id = :id"), {"id": maine}
    )

    # Must publish without hitting uq_place_boundaries_city_canonical, converging to one winner.
    await refresh_all_memberships(session)
    assert await _parent(session, p_or) == oregon
    assert await _parent(session, p_me) == oregon
    canonical = int(await _is_canonical(session, p_or)) + int(await _is_canonical(session, p_me))
    assert canonical == 1  # exactly one canonical Portland under the shared parent
    assert us is not None


@pytest.mark.asyncio
async def test_add_committed_between_stages_gets_correct_membership(session):
    """A fountain added AFTER compute stages the derivation but BEFORE publish is still assigned
    correct membership — publish's assign covers every fountain, including mid-refresh adds."""
    from app.membership import (
        RefreshScope,
        compute_boundary_derivation,
        publish_membership_state,
    )

    us = await _add_boundary(
        session,
        overture_id="us",
        subtype="country",
        country_code="us",
        name="US",
        slug="united-states",
        wkt=_sq(0, 0, 10, 10),
    )
    city = await _add_boundary(
        session,
        overture_id="us-city",
        subtype="locality",
        country_code="us",
        name="San Diego",
        slug="san-diego",
        wkt=_sq(1, 1, 2, 2),
    )
    scope = RefreshScope(rebuild_cells=True)
    await compute_boundary_derivation(session, scope)  # stage the boundary derivation

    fid = await _add_fountain(session, lat=1.5, lng=1.5)  # add lands between the stages

    await publish_membership_state(session, scope)  # assign covers ALL fountains
    m = await _membership(session, fid)
    assert m.country_place_id == us
    assert m.city_place_id == city
    assert await _count(session, city) == 1


@pytest.mark.asyncio
async def test_staged_city_parent_uses_gist_index_not_seqscan(session):
    """Plan-shape guard (spec Verification 4): staged city parenting must probe the staging-cell
    GiST index, never sequentially scan the cells — output equivalence alone can't catch a
    catastrophic plan regression (the #239-class failure)."""
    from app.membership import (
        _STAGED_CITY_PARENT_SQL,
        RefreshScope,
        compute_boundary_derivation,
    )

    await _enable_region_tier(session)
    await _add_boundary(
        session,
        overture_id="us",
        subtype="country",
        country_code="us",
        name="US",
        slug="united-states",
        wkt=_sq(-10, -10, 10, 10),
    )
    # A high-vertex region so ST_Subdivide produces MANY staged cells — enough that the planner
    # must prefer the GiST index over a sequential scan for the point-in-polygon probe.
    await session.execute(
        text(
            """
            INSERT INTO place_boundaries
                (id, overture_id, subtype, class, name, country_code, slug,
                 is_canonical, fountain_count, boundary, created_at, updated_at)
            VALUES (gen_random_uuid(), 'big-region', 'region', 'land', 'Big', 'us', 'big',
                    false, 0,
                    ST_Multi(ST_Buffer(ST_SetSRID(ST_MakePoint(0, 0), 4326), 5,
                                       'quad_segs=2048'))::geography,
                    now(), now())
            """
        )
    )
    await _add_boundary(
        session,
        overture_id="big-city",
        subtype="locality",
        country_code="us",
        name="Center",
        slug="center",
        wkt=_sq(-1, -1, 1, 1),
    )
    scope = RefreshScope(rebuild_cells=True)
    await compute_boundary_derivation(session, scope)  # stages cells + GiST index + ANALYZE

    cells = (
        await session.execute(text("SELECT count(*) FROM _staged_place_boundary_cells"))
    ).scalar_one()
    assert cells > 50  # a genuinely large cell table, so the index choice is meaningful

    plan_rows = (await session.execute(text("EXPLAIN " + _STAGED_CITY_PARENT_SQL.text))).all()
    plan = "\n".join(r[0] for r in plan_rows)
    assert "_staged_place_boundary_cells" in plan  # the staged cells are the probed relation
    assert "Seq Scan on _staged_place_boundary_cells" not in plan
    assert any(marker in plan for marker in ("Index Scan", "Bitmap Index Scan", "Index Only Scan"))


# --- Staged pinned-connection wrapper (Slice C Task 6) ----------------------------------------


async def _seed_country_city_committed(session):
    """Commit a US country + one locality city + a fountain in the city, so the wrapper (which runs
    on its own pinned connection) can see them. Returns (us_id, city_id, fountain_id)."""
    us = await _add_boundary(
        session,
        overture_id="us",
        subtype="country",
        country_code="us",
        name="US",
        slug="united-states",
        wkt=_sq(0, 0, 10, 10),
    )
    city = await _add_boundary(
        session,
        overture_id="us-city",
        subtype="locality",
        country_code="us",
        name="San Diego",
        slug="san-diego",
        wkt=_sq(1, 1, 2, 2),
    )
    fid = await _add_fountain(session, lat=1.5, lng=1.5)
    await session.commit()
    return us, city, fid


@pytest.mark.asyncio
async def test_staged_wrapper_pins_one_connection_and_staging_survives_commit(session, engine):
    """Both transactions run on ONE pinned physical connection (asserted via pg_backend_pid), and
    the staging temp tables created in compute survive the compute-commit — the property the CLI's
    two-transaction layout depends on."""
    from sqlalchemy.ext.asyncio import AsyncSession as _AsyncSession

    from app.membership import (
        RefreshScope,
        compute_boundary_derivation,
        publish_membership_state,
    )

    _, city, _ = await _seed_country_city_committed(session)
    scope = RefreshScope(rebuild_cells=True)
    async with engine.connect() as connection:
        s = _AsyncSession(bind=connection, expire_on_commit=False)
        pid1 = (await s.execute(text("SELECT pg_backend_pid()"))).scalar_one()
        await compute_boundary_derivation(s, scope)
        await s.commit()
        # Staging survives the compute-commit on this pinned connection (else this SELECT would
        # raise UndefinedTable / return 0).
        staged = (
            await s.execute(text("SELECT count(*) FROM _staged_boundary_derivation"))
        ).scalar_one()
        assert staged >= 2
        await publish_membership_state(s, scope)
        await s.commit()
        pid2 = (await s.execute(text("SELECT pg_backend_pid()"))).scalar_one()
        assert pid1 == pid2  # one physical backend across both transactions

    # The published membership is visible to a separate connection.
    await session.rollback()
    assert await _count(session, city) == 1


@pytest.mark.asyncio
async def test_staged_compute_reused_connection_no_stale_leak(session, engine):
    """Consecutive computes on a REUSED pinned connection cannot leak stale staging — the
    unconditional DROP + CREATE re-derives fresh each time (a bare reuse would PK-collide on the
    prior generation's rows or retain them)."""
    from sqlalchemy.ext.asyncio import AsyncSession as _AsyncSession

    from app.membership import RefreshScope, compute_boundary_derivation

    await _enable_region_tier(session)
    await _add_boundary(
        session,
        overture_id="us",
        subtype="country",
        country_code="us",
        name="US",
        slug="united-states",
        wkt=_sq(0, 0, 10, 10),
    )
    reg = await _add_boundary(
        session,
        overture_id="reg",
        subtype="region",
        country_code="us",
        name="Region",
        slug="reg",
        wkt=_sq(0, 0, 8, 8),
    )
    await session.commit()

    scope = RefreshScope(rebuild_cells=True)
    async with engine.connect() as connection:
        s = _AsyncSession(bind=connection, expire_on_commit=False)
        await compute_boundary_derivation(s, scope)
        await s.commit()
        kind1 = (
            await s.execute(
                text("SELECT place_kind FROM _staged_boundary_derivation WHERE place_id = :id"),
                {"id": reg},
            )
        ).scalar_one()
        assert kind1 == "region"

        # Mutate the boundary to a non-eligible subtype and commit, then re-run compute on the SAME
        # connection WITHOUT any explicit drop.
        await s.execute(
            text("UPDATE place_boundaries SET subtype = 'county' WHERE id = :id"), {"id": reg}
        )
        await s.commit()
        await compute_boundary_derivation(s, scope)
        await s.commit()
        kind2 = (
            await s.execute(
                text("SELECT place_kind FROM _staged_boundary_derivation WHERE place_id = :id"),
                {"id": reg},
            )
        ).scalar_one()
        assert kind2 is None  # fresh gen-2 staging, no gen-1 residue and no PK collision


@pytest.mark.asyncio
async def test_staged_wrapper_publish_failure_preserves_previous_generation(
    session, engine, test_user, monkeypatch
):
    """A forced publish failure rolls back atomically, so the PUBLIC place/SEO reads AND a
    post-failure add through the REAL route still see the coherent PREVIOUS generation (Codex PR#245
    finding 1): verified through GET /api/v1/places, GET /api/v1/fountains/{id}/place, and
    POST /api/v1/fountains — never by inspecting derived rows. The wrapper raises (loader Job fails
    visibly), and a rerun converges."""
    import app.membership as m
    from app.auth import get_current_user
    from app.db import get_engine
    from app.membership import RefreshScope, run_staged_membership_refresh

    # A public client with the thin-content gate pinned (K=3) + the write-auth seam bound to a user.
    app.dependency_overrides[get_settings] = lambda: Settings(
        seo_place_min_fountains=3, dev_auth_enabled=True
    )
    app.dependency_overrides[get_current_user] = lambda: test_user
    transport = ASGITransport(app=app)
    try:
        async with AsyncClient(transport=transport, base_url="http://test") as api:
            # Seed an INDEXABLE public city: US country + a locality with 3 (working) fountains.
            await _add_boundary(
                session,
                overture_id="us",
                subtype="country",
                country_code="us",
                name="US",
                slug="united-states",
                wkt=_sq(0, 0, 10, 10),
            )
            city = await _add_boundary(
                session,
                overture_id="us-city",
                subtype="locality",
                country_code="us",
                name="San Diego",
                slug="san-diego",
                wkt=_sq(1, 1, 2, 2),
            )
            fid = await _add_fountain(session, lat=1.2, lng=1.2)
            await _add_fountain(session, lat=1.4, lng=1.4)
            await _add_fountain(session, lat=1.6, lng=1.6)
            await session.commit()
            # Generation 1 refresh (via the pinned-connection wrapper).
            await run_staged_membership_refresh(get_engine(), RefreshScope(rebuild_cells=True))

            # Public reads BEFORE the failure: the city is listed (SEO thin-content gate) + the
            # fountain's place resolves and is indexable.
            listed = (await api.get("/api/v1/places", params={"country": "us"})).json()
            assert any(p["slug"] == "san-diego" for p in listed)
            place = (await api.get(f"/api/v1/fountains/{fid}/place")).json()
            assert place["city"]["slug"] == "san-diego"
            assert place["indexable"] is True

            # The loader commits a gen-2 boundary identity change; the derived refresh then fails.
            await session.execute(
                text("UPDATE place_boundaries SET subtype = 'neighborhood' WHERE id = :id"),
                {"id": city},
            )
            await session.commit()

            async def _boom(*_args, **_kwargs):
                raise RuntimeError("forced publish failure")

            monkeypatch.setattr(m, "_build_summary", _boom)
            with pytest.raises(RuntimeError):
                await run_staged_membership_refresh(get_engine(), RefreshScope(rebuild_cells=True))

            # Public reads AFTER the failure STILL serve the coherent previous generation.
            listed2 = (await api.get("/api/v1/places", params={"country": "us"})).json()
            assert any(p["slug"] == "san-diego" for p in listed2)
            place2 = (await api.get(f"/api/v1/fountains/{fid}/place")).json()
            assert place2["city"]["slug"] == "san-diego"
            assert place2["indexable"] is True

            # A post-failure add through the REAL route lands in the previous generation's city.
            add = await api.post(
                "/api/v1/fountains",
                json={"location": {"latitude": 1.5, "longitude": 1.5}, "is_working": True},
            )
            assert add.status_code == 201
            new_fid = add.json()["id"]
            new_place = (await api.get(f"/api/v1/fountains/{new_fid}/place")).json()
            assert new_place["city"]["slug"] == "san-diego"

            # A rerun (the forced failure removed) converges to generation 2 — the now-neighborhood
            # place is no longer an indexable city, so the public list drops it.
            monkeypatch.undo()
            await run_staged_membership_refresh(get_engine(), RefreshScope(rebuild_cells=True))
            listed3 = (await api.get("/api/v1/places", params={"country": "us"})).json()
            assert not any(p["slug"] == "san-diego" for p in listed3)
    finally:
        app.dependency_overrides.pop(get_settings, None)
        app.dependency_overrides.pop(get_current_user, None)


@pytest.mark.asyncio
async def test_staged_wrapper_emits_stage_boundary_logs(session, caplog):
    import logging

    from app.db import get_engine
    from app.membership import RefreshScope, run_staged_membership_refresh

    await _seed_country_city_committed(session)
    with caplog.at_level(logging.INFO, logger="app.membership"):
        await run_staged_membership_refresh(get_engine(), RefreshScope(rebuild_cells=True))

    events = [r.getMessage() for r in caplog.records if r.name == "app.membership"]
    for ev in (
        "compute_started",
        "compute_completed",
        "publish_waiting",
        "publish_started",
        "publish_completed",
    ):
        assert ev in events, ev
    # compute_completed precedes publish_completed (the publish window opens after compute commits).
    assert events.index("compute_completed") < events.index("publish_completed")
    started = next(r for r in caplog.records if r.getMessage() == "compute_started")
    assert getattr(started, "scope", None) == "all"
    leaked = " ".join(
        str(v) for r in caplog.records if r.name == "app.membership" for v in r.__dict__.values()
    )
    assert "set_config" not in leaked.lower()
    assert "asyncpg" not in leaked.lower()


@pytest.mark.asyncio
async def test_staged_wrapper_publish_failed_log_has_no_driver_internals(
    session, monkeypatch, caplog
):
    import logging

    import app.membership as m
    from app.db import get_engine
    from app.membership import RefreshScope, run_staged_membership_refresh

    await _seed_country_city_committed(session)

    async def _boom(*_args, **_kwargs):
        raise RuntimeError("forced-secret-detail")

    monkeypatch.setattr(m, "_build_summary", _boom)
    with caplog.at_level(logging.ERROR, logger="app.membership"):
        with pytest.raises(RuntimeError):
            await run_staged_membership_refresh(get_engine(), RefreshScope(rebuild_cells=True))

    failed = [r for r in caplog.records if r.getMessage() == "publish_failed"]
    assert len(failed) == 1
    assert failed[0].levelno == logging.ERROR
    leaked = " ".join(str(v) for v in failed[0].__dict__.values())
    assert "forced-secret-detail" not in leaked  # the exception string is not in the stage event
    assert "RuntimeError" not in leaked
    assert "set_config" not in leaked.lower()


@pytest.mark.asyncio
async def test_membership_cli_main_exits_nonzero_on_publish_failure(session, monkeypatch):
    """The CLI entrypoint (`membership_cli.main`) must never convert a publish failure into a
    successful exit (Codex PR#245 finding 3) — the raised staged refresh propagates out of `main()`
    (nonzero process exit + traceback), so the loader Job fails visibly. Exercises the REAL publish
    failure through the actual entrypoint, run in a worker thread so `main()`'s `asyncio.run` gets
    its own event loop."""
    import asyncio

    import app.db as _db
    import app.membership as m
    from app.imports import membership_cli

    await _seed_country_city_committed(session)  # committed boundaries + fountain

    async def _boom(*_args, **_kwargs):
        raise RuntimeError("forced publish failure")

    monkeypatch.setattr(m, "_build_summary", _boom)
    try:
        with pytest.raises(RuntimeError):
            await asyncio.to_thread(membership_cli.main, [])
    finally:
        # main() created the app engine on the worker thread's (now-closed) loop; drop the globals
        # so the autouse teardown never disposes across loops and the next test rebuilds cleanly.
        _db._engine = None
        _db._sessionmaker = None


# --- capture-query parity (spec 2026-07-17 candidate-capture design, Verification 1) ----------
# The country candidate capture was rewritten from a per-fountain `OR EXISTS` scan to a set-based
# UNION (the OR shape was O(all fountains) and ran unbounded in production). The OLD query text is
# kept verbatim below as the oracle: both queries must produce identical ID sets over identical
# data, and the targeted fixtures pin each UNION branch independently.

_OLD_CAPTURE_SQL = text(
    """
    INSERT INTO membership_candidate_fountains (id)
    SELECT DISTINCT f.id
    FROM fountains f
    WHERE EXISTS (
        SELECT 1
        FROM place_boundary_cells cell
        JOIN place_boundaries pb ON pb.id = cell.place_id
        WHERE pb.country_code = :cc
          AND ST_Covers(cell.geom, f.location::geometry)
    )
    OR EXISTS (
        SELECT 1
        FROM place_boundaries pb
        WHERE pb.country_code = :cc
          AND pb.id IN (f.country_place_id, f.region_place_id, f.city_place_id)
    )
    ON CONFLICT DO NOTHING
    """
)


async def _seed_capture_parity_fixture(session) -> dict:
    """Two countries (disjoint squares) with refreshed cells/membership, then adversarial
    assignment states created by direct UPDATEs so location and assignments disagree."""
    await _add_boundary(
        session,
        overture_id="cap-us",
        subtype="country",
        country_code="us",
        name="United States",
        slug="united-states",
        wkt=_sq(0, 0, 10, 10),
    )
    us_city = await _add_boundary(
        session,
        overture_id="cap-us-city",
        subtype="locality",
        country_code="us",
        name="San Diego",
        slug="san-diego",
        wkt=_sq(1, 1, 3, 3),
    )
    lu = await _add_boundary(
        session,
        overture_id="cap-lu",
        subtype="country",
        country_code="lu",
        name="Luxembourg",
        slug="luxembourg",
        wkt=_sq(20, 0, 30, 10),
    )
    lu_city = await _add_boundary(
        session,
        overture_id="cap-lu-city",
        subtype="locality",
        country_code="lu",
        name="Vianden",
        slug="vianden",
        wkt=_sq(21, 1, 23, 3),
    )
    f_us_both = await _add_fountain(session, lat=2.0, lng=2.0)  # in us_city, assigned us
    f_lu = await _add_fountain(session, lat=2.0, lng=22.0)  # in lu_city, assigned lu
    f_cross_spatial = await _add_fountain(session, lat=2.5, lng=2.5)  # in us, will point at lu
    f_assign_only = await _add_fountain(session, lat=50.0, lng=50.0)  # outside, will point at us
    f_mixed = await _add_fountain(session, lat=52.0, lng=52.0)  # outside, us city + two lu refs
    f_none = await _add_fountain(session, lat=60.0, lng=60.0)  # outside, unassigned
    f_spatial_only = await _add_fountain(session, lat=4.0, lng=4.0)  # in us, will be NULLed
    await refresh_all_memberships(session)

    async def _set(fid, country_id, region_id, city_id):
        await session.execute(
            text(
                "UPDATE fountains SET country_place_id = :c, region_place_id = :r, "
                "city_place_id = :ci WHERE id = :fid"
            ),
            {"c": country_id, "r": region_id, "ci": city_id, "fid": fid},
        )

    await _set(f_cross_spatial, lu, None, lu_city)  # spatially us, assigned entirely lu
    await _set(f_assign_only, None, None, us_city)  # spatially nowhere, one us assignment
    await _set(f_mixed, lu, lu_city, us_city)  # one us assignment, two lu references
    await _set(f_spatial_only, None, None, None)  # spatially us, no assignments
    return {
        "f_us_both": f_us_both,
        "f_lu": f_lu,
        "f_cross_spatial": f_cross_spatial,
        "f_assign_only": f_assign_only,
        "f_mixed": f_mixed,
        "f_none": f_none,
        "f_spatial_only": f_spatial_only,
    }


async def _capture_ids(conn, sql, cc: str) -> set:
    await conn.execute(sql, {"cc": cc})
    rows = await conn.execute(text("SELECT id FROM membership_candidate_fountains"))
    ids = {row.id for row in rows}
    await conn.execute(text("TRUNCATE membership_candidate_fountains"))
    return ids


@pytest.mark.asyncio
async def test_capture_rewrite_same_snapshot_equivalence_and_branches(session, engine):
    from app.membership import _CAPTURE_COUNTRY_CANDIDATES_SQL

    ids = await _seed_capture_parity_fixture(session)
    await session.commit()  # the equivalence connection below must see the fixture

    async with engine.connect() as conn:
        # One genuine snapshot for both query texts: REPEATABLE READ set before any other
        # statement (default READ COMMITTED re-snapshots per statement).
        await conn.execute(text("SET TRANSACTION ISOLATION LEVEL REPEATABLE READ"))
        assert (
            await conn.execute(text("SHOW transaction_isolation"))
        ).scalar_one() == "repeatable read"
        await conn.execute(
            text(
                "CREATE TEMP TABLE membership_candidate_fountains "
                "(id uuid PRIMARY KEY) ON COMMIT DROP"
            )
        )
        for cc in ("us", "lu"):
            old_ids = await _capture_ids(conn, _OLD_CAPTURE_SQL, cc)
            new_ids = await _capture_ids(conn, _CAPTURE_COUNTRY_CANDIDATES_SQL, cc)
            assert new_ids == old_ids, f"capture divergence for {cc}"
            if cc == "us":
                assert new_ids == {
                    ids["f_us_both"],  # spatial + assigned: dedupes to one row
                    ids["f_cross_spatial"],  # spatial branch only (assigned lu)
                    ids["f_assign_only"],  # city-assignment branch only
                    ids["f_mixed"],  # city-assignment branch (us city ref)
                    ids["f_spatial_only"],  # spatial branch only (no assignments)
                }
            else:
                assert new_ids == {
                    ids["f_lu"],  # spatial + assigned lu
                    ids["f_cross_spatial"],  # country/city-assignment branches (lu refs)
                    ids["f_mixed"],  # country + region branches (lu refs)
                }
        await conn.rollback()


@pytest.mark.asyncio
async def test_country_refresh_recounts_foreign_places_for_cross_country_candidate(session, engine):
    from app.membership import RefreshScope, run_staged_membership_refresh

    us = await _add_boundary(
        session,
        overture_id="xc-us",
        subtype="country",
        country_code="us",
        name="United States",
        slug="united-states",
        wkt=_sq(0, 0, 10, 10),
    )
    us_city = await _add_boundary(
        session,
        overture_id="xc-us-city",
        subtype="locality",
        country_code="us",
        name="San Diego",
        slug="san-diego",
        wkt=_sq(1, 1, 3, 3),
    )
    lu = await _add_boundary(
        session,
        overture_id="xc-lu",
        subtype="country",
        country_code="lu",
        name="Luxembourg",
        slug="luxembourg",
        wkt=_sq(20, 0, 30, 10),
    )
    lu_city = await _add_boundary(
        session,
        overture_id="xc-lu-city",
        subtype="locality",
        country_code="lu",
        name="Vianden",
        slug="vianden",
        wkt=_sq(21, 1, 23, 3),
    )
    fid = await _add_fountain(session, lat=2.0, lng=22.0)  # starts in lu_city
    await refresh_all_memberships(session)
    assert await _count(session, lu_city) == 1
    assert await _count(session, lu) == 1
    assert await _count(session, us_city) == 0

    # The fountain moves into the us city while its assignments still say lu — the classic
    # cross-country candidate: the us-scoped refresh must capture it spatially, reassign it,
    # AND recount the FOREIGN (lu) places it left.
    await session.execute(
        text(
            "UPDATE fountains SET location = "
            "ST_SetSRID(ST_MakePoint(2.0, 2.0), 4326)::geography WHERE id = :fid"
        ),
        {"fid": fid},
    )
    await session.commit()

    await run_staged_membership_refresh(engine, RefreshScope(country_code="us"))
    await session.rollback()  # drop the stale snapshot; reads below see the committed result

    m = await _membership(session, fid)
    assert m.country_place_id == us
    assert m.city_place_id == us_city
    assert await _count(session, us_city) == 1
    assert await _count(session, us) == 1
    assert await _count(session, lu_city) == 0
    assert await _count(session, lu) == 0
    assert await _is_canonical(session, us_city) is True
