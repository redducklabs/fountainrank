import pytest
from httpx import ASGITransport, AsyncClient

from app.auth import get_current_user
from app.config import Settings, get_settings
from app.main import app
from app.models import User


@pytest.fixture
def settings_override():
    def _apply(**kwargs):
        app.dependency_overrides[get_settings] = lambda: Settings(**kwargs)

    yield _apply
    app.dependency_overrides.pop(get_settings, None)


@pytest.mark.asyncio
async def test_me_contributions_requires_auth(settings_override):
    settings_override(dev_auth_enabled=False)
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        r = await ac.get("/api/v1/me/contributions")
    assert r.status_code == 401


@pytest.mark.asyncio
async def test_me_contributions_empty(client):
    r = await client.get("/api/v1/me/contributions")
    assert r.status_code == 200
    body = r.json()
    assert body["stats"]["total_points"] == 0
    assert body["recent"] == []


@pytest.mark.asyncio
async def test_me_contributions_returns_own_data(client, test_user):
    await client.post("/api/v1/fountains", json={"location": {"latitude": 1.0, "longitude": 2.0}})
    body = (await client.get("/api/v1/me/contributions")).json()
    assert body["stats"]["total_points"] == 30  # add + first_fountain + first_in_area
    assert body["stats"]["fountains_added"] == 1
    assert any(e["event_type"] == "add_fountain" for e in body["recent"])


@pytest.mark.asyncio
async def test_me_contributions_isolated_per_user(client, test_user, session):
    await client.post("/api/v1/fountains", json={"location": {"latitude": 1.0, "longitude": 2.0}})
    u2 = User(logto_user_id="me-u2", email="me-u2@example.com", display_name="U2")
    session.add(u2)
    await session.commit()
    app.dependency_overrides[get_current_user] = lambda: u2
    try:
        body = (await client.get("/api/v1/me/contributions")).json()
    finally:
        app.dependency_overrides[get_current_user] = lambda: test_user
    assert body["stats"]["total_points"] == 0  # u2 sees only its own (empty) data
    assert body["recent"] == []
