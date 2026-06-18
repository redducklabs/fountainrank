import pytest
from httpx import ASGITransport, AsyncClient

from app.auth import get_or_create_user
from app.config import Settings, get_settings
from app.main import app


async def test_get_or_create_user_is_idempotent(session):
    first = await get_or_create_user(
        session, logto_user_id="logto-abc", email="a@example.com", display_name="A"
    )
    await session.commit()
    again = await get_or_create_user(
        session, logto_user_id="logto-abc", email="ignored@example.com", display_name="ignored"
    )
    assert again.id == first.id  # reused, not duplicated


@pytest.fixture
def settings_override():
    def _apply(**kwargs):
        app.dependency_overrides[get_settings] = lambda: Settings(**kwargs)

    yield _apply
    app.dependency_overrides.pop(get_settings, None)


@pytest.mark.skip(reason="enabled in Task 5")
async def test_write_rejected_when_dev_auth_disabled(settings_override):
    settings_override(dev_auth_enabled=False)
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        resp = await ac.post(
            "/api/v1/fountains",
            json={"location": {"latitude": 1.0, "longitude": 2.0}, "is_working": True},
            headers={"X-Dev-User": "logto-abc"},
        )
    assert resp.status_code == 401


@pytest.mark.skip(reason="enabled in Task 5")
async def test_write_rejected_when_header_missing(settings_override):
    settings_override(dev_auth_enabled=True)
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        resp = await ac.post(
            "/api/v1/fountains",
            json={"location": {"latitude": 1.0, "longitude": 2.0}, "is_working": True},
        )
    assert resp.status_code == 401
