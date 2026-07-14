"""Slice 5 — public fountain place + indexability: ``GET /api/v1/fountains/{id}/place`` and
``GET /api/v1/fountains/sitemap`` (#127, spec §5/§7).

Integration tests against the local PostGIS container (the CI mirror). The single public indexing
predicate (spec §7) is: a city resolves **AND** the fountain is not hidden **AND** (``rating_count
>= 1`` **OR** (``is_working`` **AND** ``current_status`` is not a negative state — ``degraded`` /
``not_working``)). It is computed ONLY from public, non-hidden columns — never the viewer/admin path
— so auth/admin state can never influence indexability. Both endpoints read the precomputed
``city_place_id`` / ``country_place_id`` membership (never a live ST_Covers).

Fountains are seeded with membership + status columns set directly, and places with the same
is_canonical invariant the real refresh produces (cities canonical, countries not).
"""

from __future__ import annotations

import uuid

import pytest
from httpx import ASGITransport, AsyncClient
from sqlalchemy import text

from app.main import app

_UNIT_SQUARE = "POLYGON((0 0, 1 0, 1 1, 0 1, 0 0))"


@pytest.fixture
async def api() -> AsyncClient:
    # A plain, UNAUTHENTICATED client: both endpoints are public.
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
    fountain_count: int = 5,
    is_canonical: bool = True,
    parent_id=None,
    place_kind: str | None = None,
) -> uuid.UUID:
    if place_kind is None:
        place_kind = "country" if subtype == "country" else "city"
    row = (
        await session.execute(
            text(
                """
                INSERT INTO place_boundaries
                    (id, overture_id, subtype, class, place_kind, name, country_code, slug,
                     is_canonical, fountain_count, parent_id, boundary, created_at, updated_at)
                VALUES (gen_random_uuid(), :oid, :subtype, 'land', :kind, :name, :cc, :slug,
                        :canon, :fc, :parent,
                        ST_Multi(ST_GeomFromText(:wkt, 4326))::geography, now(), now())
                RETURNING id
                """
            ),
            {
                "oid": overture_id,
                "subtype": subtype,
                "kind": place_kind,
                "name": name,
                "cc": country_code,
                "slug": slug,
                "canon": is_canonical,
                "fc": fountain_count,
                "parent": parent_id,
                "wkt": _UNIT_SQUARE,
            },
        )
    ).one()
    return row.id


async def _add_fountain(
    session,
    *,
    city_place_id=None,
    region_place_id=None,
    country_place_id=None,
    is_hidden: bool = False,
    is_working: bool = True,
    current_status: str | None = None,
    rating_count: int = 0,
    average_rating=None,
    ranking_score=None,
) -> uuid.UUID:
    row = (
        await session.execute(
            text(
                """
                INSERT INTO fountains
                    (id, location, is_hidden, is_working, current_status, created_source,
                     city_place_id, region_place_id, country_place_id, rating_count, average_rating,
                     ranking_score)
                VALUES (gen_random_uuid(), ST_SetSRID(ST_MakePoint(0.5, 0.5), 4326)::geography,
                        :hidden, :working, :status, 'admin_import',
                        :city, :region, :country, :rc, :avg, :score)
                RETURNING id
                """
            ),
            {
                "hidden": is_hidden,
                "working": is_working,
                "status": current_status,
                "city": city_place_id,
                "region": region_place_id,
                "country": country_place_id,
                "rc": rating_count,
                "avg": average_rating,
                "score": ranking_score,
            },
        )
    ).one()
    return row.id


async def _seed_country_city(session) -> tuple[uuid.UUID, uuid.UUID]:
    country = await _add_place(
        session,
        overture_id="us",
        subtype="country",
        country_code="us",
        name="United States",
        slug="united-states",
        is_canonical=False,
    )
    city = await _add_place(
        session,
        overture_id="us-nyc",
        subtype="locality",
        country_code="us",
        name="Manhattan",
        slug="manhattan",
        parent_id=country,
    )
    return country, city


# --- GET /fountains/{id}/place ---------------------------------------------------------------


@pytest.mark.asyncio
async def test_place_resolves_city_and_country_and_indexable(session, api):
    """A non-hidden, rated fountain in a resolved city returns its city + country PlaceOut and
    indexable=true; the response echoes the fountain id."""
    country, city = await _seed_country_city(session)
    fid = await _add_fountain(
        session, city_place_id=city, country_place_id=country, rating_count=3, average_rating=4.5
    )
    await session.commit()

    resp = await api.get(f"/api/v1/fountains/{fid}/place")
    assert resp.status_code == 200
    body = resp.json()
    assert body["fountain_id"] == str(fid)
    assert body["indexable"] is True
    assert body["city"]["slug"] == "manhattan"
    assert body["city"]["name"] == "Manhattan"
    assert body["city"]["country_code"] == "us"
    assert body["region"] is None
    assert body["country"]["subtype"] == "country"


@pytest.mark.asyncio
async def test_place_returns_parent_region_for_region_tier_city(session, api):
    country = await _add_place(
        session,
        overture_id="us",
        subtype="country",
        country_code="us",
        name="United States",
        slug="united-states",
        is_canonical=False,
    )
    region = await _add_place(
        session,
        overture_id="oregon",
        subtype="region",
        country_code="us",
        name="Oregon",
        slug="oregon",
        parent_id=country,
        place_kind="region",
    )
    city = await _add_place(
        session,
        overture_id="portland",
        subtype="locality",
        country_code="us",
        name="Portland",
        slug="portland",
        parent_id=region,
    )
    fid = await _add_fountain(
        session,
        city_place_id=city,
        region_place_id=region,
        country_place_id=country,
        rating_count=1,
    )
    await session.commit()

    body = (await api.get(f"/api/v1/fountains/{fid}/place")).json()
    assert body["city"]["slug"] == "portland"
    assert body["region"]["slug"] == "oregon"
    assert body["region"]["place_kind"] == "region"
    assert body["country"]["slug"] == "united-states"


@pytest.mark.asyncio
async def test_place_indexable_when_rated_even_if_broken(session, api):
    """rating_count >= 1 satisfies indexability on its own — a broken/degraded but rated fountain is
    still worth indexing (it has community content)."""
    country, city = await _seed_country_city(session)
    fid = await _add_fountain(
        session,
        city_place_id=city,
        country_place_id=country,
        is_working=False,
        current_status="not_working",
        rating_count=2,
    )
    await session.commit()

    body = (await api.get(f"/api/v1/fountains/{fid}/place")).json()
    assert body["indexable"] is True


@pytest.mark.asyncio
@pytest.mark.parametrize("status", [None, "ok", "reported_issue"])
async def test_place_indexable_when_working_and_not_negative(session, api, status):
    """An unrated but working fountain whose derived status is NOT a hard negative (NULL / ok /
    reported_issue advisory) is indexable via the working branch."""
    country, city = await _seed_country_city(session)
    fid = await _add_fountain(
        session,
        city_place_id=city,
        country_place_id=country,
        is_working=True,
        current_status=status,
        rating_count=0,
    )
    await session.commit()

    body = (await api.get(f"/api/v1/fountains/{fid}/place")).json()
    assert body["indexable"] is True


@pytest.mark.asyncio
@pytest.mark.parametrize("status", ["degraded", "not_working"])
async def test_place_not_indexable_when_unrated_and_negative_status(session, api, status):
    """An unrated fountain in a negative operational state (degraded / not_working) is NOT indexable
    — a thin page for a known-broken fountain with no ratings."""
    country, city = await _seed_country_city(session)
    fid = await _add_fountain(
        session,
        city_place_id=city,
        country_place_id=country,
        is_working=True,
        current_status=status,
        rating_count=0,
    )
    await session.commit()

    body = (await api.get(f"/api/v1/fountains/{fid}/place")).json()
    assert body["indexable"] is False


@pytest.mark.asyncio
async def test_place_not_indexable_when_unrated_and_not_working(session, api):
    """An unrated fountain flagged is_working=false (with no derived status) is NOT indexable."""
    country, city = await _seed_country_city(session)
    fid = await _add_fountain(
        session,
        city_place_id=city,
        country_place_id=country,
        is_working=False,
        current_status=None,
        rating_count=0,
    )
    await session.commit()

    body = (await api.get(f"/api/v1/fountains/{fid}/place")).json()
    assert body["indexable"] is False


@pytest.mark.asyncio
async def test_place_not_indexable_when_no_city(session, api):
    """No city resolves (city_place_id NULL) -> not indexable, even for a rated fountain. The city
    comes back as null; the country (if any) still resolves."""
    country, _city = await _seed_country_city(session)
    fid = await _add_fountain(session, city_place_id=None, country_place_id=country, rating_count=5)
    await session.commit()

    body = (await api.get(f"/api/v1/fountains/{fid}/place")).json()
    assert body["indexable"] is False
    assert body["city"] is None
    assert body["country"]["country_code"] == "us"


@pytest.mark.asyncio
async def test_place_hidden_fountain_is_404(session, api):
    """A hidden fountain 404s (matching the detail endpoint) — auth/admin state can never surface it
    or make it indexable, since the endpoint only ever reads non-hidden rows."""
    _country, city = await _seed_country_city(session)
    fid = await _add_fountain(session, city_place_id=city, is_hidden=True, rating_count=9)
    await session.commit()

    assert (await api.get(f"/api/v1/fountains/{fid}/place")).status_code == 404


@pytest.mark.asyncio
async def test_place_unknown_fountain_is_404(api):
    """An unknown (well-formed) id 404s; a non-UUID path 422s (UUID path converter)."""
    assert (await api.get(f"/api/v1/fountains/{uuid.uuid4()}/place")).status_code == 404
    assert (await api.get("/api/v1/fountains/not-a-uuid/place")).status_code == 422


@pytest.mark.asyncio
async def test_place_public_and_cacheable(session, api):
    """No auth required; a shared, cacheable Cache-Control is set (in the contract)."""
    _country, city = await _seed_country_city(session)
    fid = await _add_fountain(session, city_place_id=city, rating_count=1)
    await session.commit()

    resp = await api.get(f"/api/v1/fountains/{fid}/place")
    assert resp.status_code == 200
    cache = resp.headers.get("cache-control", "")
    assert "public" in cache and "max-age=" in cache and "s-maxage=" in cache


# --- GET /fountains/sitemap ------------------------------------------------------------------


@pytest.mark.asyncio
async def test_sitemap_lists_only_indexable_ids(session, api):
    """The sitemap enumerates exactly the indexable fountains (same §7 predicate): it excludes
    hidden, no-city, and unrated-broken fountains, and reports the full indexable total_count."""
    country, city = await _seed_country_city(session)
    ok = await _add_fountain(session, city_place_id=city, country_place_id=country, rating_count=4)
    working = await _add_fountain(
        session, city_place_id=city, country_place_id=country, is_working=True, current_status="ok"
    )
    # Excluded: hidden, no city, and unrated + not_working.
    await _add_fountain(session, city_place_id=city, is_hidden=True, rating_count=4)
    await _add_fountain(session, city_place_id=None, country_place_id=country, rating_count=4)
    await _add_fountain(
        session, city_place_id=city, is_working=False, current_status="not_working", rating_count=0
    )
    await session.commit()

    body = (await api.get("/api/v1/fountains/sitemap")).json()
    assert body["total_count"] == 2
    assert set(body["fountain_ids"]) == {str(ok), str(working)}
    # Deterministic order (by id) so paging is stable.
    assert body["fountain_ids"] == sorted(body["fountain_ids"])


@pytest.mark.asyncio
async def test_sitemap_pagination(session, api):
    """limit caps the page; offset walks it; total_count is the full indexable count."""
    country, city = await _seed_country_city(session)
    for _ in range(3):
        await _add_fountain(session, city_place_id=city, country_place_id=country, rating_count=1)
    await session.commit()

    page1 = (await api.get("/api/v1/fountains/sitemap", params={"limit": 2})).json()
    assert len(page1["fountain_ids"]) == 2
    assert page1["total_count"] == 3
    page2 = (await api.get("/api/v1/fountains/sitemap", params={"limit": 2, "offset": 2})).json()
    assert len(page2["fountain_ids"]) == 1
    # The two pages together cover the full, non-overlapping set.
    assert set(page1["fountain_ids"]) | set(page2["fountain_ids"]) == set(
        page1["fountain_ids"] + page2["fountain_ids"]
    )
    assert len(set(page1["fountain_ids"]) & set(page2["fountain_ids"])) == 0


@pytest.mark.asyncio
async def test_sitemap_limit_bounds_enforced(api):
    """limit is a hard cap in the contract: <1 or >50000 is a 422; offset must be >= 0."""
    assert (await api.get("/api/v1/fountains/sitemap", params={"limit": 0})).status_code == 422
    assert (await api.get("/api/v1/fountains/sitemap", params={"limit": 50001})).status_code == 422
    assert (await api.get("/api/v1/fountains/sitemap", params={"offset": -1})).status_code == 422


@pytest.mark.asyncio
async def test_sitemap_public_and_cacheable(session, api):
    """The endpoint is public (no auth) and sends a shared, cacheable Cache-Control."""
    _country, city = await _seed_country_city(session)
    await _add_fountain(session, city_place_id=city, rating_count=1)
    await session.commit()

    resp = await api.get("/api/v1/fountains/sitemap")
    assert resp.status_code == 200
    cache = resp.headers.get("cache-control", "")
    assert "public" in cache and "max-age=" in cache and "s-maxage=" in cache
