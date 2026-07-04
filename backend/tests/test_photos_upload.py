"""Task B12 — photo UPLOAD endpoint (``POST /fountains/{fountain_id}/photos``).

The upload endpoint composes the pieces built earlier (multipart streaming read, the
per-user upload reservation gate, the Pillow pipeline, Spaces storage, and the
first-photo contribution point) into the reserve-before-work sequence of design §8.1.

These tests exercise the ENDPOINT's orchestration and error mapping — the streaming
reader, Pillow pipeline, and reservation gate each have their own unit suites
(``test_multipart_read``/``test_images``/``test_rate_limit``). ``get_storage`` and
``process_image`` are mocked so no real S3/Pillow work runs; the real streaming
multipart read IS exercised (tiny bodies), except in the ``TooLarge`` case where the
reader is stubbed to raise rather than shipping an 11 MB payload through the test.
"""

from __future__ import annotations

import asyncio
import uuid

import pytest
from httpx import ASGITransport, AsyncClient
from sqlalchemy import text

import app.routers.photos as photos_module
from app.images import ProcessedImage, UnsupportedImage
from app.main import app
from app.multipart_read import TooLarge

# --- test doubles -----------------------------------------------------------------


class _FakeStorage:
    """Records put/delete calls; optionally fails a given call to drive cleanup paths."""

    def __init__(self, *, put_fail_on: int | None = None, delete_raises: bool = False):
        self.put_keys: list[str] = []
        self.deleted_keys: list[str] = []
        self._put_fail_on = put_fail_on  # 1-based index of the put_object call that raises
        self._delete_raises = delete_raises

    def put_object(self, key: str, data: bytes, content_type: str) -> None:
        self.put_keys.append(key)
        if self._put_fail_on is not None and len(self.put_keys) == self._put_fail_on:
            raise RuntimeError("simulated Spaces put failure")

    def delete_object(self, key: str) -> None:
        if self._delete_raises:
            raise RuntimeError("simulated Spaces delete failure")
        self.deleted_keys.append(key)


class _ProcessSpy:
    """Sync callable standing in for ``process_image`` (invoked via run_in_threadpool)."""

    def __init__(self, *, result: ProcessedImage | None = None, raises: Exception | None = None):
        self.calls = 0
        self._result = result or ProcessedImage(
            full=b"FULL-JPEG-BYTES", thumb=b"THUMB", width=1024, height=768
        )
        self._raises = raises

    def __call__(self, raw: bytes) -> ProcessedImage:
        self.calls += 1
        if self._raises is not None:
            raise self._raises
        return self._result


@pytest.fixture
def storage(monkeypatch) -> _FakeStorage:
    s = _FakeStorage()
    monkeypatch.setattr(photos_module, "get_storage", lambda settings: s)
    return s


@pytest.fixture
def storage_disabled(monkeypatch) -> None:
    monkeypatch.setattr(photos_module, "get_storage", lambda settings: None)


@pytest.fixture
def process(monkeypatch) -> _ProcessSpy:
    spy = _ProcessSpy()
    monkeypatch.setattr(photos_module, "process_image", spy)
    return spy


# --- seeding helpers --------------------------------------------------------------

_FILE = {"file": ("photo.jpg", b"raw-image-bytes", "image/jpeg")}


async def _add_fountain(session, *, hidden: bool = False) -> uuid.UUID:
    row = (
        await session.execute(
            text(
                "INSERT INTO fountains (id, location, is_hidden, created_source) "
                "VALUES (gen_random_uuid(), "
                "ST_SetSRID(ST_MakePoint(-122.42, 37.77), 4326)::geography, :hidden, "
                "'admin_import') RETURNING id"
            ),
            {"hidden": hidden},
        )
    ).one()
    return row.id


async def _add_user(session) -> uuid.UUID:
    uid = uuid.uuid4()
    await session.execute(
        text(
            "INSERT INTO users (id, logto_user_id, display_name, email) "
            "VALUES (:id, :lid, 'Seeded', :email)"
        ),
        {"id": uid, "lid": f"lid-{uid}", "email": f"{uid}@example.com"},
    )
    return uid


async def _add_photo(session, fountain_id, user_id, *, hidden: bool = False) -> uuid.UUID:
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
            "sk": f"fountains/{fountain_id}/{pid}.jpg",
            "tk": f"fountains/{fountain_id}/{pid}_thumb.jpg",
            "hidden": hidden,
        },
    )
    return pid


async def _seed_reserved_attempts(session, user_id, n: int) -> None:
    for _ in range(n):
        await session.execute(
            text(
                "INSERT INTO upload_attempts (id, user_id, status, created_at) "
                "VALUES (gen_random_uuid(), :uid, 'reserved', now())"
            ),
            {"uid": user_id},
        )


async def _reservation_statuses(session, user_id) -> list[str]:
    await session.rollback()  # fresh snapshot of the endpoint's committed rows
    rows = (
        await session.execute(
            text("SELECT status FROM upload_attempts WHERE user_id = :uid"),
            {"uid": user_id},
        )
    ).all()
    return [r.status for r in rows]


async def _count_photos(session, fountain_id, *, user_id=None) -> int:
    await session.rollback()
    sql = "SELECT count(*) AS c FROM fountain_photos WHERE fountain_id = :fid"
    params = {"fid": fountain_id}
    if user_id is not None:
        sql += " AND user_id = :uid"
        params["uid"] = user_id
    return (await session.execute(text(sql), params)).one().c


async def _contribution_events(session, fountain_id) -> list:
    await session.rollback()
    return (
        await session.execute(
            text(
                "SELECT user_id, event_type, target_type, target_id, "
                "location IS NOT NULL AS has_location, points "
                "FROM contribution_events WHERE fountain_id = :fid"
            ),
            {"fid": fountain_id},
        )
    ).all()


async def _storage_cleanup_rows(session) -> list:
    await session.rollback()
    return (
        await session.execute(text("SELECT object_key, reason, status FROM storage_cleanup"))
    ).all()


# --- tests ------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_happy_path_inserts_row_awards_first_photo_and_completes_reservation(
    session, client, test_user, storage, process
):
    uid = test_user.id  # capture before any helper rollback expires the ORM object
    fid = await _add_fountain(session)
    await session.commit()

    resp = await client.post(f"/api/v1/fountains/{fid}/photos", files=_FILE)

    assert resp.status_code == 201, resp.text
    body = resp.json()
    assert body["width"] == 1024
    assert body["height"] == 768
    assert body["url"] == f"/api/v1/photos/{body['id']}"
    assert body["thumbnail_url"] == f"/api/v1/photos/{body['id']}/thumb"
    assert body["uploaded_by"] == "Dev One"

    # Both objects uploaded under the fountains/{fid}/{pid}[_thumb].jpg key scheme.
    pid = body["id"]
    assert storage.put_keys == [
        f"fountains/{fid}/{pid}.jpg",
        f"fountains/{fid}/{pid}_thumb.jpg",
    ]
    assert storage.deleted_keys == []
    assert process.calls == 1

    # Row persisted.
    assert await _count_photos(session, fid) == 1

    # first-photo point awarded, tied to this uploader/photo, with a copied location.
    events = await _contribution_events(session, fid)
    assert len(events) == 1
    ev = events[0]
    assert ev.user_id == uid
    assert ev.event_type == "photo_first"
    assert ev.target_type == "photo"
    assert str(ev.target_id) == pid
    assert ev.has_location is True
    assert ev.points == 5

    # Reservation finalized completed.
    assert await _reservation_statuses(session, uid) == ["completed"]


@pytest.mark.asyncio
async def test_second_photo_does_not_reaward(session, client, test_user, storage, process):
    uid = test_user.id  # capture before any helper rollback expires the ORM object
    fid = await _add_fountain(session)
    await session.commit()

    r1 = await client.post(f"/api/v1/fountains/{fid}/photos", files=_FILE)
    r2 = await client.post(f"/api/v1/fountains/{fid}/photos", files=_FILE)

    assert r1.status_code == 201
    assert r2.status_code == 201
    assert await _count_photos(session, fid) == 2
    # Only the FIRST photo on the fountain awards the point (per-fountain dedup key).
    events = await _contribution_events(session, fid)
    assert len(events) == 1
    assert await _reservation_statuses(session, uid) == ["completed", "completed"]


@pytest.mark.asyncio
async def test_photos_disabled_returns_503_without_any_work(
    session, client, test_user, storage_disabled, process
):
    fid = await _add_fountain(session)
    await session.commit()

    resp = await client.post(f"/api/v1/fountains/{fid}/photos", files=_FILE)

    assert resp.status_code == 503
    assert process.calls == 0
    # No reservation was taken and no photo written.
    assert await _reservation_statuses(session, test_user.id) == []
    assert await _count_photos(session, fid) == 0


@pytest.mark.asyncio
async def test_unknown_or_hidden_fountain_404_no_reservation(
    session, client, test_user, storage, process
):
    hidden_fid = await _add_fountain(session, hidden=True)
    await session.commit()

    r_unknown = await client.post(f"/api/v1/fountains/{uuid.uuid4()}/photos", files=_FILE)
    r_hidden = await client.post(f"/api/v1/fountains/{hidden_fid}/photos", files=_FILE)

    assert r_unknown.status_code == 404
    assert r_hidden.status_code == 404
    assert process.calls == 0
    assert await _reservation_statuses(session, test_user.id) == []


@pytest.mark.asyncio
async def test_over_quota_reservation_429_before_any_work(
    session, client, test_user, storage, process
):
    fid = await _add_fountain(session)
    # 10 fresh reserved attempts == UPLOAD_ATTEMPTS_PER_MIN -> next reservation is 429.
    await _seed_reserved_attempts(session, test_user.id, 10)
    await session.commit()

    resp = await client.post(f"/api/v1/fountains/{fid}/photos", files=_FILE)

    assert resp.status_code == 429
    assert "retry-after" in {k.lower() for k in resp.headers}
    assert int(resp.headers["retry-after"]) > 0
    # Reservation precedes body read: no Pillow or S3 work.
    assert process.calls == 0
    assert storage.put_keys == []


@pytest.mark.asyncio
async def test_too_large_413_finalizes_reservation_failed(
    session, client, test_user, storage, process, monkeypatch
):
    fid = await _add_fountain(session)
    await session.commit()

    async def _raise_too_large(request, max_bytes):
        raise TooLarge("too big")

    monkeypatch.setattr(photos_module, "read_capped_multipart_file", _raise_too_large)

    resp = await client.post(f"/api/v1/fountains/{fid}/photos", files=_FILE)

    assert resp.status_code == 413
    assert process.calls == 0  # never reached the pipeline
    assert storage.put_keys == []
    assert await _reservation_statuses(session, test_user.id) == ["failed"]
    assert await _count_photos(session, fid) == 0


@pytest.mark.asyncio
async def test_non_image_415_finalizes_reservation_failed(
    session, client, test_user, storage, monkeypatch
):
    fid = await _add_fountain(session)
    await session.commit()

    spy = _ProcessSpy(raises=UnsupportedImage("not an image"))
    monkeypatch.setattr(photos_module, "process_image", spy)

    resp = await client.post(f"/api/v1/fountains/{fid}/photos", files=_FILE)

    assert resp.status_code == 415
    assert spy.calls == 1
    assert storage.put_keys == []  # failed before upload
    assert storage.deleted_keys == []
    assert await _reservation_statuses(session, test_user.id) == ["failed"]


@pytest.mark.asyncio
async def test_per_fountain_cap_409_deletes_objects_and_fails_reservation(
    session, client, test_user, storage, process
):
    fid = await _add_fountain(session)
    other = await _add_user(session)
    for _ in range(20):  # 20 visible photos by another user -> per-fountain cap hit
        await _add_photo(session, fid, other)
    await session.commit()

    resp = await client.post(f"/api/v1/fountains/{fid}/photos", files=_FILE)

    assert resp.status_code == 409
    assert resp.json()["detail"] == "photo_limit_fountain"
    # Objects were uploaded before the post-upload cap re-check, so both are deleted.
    assert len(storage.put_keys) == 2
    assert sorted(storage.deleted_keys) == sorted(storage.put_keys)
    assert await _reservation_statuses(session, test_user.id) == ["failed"]
    assert await _count_photos(session, fid, user_id=test_user.id) == 0


@pytest.mark.asyncio
async def test_per_user_cap_409_deletes_objects_and_fails_reservation(
    session, client, test_user, storage, process
):
    fid = await _add_fountain(session)
    for _ in range(5):  # 5 visible photos by THIS user -> per-user-per-fountain cap hit
        await _add_photo(session, fid, test_user.id)
    await session.commit()

    resp = await client.post(f"/api/v1/fountains/{fid}/photos", files=_FILE)

    assert resp.status_code == 409
    assert resp.json()["detail"] == "photo_limit_user"
    assert len(storage.put_keys) == 2
    assert sorted(storage.deleted_keys) == sorted(storage.put_keys)
    assert await _reservation_statuses(session, test_user.id) == ["failed"]


@pytest.mark.asyncio
async def test_cap_conflict_delete_failure_writes_storage_cleanup(
    session, client, test_user, monkeypatch, process
):
    fid = await _add_fountain(session)
    other = await _add_user(session)
    for _ in range(20):
        await _add_photo(session, fid, other)
    await session.commit()

    failing = _FakeStorage(delete_raises=True)
    monkeypatch.setattr(photos_module, "get_storage", lambda settings: failing)

    resp = await client.post(f"/api/v1/fountains/{fid}/photos", files=_FILE)

    assert resp.status_code == 409
    assert len(failing.put_keys) == 2
    # Delete failed for both -> a pending upload_orphan cleanup row per object.
    rows = await _storage_cleanup_rows(session)
    assert sorted(r.object_key for r in rows) == sorted(failing.put_keys)
    assert all(r.reason == "upload_orphan" and r.status == "pending" for r in rows)
    assert await _reservation_statuses(session, test_user.id) == ["failed"]


@pytest.mark.asyncio
async def test_upload_failure_finalizes_failed_and_cleans_partial_upload(
    session, client, test_user, monkeypatch, process
):
    fid = await _add_fountain(session)
    await session.commit()

    # The SECOND put_object (thumb) fails after the first (full) succeeded.
    partial = _FakeStorage(put_fail_on=2)
    monkeypatch.setattr(photos_module, "get_storage", lambda settings: partial)

    resp = await client.post(f"/api/v1/fountains/{fid}/photos", files=_FILE)

    assert resp.status_code >= 500
    assert len(partial.put_keys) == 2  # both puts attempted (2nd raised)
    # The one object that DID land is deleted.
    assert partial.deleted_keys == [partial.put_keys[0]]
    assert await _reservation_statuses(session, test_user.id) == ["failed"]
    assert await _count_photos(session, fid) == 0


@pytest.mark.asyncio
async def test_concurrent_uploads_cannot_exceed_user_cap(
    session, test_user, storage, process, monkeypatch
):
    """Fire more concurrent uploads than the per-user-per-fountain cap (5); the fountain
    FOR UPDATE lock in the insert txn must serialize the count-then-insert so committed
    rows never exceed the cap."""
    fid = await _add_fountain(session)
    await session.commit()

    async def _override_user():
        return test_user

    from app.auth import get_current_user

    app.dependency_overrides[get_current_user] = _override_user
    transport = ASGITransport(app=app)
    try:
        async with AsyncClient(transport=transport, base_url="http://test") as ac:
            results = await asyncio.gather(
                *(ac.post(f"/api/v1/fountains/{fid}/photos", files=_FILE) for _ in range(7))
            )
    finally:
        app.dependency_overrides.pop(get_current_user, None)

    statuses = sorted(r.status_code for r in results)
    assert statuses.count(201) == 5
    assert statuses.count(409) == 2
    assert await _count_photos(session, fid, user_id=test_user.id) == 5
