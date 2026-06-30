import pytest
from httpx import ASGITransport, AsyncClient
from sqlalchemy import select

from app.config import Settings, get_settings
from app.main import app
from app.models import User


@pytest.fixture
def settings_override():
    def _apply(**kwargs):
        app.dependency_overrides[get_settings] = lambda: Settings(**kwargs)

    yield _apply
    app.dependency_overrides.pop(get_settings, None)


async def test_me_returns_profile(client, test_user):
    resp = await client.get("/api/v1/me")
    assert resp.status_code == 200
    body = resp.json()
    assert body["id"] == str(test_user.id)
    assert body["display_name"] == "Dev One"
    assert body["email"] == "dev1@example.com"
    assert body["avatar_url"] is None
    assert body["is_admin"] is False
    assert "created_at" in body
    # The Logto subject is an internal identity key, never user-facing payload.
    assert "logto_user_id" not in body


async def test_me_requires_auth():
    # No dependency override and no credential -> the real resolver returns 401.
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        resp = await ac.get("/api/v1/me")
    assert resp.status_code == 401


async def test_me_includes_needs_name_false_for_named(client, test_user):
    resp = await client.get("/api/v1/me")
    assert resp.status_code == 200
    assert resp.json()["needs_name"] is False  # "Dev One" != subject


async def test_me_needs_name_true_when_anonymous(client, test_user, session):
    # display_name fell back to the subject and no nickname -> needs_name; subject must not leak.
    test_user.display_name = test_user.logto_user_id
    test_user.nickname = None
    await session.commit()
    resp = await client.get("/api/v1/me")
    body = resp.json()
    assert body["needs_name"] is True
    assert body["display_name"] == ""  # never the raw Logto subject
    assert test_user.logto_user_id not in str(body)  # subject nowhere in /me


async def test_me_display_name_prefers_nickname(client, test_user, session):
    test_user.nickname = "Nick"
    await session.commit()
    resp = await client.get("/api/v1/me")
    body = resp.json()
    assert body["display_name"] == "Nick"
    assert body["needs_name"] is False


async def test_me_blanks_synthetic_subject_email(client, test_user, session):
    # The synthetic fallback email embeds the subject — it must not cross the wire.
    test_user.email = f"{test_user.logto_user_id}@users.noreply.fountainrank.com"
    await session.commit()
    resp = await client.get("/api/v1/me")
    body = resp.json()
    assert body["email"] == ""
    assert test_user.logto_user_id not in str(body)  # subject nowhere in /me


async def test_me_real_email_passes_through(client, test_user, session):
    test_user.email = "real@example.com"
    await session.commit()
    assert (await client.get("/api/v1/me")).json()["email"] == "real@example.com"


async def test_patch_me_sets_display_name(client, test_user):
    # Response behaviour: the trimmed value becomes the resolved display_name and clears needs_name.
    resp = await client.patch("/api/v1/me", json={"display_name": "  Aron  "})
    assert resp.status_code == 200
    body = resp.json()
    assert body["display_name"] == "Aron"  # trimmed, resolved from nickname
    assert body["needs_name"] is False


async def test_patch_me_persists_nickname_and_preserves_idp_name(settings_override, session):
    # Persistence through the real request session (dev seam provisions the user in the endpoint's
    # own session). The nickname is stored; the IdP-synced display_name is left intact as fallback.
    settings_override(dev_auth_enabled=True)
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        resp = await ac.patch(
            "/api/v1/me",
            json={"display_name": "Aron"},
            headers={"X-Dev-User": "logto-patch-1", "X-Dev-Name": "IdP Name"},
        )
        assert resp.status_code == 200
        assert resp.json()["display_name"] == "Aron"
    row = (
        await session.execute(select(User).where(User.logto_user_id == "logto-patch-1"))
    ).scalar_one()
    assert row.nickname == "Aron"
    assert row.display_name == "IdP Name"  # IdP name preserved underneath


async def test_patch_me_rejects_blank(client):
    assert (await client.patch("/api/v1/me", json={"display_name": "   "})).status_code == 422


async def test_patch_me_rejects_too_long(client):
    assert (await client.patch("/api/v1/me", json={"display_name": "x" * 81})).status_code == 422


async def test_patch_me_rejects_value_equal_to_subject(client, test_user):
    resp = await client.patch("/api/v1/me", json={"display_name": test_user.logto_user_id})
    assert resp.status_code == 422


async def test_patch_me_requires_auth():
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        resp = await ac.patch("/api/v1/me", json={"display_name": "Aron"})
    assert resp.status_code == 401
