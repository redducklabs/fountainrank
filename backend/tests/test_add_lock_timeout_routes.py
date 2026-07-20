"""Route-level 503 busy on a bounded interactive-write lock timeout (spec 2026-07-17 §1).

The three interactive write endpoints — POST /fountains and admin patch/delete — run their whole
write transaction under a bounded `lock_timeout`, so an add never waits unbounded behind a boundary
load / membership refresh. A wait past the bound → 503 `{"detail": "busy"}` + `Retry-After: 30`.
Two-session harness pattern from `test_osm_merge.py`: a gate transaction holds the contended lock so
the request deterministically blocks, then times out.
"""

from __future__ import annotations

import pytest
from httpx import ASGITransport, AsyncClient
from sqlalchemy import func, select, text
from sqlalchemy.ext.asyncio import async_sessionmaker

from app.config import Settings, get_settings
from app.locks import ADD_FOUNTAIN_LOCK_KEY
from app.main import app
from app.models import Fountain, WriteAttempt

# A short bound so the timeout fires fast in tests (the gate holds the lock across the whole
# request, so any positive bound expires). gt=0, le=60_000 per the setting's validation.
_FAST_TIMEOUT_MS = 750

_ADMIN_HEADERS = {"X-Dev-User": "admin-sub"}


@pytest.fixture
def _fast_timeout_settings():
    """Override settings with a short add_lock_timeout_ms (and dev-auth for the admin routes)."""
    app.dependency_overrides[get_settings] = lambda: Settings(
        dev_auth_enabled=True,
        admin_subjects=["admin-sub"],
        add_lock_timeout_ms=_FAST_TIMEOUT_MS,
    )
    yield
    app.dependency_overrides.pop(get_settings, None)


@pytest.fixture
async def admin_client(_fast_timeout_settings):
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        yield ac


def _sq(x0: float, y0: float, x1: float, y1: float) -> str:
    return f"POLYGON(({x0} {y0}, {x1} {y0}, {x1} {y1}, {x0} {y1}, {x0} {y0}))"


async def _add_boundary(session, *, overture_id, subtype, country_code, name, slug, wkt):
    row = (
        await session.execute(
            text(
                """
                INSERT INTO place_boundaries
                    (id, overture_id, subtype, class, name, country_code, slug,
                     is_canonical, fountain_count, boundary, created_at, updated_at)
                VALUES (gen_random_uuid(), :oid, :subtype, 'land', :name, :cc, :slug,
                        false, 0, ST_Multi(ST_GeomFromText(:wkt, 4326))::geography, now(), now())
                RETURNING id
                """
            ),
            {
                "oid": overture_id,
                "subtype": subtype,
                "name": name,
                "cc": country_code,
                "slug": slug,
                "wkt": wkt,
            },
        )
    ).one()
    return row.id


# --- 2a: POST /fountains against a held advisory lock -> 503, then succeeds once freed ---------


@pytest.mark.asyncio
async def test_add_fountain_busy_503_then_succeeds_when_freed(
    client, engine, _fast_timeout_settings
):
    maker = async_sessionmaker(engine, expire_on_commit=False)
    gate = maker()
    # Hold the advisory add lock so the POST blocks acquiring it inside its bounded context.
    await gate.execute(select(func.pg_advisory_xact_lock(ADD_FOUNTAIN_LOCK_KEY)))
    try:
        resp = await client.post(
            "/api/v1/fountains",
            json={"location": {"latitude": 1.5, "longitude": 1.5}, "is_working": True},
        )
        assert resp.status_code == 503
        assert resp.json() == {"detail": "busy"}
        assert resp.headers.get("retry-after") == "30"
    finally:
        await gate.rollback()  # release the advisory lock
        await gate.close()

    # Once the lock is free the same add succeeds.
    ok = await client.post(
        "/api/v1/fountains",
        json={"location": {"latitude": 1.5, "longitude": 1.5}, "is_working": True},
    )
    assert ok.status_code == 201


# --- 2b: admin patch / delete against a held advisory lock -> 503 -----------------------------


@pytest.mark.asyncio
async def test_admin_patch_busy_503(session, admin_client, engine):
    fid = (
        await session.execute(
            text(
                "INSERT INTO fountains (id, location, is_hidden, created_source) "
                "VALUES (gen_random_uuid(), ST_SetSRID(ST_MakePoint(1.5,1.5),4326)::geography, "
                "false, 'admin_import') RETURNING id"
            )
        )
    ).scalar_one()
    await session.commit()

    maker = async_sessionmaker(engine, expire_on_commit=False)
    gate = maker()
    await gate.execute(select(func.pg_advisory_xact_lock(ADD_FOUNTAIN_LOCK_KEY)))
    try:
        resp = await admin_client.patch(
            f"/api/v1/admin/fountains/{fid}", headers=_ADMIN_HEADERS, json={"is_hidden": True}
        )
        assert resp.status_code == 503
        assert resp.json() == {"detail": "busy"}
        assert resp.headers.get("retry-after") == "30"
    finally:
        await gate.rollback()
        await gate.close()


@pytest.mark.asyncio
async def test_admin_delete_busy_503(session, admin_client, engine):
    fid = (
        await session.execute(
            text(
                "INSERT INTO fountains (id, location, is_hidden, created_source) "
                "VALUES (gen_random_uuid(), ST_SetSRID(ST_MakePoint(1.5,1.5),4326)::geography, "
                "false, 'admin_import') RETURNING id"
            )
        )
    ).scalar_one()
    await session.commit()

    maker = async_sessionmaker(engine, expire_on_commit=False)
    gate = maker()
    await gate.execute(select(func.pg_advisory_xact_lock(ADD_FOUNTAIN_LOCK_KEY)))
    try:
        resp = await admin_client.delete(f"/api/v1/admin/fountains/{fid}", headers=_ADMIN_HEADERS)
        assert resp.status_code == 503
        assert resp.json() == {"detail": "busy"}
        assert resp.headers.get("retry-after") == "30"
    finally:
        await gate.rollback()
        await gate.close()


@pytest.mark.asyncio
async def test_admin_rating_delete_busy_503(session, admin_client, engine):
    uid = (
        await session.execute(
            text(
                "INSERT INTO users (id, logto_user_id, email, display_name) "
                "VALUES (gen_random_uuid(), 'rating-lock-user', 'rating-lock@example.com', "
                "'Rating Lock') RETURNING id"
            )
        )
    ).scalar_one()
    fid = (
        await session.execute(
            text(
                "INSERT INTO fountains (id, location, is_hidden, created_source) "
                "VALUES (gen_random_uuid(), ST_SetSRID(ST_MakePoint(1.5,1.5),4326)::geography, "
                "false, 'admin_import') RETURNING id"
            )
        )
    ).scalar_one()
    rid = (
        await session.execute(
            text(
                "INSERT INTO ratings (id, fountain_id, user_id, rating_type_id, stars) "
                "VALUES (gen_random_uuid(), :fid, :uid, 1, 3) RETURNING id"
            ),
            {"fid": fid, "uid": uid},
        )
    ).scalar_one()
    await session.commit()

    maker = async_sessionmaker(engine, expire_on_commit=False)
    gate = maker()
    await gate.execute(select(Fountain).where(Fountain.id == fid).with_for_update())
    try:
        resp = await admin_client.request(
            "DELETE",
            f"/api/v1/admin/ratings/{rid}",
            headers=_ADMIN_HEADERS,
            json={"reason": "lock timeout test"},
        )
        assert resp.status_code == 503
        assert resp.json() == {"detail": "busy"}
        assert resp.headers.get("retry-after") == "30"
    finally:
        await gate.rollback()
        await gate.close()


# --- placement: the bound covers the DOMAIN transaction, after the reservation commit ---------


@pytest.mark.asyncio
async def test_add_fountain_bounded_on_held_row_lock_after_advisory(
    client, session, engine, _fast_timeout_settings
):
    """A held ROW lock on a place row the membership recompute must UPDATE (hit AFTER the advisory
    lock is acquired) still 503s at the bound. This can only hold if (a) the reservation commit
    runs BEFORE the context is entered (a misorder would clear the bound) and (b) there is NO
    lock_timeout reset after the advisory acquisition — so the WHOLE domain txn stays bounded."""
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
    from app.membership import refresh_all_memberships

    await refresh_all_memberships(session)  # builds cells; assigns nothing yet
    await session.commit()

    maker = async_sessionmaker(engine, expire_on_commit=False)
    gate = maker()
    # Hold a ROW lock on the city place — the add's post-advisory recount UPDATE will block on it.
    await gate.execute(
        text("SELECT id FROM place_boundaries WHERE id = :id FOR UPDATE"), {"id": city}
    )
    try:
        resp = await client.post(
            "/api/v1/fountains",
            json={"location": {"latitude": 1.5, "longitude": 1.5}, "is_working": True},
        )
        assert resp.status_code == 503
        assert resp.json() == {"detail": "busy"}
        assert resp.headers.get("retry-after") == "30"
    finally:
        await gate.rollback()
        await gate.close()

    # No fountain persisted from the timed-out add.
    n = (await session.execute(select(func.count()).select_from(Fountain))).scalar_one()
    assert n == 0
    assert us is not None  # (boundary fixture sanity)


# --- the rate-limit reservation survives a lock-timeout rollback ------------------------------


@pytest.mark.asyncio
async def test_reservation_survives_lock_timeout_rollback(
    client, session, engine, test_user, _fast_timeout_settings
):
    """The reservation commits in its own transaction BEFORE the bounded domain work, so a
    lock-timeout rollback does NOT refund the attempt — a retry storm stays budget-bounded."""
    maker = async_sessionmaker(engine, expire_on_commit=False)
    gate = maker()
    await gate.execute(select(func.pg_advisory_xact_lock(ADD_FOUNTAIN_LOCK_KEY)))
    try:
        resp = await client.post(
            "/api/v1/fountains",
            json={"location": {"latitude": 1.5, "longitude": 1.5}, "is_working": True},
        )
        assert resp.status_code == 503
    finally:
        await gate.rollback()
        await gate.close()

    attempts = (
        await session.execute(
            select(func.count())
            .select_from(WriteAttempt)
            .where(WriteAttempt.user_id == test_user.id)
        )
    ).scalar_one()
    assert attempts == 1  # the reservation persisted despite the domain rollback


# --- 3: OpenAPI declares 503 + Retry-After on all three operations ----------------------------


def test_openapi_interactive_writes_document_busy_503():
    schema = app.openapi()
    paths = schema["paths"]
    # POST /fountains
    resp = paths["/api/v1/fountains"]["post"]["responses"]["503"]
    assert resp["headers"]["Retry-After"]["schema"]["type"] == "integer"
    # admin patch + delete
    admin = paths["/api/v1/admin/fountains/{fountain_id}"]
    for method in ("patch", "delete"):
        resp = admin[method]["responses"]["503"]
        assert resp["headers"]["Retry-After"]["schema"]["type"] == "integer", method
