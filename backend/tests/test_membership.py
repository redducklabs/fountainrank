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
)

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
            text("SELECT country_place_id, city_place_id FROM fountains WHERE id = :fid"),
            {"fid": fid},
        )
    ).one()


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
    """A country with NO place_scope_config row falls back to the code default {locality,
    localadmin} — a county in such a country is NOT a city."""
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
    assert await _parent(session, county) == us
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
    await rebuild_place_boundary_cells(session)  # boundary-load equivalent: cells exist before adds
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
    await rebuild_place_boundary_cells(session)  # boundary-load equivalent: cells exist before adds
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
    await rebuild_place_boundary_cells(session)  # boundary-load equivalent: cells exist before adds
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
