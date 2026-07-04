"""Slice 2 — public crawlable-place list ``GET /api/v1/places`` (#127, spec §5).

Integration tests against the local PostGIS container (the CI mirror). Seeds ``place_boundaries``
rows directly with explicit ``is_canonical`` / ``fountain_count`` / ``parent_id`` (this endpoint
reads the precomputed columns and never runs point-in-polygon, so membership refresh is not
exercised here). The thin-content gate ``K`` is pinned to 3 via a settings override so the tests
are independent of the default. Boundary geometry is a throwaway unit square — the endpoint never
touches it.
"""

from __future__ import annotations

import pytest
from httpx import ASGITransport, AsyncClient
from sqlalchemy import text

from app.config import Settings, get_settings
from app.main import app

_K = 3


@pytest.fixture
def _seo_settings():
    # Pin the thin-content gate so the assertions don't depend on the default value.
    app.dependency_overrides[get_settings] = lambda: Settings(seo_place_min_fountains=_K)
    yield
    app.dependency_overrides.pop(get_settings, None)


@pytest.fixture
async def api(_seo_settings) -> AsyncClient:
    # A plain, UNAUTHENTICATED client (no get_current_user override): the endpoint is public.
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        yield ac


async def _add_place(
    session,
    *,
    overture_id: str,
    subtype: str,
    country_code: str,
    name: str,
    slug: str,
    fountain_count: int,
    is_canonical: bool = True,
    parent_id=None,
):
    row = (
        await session.execute(
            text(
                """
                INSERT INTO place_boundaries
                    (id, overture_id, subtype, class, name, country_code, slug,
                     is_canonical, fountain_count, parent_id, boundary, created_at, updated_at)
                VALUES (gen_random_uuid(), :oid, :subtype, 'land', :name, :cc, :slug,
                        :canon, :fc, :parent,
                        ST_Multi(ST_GeomFromText(
                            'POLYGON((0 0, 1 0, 1 1, 0 1, 0 0))', 4326))::geography,
                        now(), now())
                RETURNING id
                """
            ),
            {
                "oid": overture_id,
                "subtype": subtype,
                "name": name,
                "cc": country_code,
                "slug": slug,
                "canon": is_canonical,
                "fc": fountain_count,
                "parent": parent_id,
            },
        )
    ).one()
    return row.id


@pytest.mark.asyncio
async def test_lists_canonical_countries_above_threshold_ordered(session, api):
    """Countries with fountain_count >= K, canonical only, ordered by count desc then name."""
    await _add_place(
        session,
        overture_id="us",
        subtype="country",
        country_code="us",
        name="United States",
        slug="united-states",
        fountain_count=10,
    )
    await _add_place(
        session,
        overture_id="lu",
        subtype="country",
        country_code="lu",
        name="Luxembourg",
        slug="luxembourg",
        fountain_count=5,
    )
    # Below the gate (K=3) -> excluded.
    await _add_place(
        session,
        overture_id="mc",
        subtype="country",
        country_code="mc",
        name="Monaco",
        slug="monaco",
        fountain_count=2,
    )
    await session.commit()

    resp = await api.get("/api/v1/places")
    assert resp.status_code == 200
    body = resp.json()
    assert [p["country_code"] for p in body] == ["us", "lu"]  # count desc; mc gated out
    assert body[0]["name"] == "United States"
    assert body[0]["fountain_count"] == 10
    assert body[0]["subtype"] == "country"


@pytest.mark.asyncio
async def test_excludes_non_canonical_and_child_places_from_country_list(session, api):
    """The countries list excludes non-canonical rows and any non-country subtype."""
    us = await _add_place(
        session,
        overture_id="us",
        subtype="country",
        country_code="us",
        name="United States",
        slug="united-states",
        fountain_count=10,
    )
    # A non-canonical duplicate country -> excluded even though it is over the gate.
    await _add_place(
        session,
        overture_id="us-dupe",
        subtype="country",
        country_code="us",
        name="USA",
        slug="usa",
        fountain_count=99,
        is_canonical=False,
    )
    # A city (child place) -> never in the countries list.
    await _add_place(
        session,
        overture_id="us-city",
        subtype="locality",
        country_code="us",
        name="San Diego",
        slug="san-diego",
        fountain_count=8,
        parent_id=us,
    )
    await session.commit()

    resp = await api.get("/api/v1/places")
    assert resp.status_code == 200
    body = resp.json()
    assert [p["slug"] for p in body] == ["united-states"]


@pytest.mark.asyncio
async def test_cities_by_parent(session, api):
    """?country=us returns that country's canonical cities >= K, ordered by count; excludes other
    countries' cities and the country row itself."""
    us = await _add_place(
        session,
        overture_id="us",
        subtype="country",
        country_code="us",
        name="United States",
        slug="united-states",
        fountain_count=100,
    )
    lu = await _add_place(
        session,
        overture_id="lu",
        subtype="country",
        country_code="lu",
        name="Luxembourg",
        slug="luxembourg",
        fountain_count=50,
    )
    await _add_place(
        session,
        overture_id="sd",
        subtype="locality",
        country_code="us",
        name="San Diego",
        slug="san-diego",
        fountain_count=8,
        parent_id=us,
    )
    await _add_place(
        session,
        overture_id="la",
        subtype="locality",
        country_code="us",
        name="Los Angeles",
        slug="los-angeles",
        fountain_count=20,
        parent_id=us,
    )
    # Below the gate -> excluded.
    await _add_place(
        session,
        overture_id="tiny",
        subtype="locality",
        country_code="us",
        name="Tinytown",
        slug="tinytown",
        fountain_count=1,
        parent_id=us,
    )
    # A LU city -> must not leak into the US query.
    await _add_place(
        session,
        overture_id="lux-city",
        subtype="locality",
        country_code="lu",
        name="Luxembourg City",
        slug="luxembourg-city",
        fountain_count=9,
        parent_id=lu,
    )
    await session.commit()

    resp = await api.get("/api/v1/places", params={"country": "us"})
    assert resp.status_code == 200
    body = resp.json()
    assert [p["slug"] for p in body] == ["los-angeles", "san-diego"]  # count desc; tinytown gated
    assert all(p["subtype"] != "country" for p in body)


@pytest.mark.asyncio
async def test_country_segment_is_case_insensitive(session, api):
    """The ISO-2 segment is matched case-insensitively (URL uses lowercase)."""
    us = await _add_place(
        session,
        overture_id="us",
        subtype="country",
        country_code="us",
        name="United States",
        slug="united-states",
        fountain_count=100,
    )
    await _add_place(
        session,
        overture_id="sd",
        subtype="locality",
        country_code="us",
        name="San Diego",
        slug="san-diego",
        fountain_count=8,
        parent_id=us,
    )
    await session.commit()

    resp = await api.get("/api/v1/places", params={"country": "US"})
    assert resp.status_code == 200
    assert [p["slug"] for p in resp.json()] == ["san-diego"]


@pytest.mark.asyncio
async def test_unknown_country_returns_empty(session, api):
    """?country=zz with no such loaded country -> empty list (the page 404s separately)."""
    await _add_place(
        session,
        overture_id="us",
        subtype="country",
        country_code="us",
        name="United States",
        slug="united-states",
        fountain_count=100,
    )
    await session.commit()

    resp = await api.get("/api/v1/places", params={"country": "zz"})
    assert resp.status_code == 200
    assert resp.json() == []


@pytest.mark.asyncio
async def test_public_and_sets_cache_header(session, api):
    """The endpoint is public (no auth) and sends a shared, cacheable Cache-Control."""
    await _add_place(
        session,
        overture_id="us",
        subtype="country",
        country_code="us",
        name="United States",
        slug="united-states",
        fountain_count=10,
    )
    await session.commit()

    resp = await api.get("/api/v1/places")
    assert resp.status_code == 200  # no Authorization header required
    cache = resp.headers.get("cache-control", "")
    assert "public" in cache and "max-age=" in cache and "s-maxage=" in cache


@pytest.mark.asyncio
async def test_limit_and_offset(session, api):
    """limit caps the page; offset walks it (both stable under the count-desc order)."""
    for i, cc in enumerate(["aa", "bb", "cc", "dd"]):
        await _add_place(
            session,
            overture_id=cc,
            subtype="country",
            country_code=cc,
            name=f"Country {cc}",
            slug=cc,
            fountain_count=100 - i,
        )
    await session.commit()

    page1 = await api.get("/api/v1/places", params={"limit": 2})
    assert [p["country_code"] for p in page1.json()] == ["aa", "bb"]
    page2 = await api.get("/api/v1/places", params={"limit": 2, "offset": 2})
    assert [p["country_code"] for p in page2.json()] == ["cc", "dd"]


@pytest.mark.asyncio
async def test_limit_bounds_are_enforced(api):
    """limit is a hard cap in the contract: <1 or >1000 is a 422, not a silent clamp."""
    assert (await api.get("/api/v1/places", params={"limit": 0})).status_code == 422
    assert (await api.get("/api/v1/places", params={"limit": 1001})).status_code == 422
    assert (await api.get("/api/v1/places", params={"offset": -1})).status_code == 422
