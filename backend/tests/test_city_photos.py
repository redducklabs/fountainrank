"""Task B15 — city-list photo thumbnail + count (`CityFountainPin`, spec §12).

``GET /api/v1/places/{country}/{city}/fountains`` now returns ``photo_count`` and
``thumbnail_url`` per fountain, computed via correlated scalar subqueries over
``fountain_photos`` (newest VISIBLE photo id -> thumbnail URL; count of VISIBLE photos).
Hidden photos must never affect either field. The existing rank/pagination contract
(``ranking_score`` desc nulls-last, ``rating_count`` desc, ``id`` asc; ``limit``/``offset``)
must be byte-for-byte unchanged versus a no-photo baseline — the subqueries are per-row
scalars and must not fan out the result set.

The map/bbox endpoint (``GET /api/v1/fountains/bbox``) uses the plain ``FountainPin`` and
must NOT gain these fields — that regression would mean the wrong router got touched.
"""

from __future__ import annotations

import uuid

import pytest
from httpx import ASGITransport, AsyncClient
from sqlalchemy import text

from app.config import Settings, get_settings
from app.main import app

_K = 3
_UNIT_SQUARE = "POLYGON((0 0, 1 0, 1 1, 0 1, 0 0))"


@pytest.fixture
def _seo_settings():
    app.dependency_overrides[get_settings] = lambda: Settings(seo_place_min_fountains=_K)
    yield
    app.dependency_overrides.pop(get_settings, None)


@pytest.fixture
async def api(_seo_settings) -> AsyncClient:
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
                "wkt": wkt,
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


async def _add_user(session, *, suffix: str = ""):
    uid = uuid.uuid4()
    await session.execute(
        text(
            "INSERT INTO users (id, logto_user_id, display_name, email) "
            "VALUES (:id, :lid, 'T', :email)"
        ),
        {"id": uid, "lid": f"lid-{uid}{suffix}", "email": f"{uid}{suffix}@example.com"},
    )
    return uid


async def _add_photo(session, fountain_id, user_id, *, hidden: bool = False):
    pid = uuid.uuid4()
    await session.execute(
        text(
            """
            INSERT INTO fountain_photos
                (id, fountain_id, user_id, storage_key, thumbnail_key, content_type,
                 width, height, byte_size, is_hidden, created_at, updated_at)
            VALUES (:id, :fid, :uid, :sk, :tk, 'image/jpeg', 800, 600, 12345, :hidden,
                    now(), now())
            """
        ),
        {
            "id": pid,
            "fid": fountain_id,
            "uid": user_id,
            "sk": f"photos/{pid}.jpg",
            "tk": f"photos/{pid}-thumb.jpg",
            "hidden": hidden,
        },
    )
    return pid


@pytest.mark.asyncio
async def test_city_fountains_no_photos_defaults(session, api):
    """A fountain with no photos -> photo_count 0, thumbnail_url None (not omitted)."""
    city = await _seed_city(session, fountain_count=1)
    await _add_city_fountain(session, city, ranking_score=0.9, rating_count=3)
    await session.commit()

    body = (await api.get("/api/v1/places/us/san-diego/fountains")).json()
    assert len(body["fountains"]) == 1
    pin = body["fountains"][0]
    assert pin["photo_count"] == 0
    assert pin["thumbnail_url"] is None


@pytest.mark.asyncio
async def test_city_fountains_one_photo(session, api):
    """A single visible photo -> count 1, thumbnail_url points at that photo's thumb."""
    city = await _seed_city(session, fountain_count=1)
    fid = await _add_city_fountain(session, city, ranking_score=0.9, rating_count=3)
    user = await _add_user(session)
    photo = await _add_photo(session, fid, user)
    await session.commit()

    body = (await api.get("/api/v1/places/us/san-diego/fountains")).json()
    pin = body["fountains"][0]
    assert pin["photo_count"] == 1
    assert pin["thumbnail_url"] == f"/api/v1/photos/{photo}/thumb"


@pytest.mark.asyncio
async def test_city_fountains_many_photos_uses_newest(session, api):
    """Multiple visible photos -> count reflects all of them, thumbnail_url is the NEWEST one."""
    city = await _seed_city(session, fountain_count=1)
    fid = await _add_city_fountain(session, city, ranking_score=0.9, rating_count=3)
    user = await _add_user(session)
    await _add_photo(session, fid, user)
    await session.commit()  # separate commits so created_at ordering is unambiguous
    await _add_photo(session, fid, user)
    await session.commit()
    newest = await _add_photo(session, fid, user)  # inserted (and committed) last -> newest
    await session.commit()

    body = (await api.get("/api/v1/places/us/san-diego/fountains")).json()
    pin = body["fountains"][0]
    assert pin["photo_count"] == 3
    assert pin["thumbnail_url"] == f"/api/v1/photos/{newest}/thumb"


@pytest.mark.asyncio
async def test_city_fountains_hidden_photos_excluded(session, api):
    """Hidden photos never contribute to photo_count or thumbnail_url."""
    city = await _seed_city(session, fountain_count=1)
    fid = await _add_city_fountain(session, city, ranking_score=0.9, rating_count=3)
    user = await _add_user(session)
    visible = await _add_photo(session, fid, user)
    await session.commit()
    await _add_photo(session, fid, user, hidden=True)  # newer, but hidden
    await session.commit()

    body = (await api.get("/api/v1/places/us/san-diego/fountains")).json()
    pin = body["fountains"][0]
    assert pin["photo_count"] == 1
    assert pin["thumbnail_url"] == f"/api/v1/photos/{visible}/thumb"


@pytest.mark.asyncio
async def test_city_fountains_all_hidden_photos_defaults(session, api):
    """A fountain whose only photos are all hidden looks exactly like a no-photo fountain."""
    city = await _seed_city(session, fountain_count=1)
    fid = await _add_city_fountain(session, city, ranking_score=0.9, rating_count=3)
    user = await _add_user(session)
    await _add_photo(session, fid, user, hidden=True)
    await session.commit()

    body = (await api.get("/api/v1/places/us/san-diego/fountains")).json()
    pin = body["fountains"][0]
    assert pin["photo_count"] == 0
    assert pin["thumbnail_url"] is None


@pytest.mark.asyncio
async def test_city_fountains_pagination_order_unchanged_with_photos(session, api):
    """Adding photos to some fountains does not change rank order or pagination — the
    subqueries are correlated scalars (one row per Fountain), never fanning out the page."""
    city = await _seed_city(session, fountain_count=3)
    a = await _add_city_fountain(session, city, ranking_score=0.9, rating_count=9)
    b = await _add_city_fountain(session, city, ranking_score=0.8, rating_count=8)
    c = await _add_city_fountain(session, city, ranking_score=0.7, rating_count=7)
    user = await _add_user(session)
    # Give the middle-ranked fountain several photos; order must still be a, b, c.
    await _add_photo(session, b, user)
    await _add_photo(session, b, user)
    await session.commit()

    page1 = (await api.get("/api/v1/places/us/san-diego/fountains", params={"limit": 2})).json()
    assert [f["id"] for f in page1["fountains"]] == [str(a), str(b)]
    page2 = (
        await api.get("/api/v1/places/us/san-diego/fountains", params={"limit": 2, "offset": 2})
    ).json()
    assert [f["id"] for f in page2["fountains"]] == [str(c)]
    assert page1["fountains"][1]["photo_count"] == 2
    assert page1["fountains"][0]["photo_count"] == 0


@pytest.mark.asyncio
async def test_bbox_endpoint_unchanged_no_photo_fields(session, api):
    """The map/bbox FountainPin response must NOT gain photo_count/thumbnail_url — that would
    mean the wrong router (fountains.py, not places.py) got touched."""
    city = await _seed_city(session, fountain_count=1)
    fid = await _add_city_fountain(session, city, ranking_score=0.9, rating_count=3)
    user = await _add_user(session)
    await _add_photo(session, fid, user)
    await session.commit()

    resp = await api.get(
        "/api/v1/fountains/bbox",
        params={"min_lat": 0, "min_lng": 0, "max_lat": 3, "max_lng": 3},
    )
    assert resp.status_code == 200
    body = resp.json()
    assert len(body) == 1
    assert "photo_count" not in body[0]
    assert "thumbnail_url" not in body[0]
