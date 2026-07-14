import uuid

import pytest
from fastapi import HTTPException
from httpx import ASGITransport, AsyncClient

from app.auth import ensure_named_user, get_current_user
from app.main import app
from app.models import User

LOC = {"latitude": 37.0, "longitude": -122.0}


def test_ensure_named_user_preserves_typed_conflict():
    anonymous = User(
        id=uuid.uuid4(),
        logto_user_id="pure-anonymous",
        email="pure-anonymous@example.com",
        display_name="pure-anonymous",
    )
    with pytest.raises(HTTPException) as error:
        ensure_named_user(anonymous)
    assert error.value.status_code == 409
    assert error.value.detail == "display_name_required"


def test_ensure_named_user_returns_named_user():
    named = User(
        id=uuid.uuid4(),
        logto_user_id="pure-named",
        email="pure-named@example.com",
        display_name="Pure Named",
    )
    assert ensure_named_user(named) is named


async def test_anonymous_user_blocked_from_contributing(clean_db, session):
    # A user whose display_name fell back to the subject and who has no nickname is "Anonymous".
    anon = User(
        logto_user_id="anon-sub-1",
        email="anon@example.com",
        display_name="anon-sub-1",
        nickname=None,
    )
    session.add(anon)
    await session.commit()
    await session.refresh(anon)

    async def override() -> User:
        return anon

    app.dependency_overrides[get_current_user] = override
    try:
        transport = ASGITransport(app=app)
        async with AsyncClient(transport=transport, base_url="http://test") as ac:
            # add_fountain is itself gated, so assert the 409 + typed detail directly on it.
            resp = await ac.post("/api/v1/fountains", json={"location": LOC, "is_working": True})
        assert resp.status_code == 409
        assert resp.json()["detail"] == "display_name_required"
    finally:
        app.dependency_overrides.pop(get_current_user, None)


async def test_named_user_can_contribute(client, test_user):
    # The default `client` fixture user ("Dev One") is named -> add succeeds.
    resp = await client.post("/api/v1/fountains", json={"location": LOC, "is_working": True})
    assert resp.status_code == 201, resp.text
    assert resp.json()["id"]


async def test_user_unblocked_after_setting_nickname(clean_db, session):
    # An Anonymous user who sets a nickname can then contribute (gate keys off the resolver).
    u = User(logto_user_id="anon-sub-2", email="a2@example.com", display_name="anon-sub-2")
    session.add(u)
    await session.commit()
    await session.refresh(u)

    async def override() -> User:
        return u

    app.dependency_overrides[get_current_user] = override
    try:
        transport = ASGITransport(app=app)
        async with AsyncClient(transport=transport, base_url="http://test") as ac:
            blocked = await ac.post("/api/v1/fountains", json={"location": LOC, "is_working": True})
            assert blocked.status_code == 409
            u.nickname = "Named Now"
            await session.commit()
            ok = await ac.post(
                "/api/v1/fountains",
                json={"location": {"latitude": 38.0, "longitude": -121.0}, "is_working": True},
            )
            assert ok.status_code == 201, ok.text
    finally:
        app.dependency_overrides.pop(get_current_user, None)
