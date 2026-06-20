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
