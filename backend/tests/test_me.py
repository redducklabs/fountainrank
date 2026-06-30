from httpx import ASGITransport, AsyncClient

from app.main import app


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
    # display_name fell back to the subject and no nickname -> needs_name; the subject must NOT leak.
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
    # The provisioning fallback embeds the subject in a synthetic email — it must NOT cross the wire.
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
