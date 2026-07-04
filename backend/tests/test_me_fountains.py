import uuid
from datetime import UTC, datetime, timedelta

import pytest
from httpx import ASGITransport, AsyncClient
from sqlalchemy import update

from app.auth import get_current_user
from app.config import Settings, get_settings
from app.main import app
from app.models import ContributionEvent, Fountain, User

BASE = datetime(2026, 1, 1, tzinfo=UTC)


@pytest.fixture
def settings_override():
    def _apply(**kwargs):
        app.dependency_overrides[get_settings] = lambda: Settings(**kwargs)

    yield _apply
    app.dependency_overrides.pop(get_settings, None)


async def _add_fountain(client, lat, lng) -> uuid.UUID:
    # PgUUID(as_uuid=True) columns bind UUID objects, not strings — parse the API's string id.
    r = await client.post(
        "/api/v1/fountains", json={"location": {"latitude": lat, "longitude": lng}}
    )
    assert r.status_code in (200, 201)
    return uuid.UUID(r.json()["id"])


def _event(user_id, fountain_id, *, etype, status, when, key):
    return ContributionEvent(
        user_id=user_id,
        fountain_id=fountain_id,
        event_type=etype,
        points=1,
        status=status,
        dedup_key=key,
        created_at=when,
    )


@pytest.mark.asyncio
async def test_me_fountains_dedupes_and_orders_recent_first(client, test_user, session):
    f_old = await _add_fountain(client, 1.0, 2.0)  # POST already wrote an awarded add event
    f_new = await _add_fountain(client, 3.0, 4.0)
    # Force deterministic recency: old fountain's newest event is BEFORE the new one's.
    await session.execute(
        update(ContributionEvent)
        .where(ContributionEvent.fountain_id == f_old)
        .values(created_at=BASE)
    )
    await session.execute(
        update(ContributionEvent)
        .where(ContributionEvent.fountain_id == f_new)
        .values(created_at=BASE + timedelta(hours=2))
    )
    # A second awarded event on f_old must NOT duplicate its row.
    session.add(
        _event(
            test_user.id,
            f_old,
            etype="rate",
            status="awarded",
            when=BASE + timedelta(minutes=5),
            key="dup-f_old-rate",
        )
    )
    await session.commit()
    body = (await client.get("/api/v1/me/fountains")).json()
    assert [f["id"] for f in body["fountains"]] == [str(f_new), str(f_old)]  # recent-first, deduped


@pytest.mark.asyncio
async def test_me_fountains_excludes_reversed_and_hidden(client, test_user, session):
    f_rev = await _add_fountain(client, 1.0, 2.0)
    f_hidden = await _add_fountain(client, 3.0, 4.0)
    # Reverse every event on f_rev; hide f_hidden (its add event stays awarded).
    await session.execute(
        update(ContributionEvent)
        .where(ContributionEvent.fountain_id == f_rev)
        .values(status="reversed")
    )
    await session.execute(update(Fountain).where(Fountain.id == f_hidden).values(is_hidden=True))
    await session.commit()
    assert (await client.get("/api/v1/me/fountains")).json()["fountains"] == []


@pytest.mark.asyncio
async def test_me_fountains_isolated_per_user(client, test_user, session):
    await _add_fountain(client, 1.0, 2.0)  # belongs to test_user
    u2 = User(logto_user_id="mf-u2", email="mf-u2@example.com", display_name="U2")
    session.add(u2)
    await session.commit()
    app.dependency_overrides[get_current_user] = lambda: u2
    try:
        body = (await client.get("/api/v1/me/fountains")).json()
    finally:
        app.dependency_overrides[get_current_user] = lambda: test_user
    assert body["fountains"] == []  # u2 must not see test_user's fountain


@pytest.mark.asyncio
async def test_me_fountains_requires_auth(settings_override):
    settings_override(dev_auth_enabled=False)
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        assert (await ac.get("/api/v1/me/fountains")).status_code == 401


@pytest.mark.asyncio
async def test_me_fountains_empty(client):
    r = await client.get("/api/v1/me/fountains")
    assert r.status_code == 200 and r.json() == {"fountains": []}
