"""Slice 2 — public crawlable-place list ``GET /api/v1/places`` (#127, spec §5).

Integration tests against the local PostGIS container (the CI mirror). Most tests seed
``place_boundaries`` directly with the SAME is_canonical invariant the real Slice 1 refresh
produces — **countries are is_canonical=false** (that flag disambiguates same-(country_code, slug)
*city* rows only; see app/membership.py), **cities are is_canonical=true** for the one that owns
the slug. ``test_real_refresh_*`` proves the endpoint against the actual ``refresh_all_memberships``
contract (not hand-set flags). K (the thin-content gate) is pinned to 3 via a settings override.
"""

from __future__ import annotations

import pytest
from httpx import ASGITransport, AsyncClient
from sqlalchemy import text

from app.config import Settings, get_settings
from app.main import app
from app.membership import refresh_all_memberships

_K = 3
_UNIT_SQUARE = "POLYGON((0 0, 1 0, 1 1, 0 1, 0 0))"


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
    is_canonical: bool,
    parent_id=None,
    wkt: str = _UNIT_SQUARE,
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
                        ST_Multi(ST_GeomFromText(:wkt, 4326))::geography, now(), now())
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
                "wkt": wkt,
            },
        )
    ).one()
    return row.id


async def _add_fountain(session, lat: float, lng: float, *, hidden: bool = False):
    await session.execute(
        text(
            """
            INSERT INTO fountains (id, location, is_hidden, created_source)
            VALUES (gen_random_uuid(),
                    ST_SetSRID(ST_MakePoint(:lng, :lat), 4326)::geography, :hidden, 'admin_import')
            """
        ),
        {"lat": lat, "lng": lng, "hidden": hidden},
    )


def _sq(x0: float, y0: float, x1: float, y1: float) -> str:
    return f"POLYGON(({x0} {y0}, {x1} {y0}, {x1} {y1}, {x0} {y1}, {x0} {y0}))"


@pytest.mark.asyncio
async def test_lists_countries_above_threshold_ordered(session, api):
    """Countries (is_canonical=false, as the real refresh leaves them) with fountain_count >= K,
    ordered by count desc then name."""
    await _add_place(
        session,
        overture_id="us",
        subtype="country",
        country_code="us",
        name="United States",
        slug="united-states",
        fountain_count=10,
        is_canonical=False,
    )
    await _add_place(
        session,
        overture_id="lu",
        subtype="country",
        country_code="lu",
        name="Luxembourg",
        slug="luxembourg",
        fountain_count=5,
        is_canonical=False,
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
        is_canonical=False,
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
async def test_country_list_excludes_cities(session, api):
    """The countries list is subtype='country' only — city rows never appear."""
    us = await _add_place(
        session,
        overture_id="us",
        subtype="country",
        country_code="us",
        name="United States",
        slug="united-states",
        fountain_count=10,
        is_canonical=False,
    )
    await _add_place(
        session,
        overture_id="us-city",
        subtype="locality",
        country_code="us",
        name="San Diego",
        slug="san-diego",
        fountain_count=8,
        is_canonical=True,
        parent_id=us,
    )
    await session.commit()

    resp = await api.get("/api/v1/places")
    assert resp.status_code == 200
    assert [p["slug"] for p in resp.json()] == ["united-states"]


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
        is_canonical=False,
    )
    lu = await _add_place(
        session,
        overture_id="lu",
        subtype="country",
        country_code="lu",
        name="Luxembourg",
        slug="luxembourg",
        fountain_count=50,
        is_canonical=False,
    )
    await _add_place(
        session,
        overture_id="sd",
        subtype="locality",
        country_code="us",
        name="San Diego",
        slug="san-diego",
        fountain_count=8,
        is_canonical=True,
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
        is_canonical=True,
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
        is_canonical=True,
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
        is_canonical=True,
        parent_id=lu,
    )
    await session.commit()

    resp = await api.get("/api/v1/places", params={"country": "us"})
    assert resp.status_code == 200
    body = resp.json()
    assert [p["slug"] for p in body] == ["los-angeles", "san-diego"]  # count desc; tinytown gated
    assert all(p["subtype"] != "country" for p in body)


@pytest.mark.asyncio
async def test_cities_list_excludes_non_canonical(session, api):
    """A non-canonical city (a slug-collision loser, is_canonical=false) is excluded — this is
    where the is_canonical filter matters (cities, not countries)."""
    us = await _add_place(
        session,
        overture_id="us",
        subtype="country",
        country_code="us",
        name="United States",
        slug="united-states",
        fountain_count=100,
        is_canonical=False,
    )
    await _add_place(
        session,
        overture_id="riv-loc",
        subtype="locality",
        country_code="us",
        name="Riverside",
        slug="riverside",
        fountain_count=8,
        is_canonical=True,
        parent_id=us,
    )
    await _add_place(
        session,
        overture_id="riv-la",
        subtype="localadmin",
        country_code="us",
        name="Riverside",
        slug="riverside",
        fountain_count=99,
        is_canonical=False,
        parent_id=us,
    )
    await session.commit()

    resp = await api.get("/api/v1/places", params={"country": "us"})
    assert resp.status_code == 200
    body = resp.json()
    # Only the canonical Riverside (locality) survives; the non-canonical localadmin twin is gone.
    assert len(body) == 1
    assert body[0]["name"] == "Riverside" and body[0]["subtype"] == "locality"


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
        is_canonical=False,
    )
    await _add_place(
        session,
        overture_id="sd",
        subtype="locality",
        country_code="us",
        name="San Diego",
        slug="san-diego",
        fountain_count=8,
        is_canonical=True,
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
        is_canonical=False,
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
        is_canonical=False,
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
            is_canonical=False,
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


@pytest.mark.asyncio
async def test_real_refresh_makes_country_and_city_listable(session, api):
    """End-to-end against the REAL Slice 1 contract: seed a country + city + fountains, run the
    actual refresh_all_memberships (which leaves the country is_canonical=false and marks the city
    canonical), and prove /api/v1/places returns BOTH. This is the guard for the class of bug where
    the endpoint filtered countries on is_canonical and returned [] for a normally-loaded scope."""
    await _add_place(
        session,
        overture_id="us",
        subtype="country",
        country_code="us",
        name="United States",
        slug="united-states",
        fountain_count=0,
        is_canonical=False,
        wkt=_sq(0, 0, 10, 10),
    )
    await _add_place(
        session,
        overture_id="us-city",
        subtype="locality",
        country_code="us",
        name="San Diego",
        slug="san-diego",
        fountain_count=0,
        is_canonical=False,
        wkt=_sq(1, 1, 2, 2),
    )
    # 3 fountains inside the city (>= K=3) so both country and city clear the gate.
    for lat, lng in [(1.5, 1.5), (1.6, 1.6), (1.4, 1.4)]:
        await _add_fountain(session, lat=lat, lng=lng)
    await refresh_all_memberships(session)
    await session.commit()

    # The country is listable even though the real refresh leaves it is_canonical=false.
    countries = (await api.get("/api/v1/places")).json()
    assert [c["country_code"] for c in countries] == ["us"]
    assert countries[0]["fountain_count"] == 3

    # Its canonical city is listable under the parent.
    cities = (await api.get("/api/v1/places", params={"country": "us"})).json()
    assert [c["slug"] for c in cities] == ["san-diego"]
    assert cities[0]["fountain_count"] == 3


# --- GET /api/v1/places/{country}/{city}/fountains (Slice 3) ---


async def _add_city_fountain(
    session,
    place_id,
    *,
    ranking_score=None,
    rating_count=0,
    average_rating=None,
    is_working=True,
    hidden=False,
):
    """A fountain pinned to a city via the precomputed city_place_id (geometry is irrelevant —
    the endpoint reads membership, not PIP)."""
    row = (
        await session.execute(
            text(
                """
                INSERT INTO fountains
                    (id, location, is_hidden, is_working, created_source,
                     city_place_id, ranking_score, rating_count, average_rating)
                VALUES (gen_random_uuid(), ST_SetSRID(ST_MakePoint(1.5, 1.5), 4326)::geography,
                        :hidden, :working, 'admin_import', :pid, :score, :rc, :avg)
                RETURNING id
                """
            ),
            {
                "hidden": hidden,
                "working": is_working,
                "pid": place_id,
                "score": ranking_score,
                "rc": rating_count,
                "avg": average_rating,
            },
        )
    ).one()
    return row.id


async def _seed_city(session, *, fountain_count):
    us = await _add_place(
        session,
        overture_id="us",
        subtype="country",
        country_code="us",
        name="United States",
        slug="united-states",
        fountain_count=fountain_count,
        is_canonical=False,
    )
    city = await _add_place(
        session,
        overture_id="sd",
        subtype="locality",
        country_code="us",
        name="San Diego",
        slug="san-diego",
        fountain_count=fountain_count,
        is_canonical=True,
        parent_id=us,
    )
    return city


@pytest.mark.asyncio
async def test_city_fountains_ranked_best_first(session, api):
    """Fountains come back best-rated first: ranking_score desc, unrated (NULL) last, then more
    ratings, then id — and the response carries the city place (name + total count)."""
    city = await _seed_city(session, fountain_count=4)
    top = await _add_city_fountain(
        session, city, ranking_score=0.9, rating_count=10, average_rating=4.6
    )
    mid = await _add_city_fountain(
        session, city, ranking_score=0.5, rating_count=8, average_rating=3.2
    )
    # Same score as mid but fewer ratings -> sorts after mid on the rating_count tiebreak.
    low = await _add_city_fountain(
        session, city, ranking_score=0.5, rating_count=2, average_rating=3.2
    )
    unrated = await _add_city_fountain(session, city, ranking_score=None, rating_count=0)
    await session.commit()

    resp = await api.get("/api/v1/places/us/san-diego/fountains")
    assert resp.status_code == 200
    body = resp.json()
    assert body["place"]["name"] == "San Diego"
    assert body["place"]["fountain_count"] == 4
    assert body["indexable"] is True  # 4 >= K (3)
    ids = [f["id"] for f in body["fountains"]]
    assert ids == [str(top), str(mid), str(low), str(unrated)]
    assert body["fountains"][0]["average_rating"] == 4.6


@pytest.mark.asyncio
async def test_city_fountains_excludes_hidden(session, api):
    """Hidden fountains never appear in the public list."""
    city = await _seed_city(session, fountain_count=1)
    await _add_city_fountain(session, city, ranking_score=0.9, rating_count=5)
    await _add_city_fountain(session, city, ranking_score=0.8, rating_count=5, hidden=True)
    await session.commit()

    body = (await api.get("/api/v1/places/us/san-diego/fountains")).json()
    assert len(body["fountains"]) == 1


@pytest.mark.asyncio
async def test_city_fountains_below_gate_still_serves_but_not_indexable(session, api):
    """A city below K still serves its fountains (200) but is flagged indexable=false — the web
    renders it with noindex (spec §7), rather than 404ing a real-but-thin place."""
    city = await _seed_city(session, fountain_count=2)  # < K (3)
    await _add_city_fountain(session, city, ranking_score=0.9, rating_count=3)
    await _add_city_fountain(session, city, ranking_score=0.5, rating_count=1)
    await session.commit()

    resp = await api.get("/api/v1/places/us/san-diego/fountains")
    assert resp.status_code == 200
    body = resp.json()
    assert body["indexable"] is False
    assert len(body["fountains"]) == 2


@pytest.mark.asyncio
async def test_city_fountains_pagination(session, api):
    """limit caps the page; offset walks it, stable under the rank order."""
    city = await _seed_city(session, fountain_count=3)
    a = await _add_city_fountain(session, city, ranking_score=0.9, rating_count=9)
    b = await _add_city_fountain(session, city, ranking_score=0.8, rating_count=8)
    c = await _add_city_fountain(session, city, ranking_score=0.7, rating_count=7)
    await session.commit()

    page1 = (await api.get("/api/v1/places/us/san-diego/fountains", params={"limit": 2})).json()
    assert [f["id"] for f in page1["fountains"]] == [str(a), str(b)]
    page2 = (
        await api.get("/api/v1/places/us/san-diego/fountains", params={"limit": 2, "offset": 2})
    ).json()
    assert [f["id"] for f in page2["fountains"]] == [str(c)]


@pytest.mark.asyncio
async def test_city_fountains_404_for_unknown_city(session, api):
    """No canonical city for (country, slug) -> 404 so the web page can notFound()."""
    await _seed_city(session, fountain_count=1)
    await session.commit()
    assert (await api.get("/api/v1/places/us/nowhere/fountains")).status_code == 404
    assert (await api.get("/api/v1/places/zz/san-diego/fountains")).status_code == 404


@pytest.mark.asyncio
async def test_city_fountains_case_insensitive_and_cacheable(session, api):
    """Country + city segments resolve case-insensitively; the response is publicly cacheable."""
    city = await _seed_city(session, fountain_count=1)
    await _add_city_fountain(session, city, ranking_score=0.9, rating_count=3)
    await session.commit()

    resp = await api.get("/api/v1/places/US/San-Diego/fountains")
    assert resp.status_code == 200
    assert resp.json()["place"]["slug"] == "san-diego"
    assert "public" in resp.headers.get("cache-control", "")


@pytest.mark.asyncio
async def test_city_fountains_only_this_city(session, api):
    """Fountains of a different city (different city_place_id) never leak in."""
    city = await _seed_city(session, fountain_count=1)
    other = await _add_place(
        session,
        overture_id="la",
        subtype="locality",
        country_code="us",
        name="Los Angeles",
        slug="los-angeles",
        fountain_count=1,
        is_canonical=True,
    )
    await _add_city_fountain(session, city, ranking_score=0.9, rating_count=3)
    await _add_city_fountain(session, other, ranking_score=0.95, rating_count=9)
    await session.commit()

    body = (await api.get("/api/v1/places/us/san-diego/fountains")).json()
    assert len(body["fountains"]) == 1
