"""Task B11 — photo list + gated presigned-redirect reads.

``GET /fountains/{fountain_id}/photos`` is parent-scoped like ``list_notes``: a missing or
hidden fountain 404s (never an empty list), and visible photos come back newest-first.
``GET /photos/{id}`` and ``/photos/{id}/thumb`` are gated reads: unknown or hidden ->
404 (never reveal existence); a visible existing row redirects (302) to the mocked
presigned URL when storage is configured, or 503s (storage misconfigured) without ever
touching the network -- ``get_storage`` is monkeypatched throughout, no real S3 calls.
"""

import uuid

import pytest
from httpx import ASGITransport, AsyncClient

import app.routers.photos as photos_module
from app.main import app


class _FakeStorage:
    def __init__(self, url: str = "https://signed.example.com/object?sig=abc"):
        self.url = url
        self.requested_keys: list[str] = []

    def presign_get(self, key: str) -> str:
        self.requested_keys.append(key)
        return self.url


@pytest.fixture
def api() -> AsyncClient:
    transport = ASGITransport(app=app)
    return AsyncClient(transport=transport, base_url="http://test")


@pytest.fixture
def fake_storage(monkeypatch) -> _FakeStorage:
    storage = _FakeStorage()
    monkeypatch.setattr(photos_module, "get_storage", lambda settings: storage)
    return storage


@pytest.fixture
def storage_disabled(monkeypatch) -> None:
    monkeypatch.setattr(photos_module, "get_storage", lambda settings: None)


async def _add_fountain(session, *, hidden: bool = False) -> uuid.UUID:
    from sqlalchemy import text

    row = (
        await session.execute(
            text(
                "INSERT INTO fountains (id, location, is_hidden, created_source) "
                "VALUES (gen_random_uuid(), "
                "ST_SetSRID(ST_MakePoint(1.5, 1.5), 4326)::geography, :hidden, 'admin_import') "
                "RETURNING id"
            ),
            {"hidden": hidden},
        )
    ).one()
    return row.id


async def _add_user(session, *, suffix: str = "") -> uuid.UUID:
    from sqlalchemy import text

    uid = uuid.uuid4()
    await session.execute(
        text(
            "INSERT INTO users (id, logto_user_id, display_name, email) "
            "VALUES (:id, :lid, 'T', :email)"
        ),
        {"id": uid, "lid": f"lid-{uid}{suffix}", "email": f"{uid}{suffix}@example.com"},
    )
    return uid


async def _add_photo(session, fountain_id, user_id, *, hidden: bool = False) -> uuid.UUID:
    from sqlalchemy import text

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
async def test_list_returns_only_visible_newest_first(session, api, fake_storage):
    fid = await _add_fountain(session)
    user = await _add_user(session)
    visible1 = await _add_photo(session, fid, user)
    await session.commit()
    visible2 = await _add_photo(session, fid, user)  # inserted later -> newest
    await session.commit()
    await _add_photo(session, fid, user, hidden=True)
    await session.commit()

    async with api as client:
        resp = await client.get(f"/api/v1/fountains/{fid}/photos")
    assert resp.status_code == 200
    body = resp.json()
    assert [p["id"] for p in body] == [str(visible2), str(visible1)]
    assert body[0]["url"] == f"/api/v1/photos/{visible2}"
    assert body[0]["thumbnail_url"] == f"/api/v1/photos/{visible2}/thumb"


@pytest.mark.asyncio
async def test_list_404_on_unknown_or_hidden_fountain(session, api):
    hidden_fid = await _add_fountain(session, hidden=True)
    await session.commit()

    async with api as client:
        r1 = await client.get(f"/api/v1/fountains/{uuid.uuid4()}/photos")
        r2 = await client.get(f"/api/v1/fountains/{hidden_fid}/photos")
    assert r1.status_code == 404
    assert r2.status_code == 404


@pytest.mark.asyncio
async def test_get_visible_photo_redirects_to_presigned_url(session, api, fake_storage):
    fid = await _add_fountain(session)
    user = await _add_user(session)
    photo = await _add_photo(session, fid, user)
    await session.commit()

    async with api as client:
        resp = await client.get(f"/api/v1/photos/{photo}", follow_redirects=False)
        thumb_resp = await client.get(f"/api/v1/photos/{photo}/thumb", follow_redirects=False)
    assert resp.status_code == 302
    assert resp.headers["location"] == fake_storage.url
    assert resp.headers["cache-control"] == "private, max-age=60"
    assert thumb_resp.status_code == 302
    assert thumb_resp.headers["location"] == fake_storage.url
    assert fake_storage.requested_keys == [f"photos/{photo}.jpg", f"photos/{photo}-thumb.jpg"]


@pytest.mark.asyncio
async def test_get_hidden_or_unknown_photo_404s(session, api, fake_storage):
    fid = await _add_fountain(session)
    user = await _add_user(session)
    hidden = await _add_photo(session, fid, user, hidden=True)
    await session.commit()

    async with api as client:
        r1 = await client.get(f"/api/v1/photos/{hidden}")
        r2 = await client.get(f"/api/v1/photos/{hidden}/thumb")
        r3 = await client.get(f"/api/v1/photos/{uuid.uuid4()}")
        r4 = await client.get(f"/api/v1/photos/{uuid.uuid4()}/thumb")
    assert r1.status_code == 404
    assert r2.status_code == 404
    assert r3.status_code == 404
    assert r4.status_code == 404


@pytest.mark.asyncio
async def test_storage_disabled_visible_503_hidden_and_unknown_still_404(
    session, api, storage_disabled
):
    fid = await _add_fountain(session)
    user = await _add_user(session)
    visible = await _add_photo(session, fid, user)
    hidden = await _add_photo(session, fid, user, hidden=True)
    await session.commit()

    async with api as client:
        r_visible = await client.get(f"/api/v1/photos/{visible}")
        r_visible_thumb = await client.get(f"/api/v1/photos/{visible}/thumb")
        r_hidden = await client.get(f"/api/v1/photos/{hidden}")
        r_unknown = await client.get(f"/api/v1/photos/{uuid.uuid4()}")
    assert r_visible.status_code == 503
    assert r_visible_thumb.status_code == 503
    assert r_hidden.status_code == 404
    assert r_unknown.status_code == 404
