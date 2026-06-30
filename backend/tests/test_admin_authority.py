import pytest
from httpx import ASGITransport, AsyncClient

from app.config import Settings, get_settings
from app.main import app


@pytest.fixture
def settings_override():
    def _apply(**kwargs):
        app.dependency_overrides[get_settings] = lambda: Settings(**kwargs)

    yield _apply
    app.dependency_overrides.pop(get_settings, None)


async def _get_me(headers):
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        return await ac.get("/api/v1/me", headers=headers)


async def test_subject_in_allowlist_is_admin(settings_override):
    settings_override(dev_auth_enabled=True, admin_subjects=["logto-admin"])
    resp = await _get_me({"X-Dev-User": "logto-admin"})
    assert resp.status_code == 200
    assert resp.json()["is_admin"] is True


async def test_subject_not_in_allowlist_is_not_admin(settings_override):
    settings_override(dev_auth_enabled=True, admin_subjects=["logto-admin"])
    resp = await _get_me({"X-Dev-User": "logto-regular"})
    assert resp.json()["is_admin"] is False


async def test_admin_demoted_when_removed_from_allowlist(settings_override):
    # Promote, then reconcile to a config without the subject -> demoted on next request.
    settings_override(dev_auth_enabled=True, admin_subjects=["logto-x"])
    assert (await _get_me({"X-Dev-User": "logto-x"})).json()["is_admin"] is True
    settings_override(dev_auth_enabled=True, admin_subjects=[])
    assert (await _get_me({"X-Dev-User": "logto-x"})).json()["is_admin"] is False


async def test_case_sensitive_subject_match(settings_override):
    settings_override(dev_auth_enabled=True, admin_subjects=["AbC"])
    assert (await _get_me({"X-Dev-User": "abc"})).json()["is_admin"] is False


async def test_write_endpoint_works_immediately_after_admin_transition(settings_override):
    # The reconciliation commit inside get_current_user must not break the write
    # endpoint's own transaction on the shared AsyncSession.
    settings_override(dev_auth_enabled=True, admin_subjects=["logto-writer"])
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        resp = await ac.post(
            "/api/v1/fountains",
            json={"location": {"latitude": 5.0, "longitude": 6.0}, "is_working": True},
            headers={"X-Dev-User": "logto-writer", "X-Dev-Name": "Writer"},
        )
    assert resp.status_code == 201
