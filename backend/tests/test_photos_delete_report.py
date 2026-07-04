"""Task B13 — photo router: own-photo DELETE + photo report POST.

Both routes are nested under `/fountains/{fountain_id}/photos/{photo_id}` (mirroring the
`submit_note`/`list_notes` scoping in `fountains.py`): a photo whose `fountain_id` doesn't
match the path 404s just like an unknown id. `get_storage` is mocked so no real S3 work
runs; `process_image` is exercised via the real upload endpoint (mocked) to seed a real
photo + its first-photo contribution point for the delete/reversal assertions.
"""

from __future__ import annotations

import uuid
from datetime import UTC, datetime, timedelta

import pytest
from sqlalchemy import select, text

import app.routers.photos as photos_module
from app.auth import get_current_user
from app.images import ProcessedImage
from app.main import app
from app.models import ContributionEvent, FountainPhoto, PhotoReport, User
from app.rate_limit import REPORTS_PER_MIN

_FILE = {"file": ("photo.jpg", b"raw-image-bytes", "image/jpeg")}


class _FakeStorage:
    def __init__(self, *, delete_raises: bool = False):
        self.put_keys: list[str] = []
        self.deleted_keys: list[str] = []
        self._delete_raises = delete_raises

    def put_object(self, key: str, data: bytes, content_type: str) -> None:
        self.put_keys.append(key)

    def delete_object(self, key: str) -> None:
        if self._delete_raises:
            raise RuntimeError("simulated Spaces delete failure")
        self.deleted_keys.append(key)


@pytest.fixture
def storage(monkeypatch) -> _FakeStorage:
    s = _FakeStorage()
    monkeypatch.setattr(photos_module, "get_storage", lambda settings: s)
    return s


@pytest.fixture
def failing_storage(monkeypatch) -> _FakeStorage:
    s = _FakeStorage(delete_raises=True)
    monkeypatch.setattr(photos_module, "get_storage", lambda settings: s)
    return s


@pytest.fixture
def process(monkeypatch) -> None:
    result = ProcessedImage(full=b"FULL-JPEG-BYTES", thumb=b"THUMB", width=1024, height=768)
    monkeypatch.setattr(photos_module, "process_image", lambda raw: result)


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


async def _add_user(session, n: int) -> User:
    u = User(
        logto_user_id=f"b13-u{n}",
        email=f"b13-u{n}@example.com",
        display_name=f"B13 User {n}",
    )
    session.add(u)
    await session.flush()
    return u


async def _upload_photo(client, fountain_id: uuid.UUID) -> str:
    resp = await client.post(f"/api/v1/fountains/{fountain_id}/photos", files=_FILE)
    assert resp.status_code == 201, resp.text
    return resp.json()["id"]


async def _hide_photo(session, photo_id) -> None:
    await session.execute(
        text("UPDATE fountain_photos SET is_hidden = true WHERE id = :id"), {"id": photo_id}
    )
    await session.commit()


async def _seed_reports(session, reporter: User, fountain_id, n: int) -> None:
    """Seed n pending reports by `reporter`, each on its own distinct photo (the partial
    unique index only forbids two pending reports on the SAME photo from one reporter)."""
    now = datetime.now(UTC)
    for i in range(n):
        photo = FountainPhoto(
            fountain_id=fountain_id,
            user_id=reporter.id,
            storage_key=f"seed-k-{i}",
            thumbnail_key=f"seed-t-{i}",
            content_type="image/jpeg",
            width=1,
            height=1,
            byte_size=1,
        )
        session.add(photo)
        await session.flush()
        session.add(
            PhotoReport(
                photo_id=photo.id,
                reporter_user_id=reporter.id,
                category="spam",
                status="pending",
                created_at=now - timedelta(seconds=i),
            )
        )
    await session.commit()


def _as_user(u: User):
    app.dependency_overrides[get_current_user] = lambda: u


# --- DELETE -------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_owner_delete_removes_row_storage_point_and_cascades_reports(
    session, client, test_user, storage, process
):
    fid = await _add_fountain(session)
    await session.commit()
    pid = await _upload_photo(client, fid)

    # Another user reports the photo (pending) before it's deleted.
    reporter = await _add_user(session, 1)
    await session.commit()
    _as_user(reporter)
    r = await client.post(
        f"/api/v1/fountains/{fid}/photos/{pid}/report",
        json={"category": "spam"},
    )
    assert r.status_code == 204
    _as_user(test_user)

    resp = await client.delete(f"/api/v1/fountains/{fid}/photos/{pid}")
    assert resp.status_code == 204, resp.text

    await session.rollback()
    assert (
        await session.execute(select(FountainPhoto).where(FountainPhoto.id == pid))
    ).scalar_one_or_none() is None

    assert sorted(storage.deleted_keys) == sorted(
        [f"fountains/{fid}/{pid}.jpg", f"fountains/{fid}/{pid}_thumb.jpg"]
    )

    ev = (
        await session.execute(
            select(ContributionEvent).where(
                ContributionEvent.target_type == "photo",
                ContributionEvent.target_id == uuid.UUID(pid),
            )
        )
    ).scalar_one()
    assert ev.status == "reversed"

    # The photo's pending reports are gone via ON DELETE CASCADE (not resolved).
    remaining_reports = (
        (await session.execute(select(PhotoReport).where(PhotoReport.photo_id == uuid.UUID(pid))))
        .scalars()
        .all()
    )
    assert remaining_reports == []


@pytest.mark.asyncio
async def test_non_owner_delete_forbidden(session, client, test_user, storage, process):
    fid = await _add_fountain(session)
    await session.commit()
    pid = await _upload_photo(client, fid)

    other = await _add_user(session, 2)
    await session.commit()
    _as_user(other)
    try:
        resp = await client.delete(f"/api/v1/fountains/{fid}/photos/{pid}")
    finally:
        _as_user(test_user)

    assert resp.status_code == 403
    await session.rollback()
    assert (
        await session.execute(select(FountainPhoto).where(FountainPhoto.id == pid))
    ).scalar_one_or_none() is not None


@pytest.mark.asyncio
async def test_delete_storage_failure_returns_5xx_and_records_cleanup(
    session, client, test_user, failing_storage, process
):
    fid = await _add_fountain(session)
    await session.commit()
    pid = await _upload_photo(client, fid)

    resp = await client.delete(f"/api/v1/fountains/{fid}/photos/{pid}")

    assert 500 <= resp.status_code < 600, resp.text
    await session.rollback()
    # Photo row untouched (delete not committed on storage failure).
    assert (
        await session.execute(select(FountainPhoto).where(FountainPhoto.id == pid))
    ).scalar_one_or_none() is not None

    cleanup_rows = (
        await session.execute(
            text("SELECT object_key, reason FROM storage_cleanup ORDER BY object_key")
        )
    ).all()
    assert len(cleanup_rows) == 2
    assert {r.reason for r in cleanup_rows} == {"moderation_delete"}
    assert {r.object_key for r in cleanup_rows} == {
        f"fountains/{fid}/{pid}.jpg",
        f"fountains/{fid}/{pid}_thumb.jpg",
    }


@pytest.mark.asyncio
async def test_delete_wrong_fountain_path_404s(session, client, test_user, storage, process):
    fid1 = await _add_fountain(session)
    fid2 = await _add_fountain(session)
    await session.commit()
    pid = await _upload_photo(client, fid1)

    resp = await client.delete(f"/api/v1/fountains/{fid2}/photos/{pid}")
    assert resp.status_code == 404


# --- REPORT ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_any_signed_in_user_creates_pending_report(
    session, client, test_user, storage, process
):
    fid = await _add_fountain(session)
    await session.commit()
    pid = await _upload_photo(client, fid)

    reporter = await _add_user(session, 3)
    await session.commit()
    _as_user(reporter)
    try:
        resp = await client.post(
            f"/api/v1/fountains/{fid}/photos/{pid}/report",
            json={"category": "inappropriate", "note": "looks fake"},
        )
    finally:
        _as_user(test_user)

    assert resp.status_code == 204, resp.text
    await session.rollback()
    row = (
        await session.execute(select(PhotoReport).where(PhotoReport.photo_id == uuid.UUID(pid)))
    ).scalar_one()
    assert row.status == "pending"
    assert row.reporter_user_id == reporter.id
    assert row.category == "inappropriate"


@pytest.mark.asyncio
async def test_duplicate_pending_report_is_idempotent_and_session_still_commits(
    session, client, test_user, storage, process
):
    fid = await _add_fountain(session)
    await session.commit()
    pid = await _upload_photo(client, fid)

    r1 = await client.post(
        f"/api/v1/fountains/{fid}/photos/{pid}/report", json={"category": "spam"}
    )
    r2 = await client.post(
        f"/api/v1/fountains/{fid}/photos/{pid}/report", json={"category": "other"}
    )
    assert r1.status_code == 204
    assert r2.status_code == 204  # no IntegrityError bubbles up on the duplicate

    await session.rollback()
    rows = (
        (await session.execute(select(PhotoReport).where(PhotoReport.photo_id == uuid.UUID(pid))))
        .scalars()
        .all()
    )
    assert len(rows) == 1  # duplicate silently ignored, original category unchanged
    assert rows[0].category == "spam"

    # The session is still usable afterward (a poisoned async session would fail here).
    r3 = await client.get(f"/api/v1/fountains/{fid}/photos")
    assert r3.status_code == 200


@pytest.mark.asyncio
async def test_report_invalid_category_422(session, client, test_user, storage, process):
    fid = await _add_fountain(session)
    await session.commit()
    pid = await _upload_photo(client, fid)

    resp = await client.post(
        f"/api/v1/fountains/{fid}/photos/{pid}/report", json={"category": "bogus"}
    )
    assert resp.status_code == 422


@pytest.mark.asyncio
async def test_report_note_too_long_422(session, client, test_user, storage, process):
    fid = await _add_fountain(session)
    await session.commit()
    pid = await _upload_photo(client, fid)

    resp = await client.post(
        f"/api/v1/fountains/{fid}/photos/{pid}/report",
        json={"category": "spam", "note": "x" * 501},
    )
    assert resp.status_code == 422


@pytest.mark.asyncio
async def test_report_hidden_photo_allowed(session, client, test_user, storage, process):
    fid = await _add_fountain(session)
    await session.commit()
    pid = await _upload_photo(client, fid)
    await _hide_photo(session, pid)

    resp = await client.post(
        f"/api/v1/fountains/{fid}/photos/{pid}/report", json={"category": "spam"}
    )
    assert resp.status_code == 204
    await session.rollback()
    assert (
        await session.execute(select(PhotoReport).where(PhotoReport.photo_id == uuid.UUID(pid)))
    ).scalar_one_or_none() is not None


@pytest.mark.asyncio
async def test_report_rate_limited_429(session, client, test_user, storage, process):
    fid = await _add_fountain(session)
    await session.commit()
    pid = await _upload_photo(client, fid)
    await _seed_reports(session, test_user, fid, REPORTS_PER_MIN)

    resp = await client.post(
        f"/api/v1/fountains/{fid}/photos/{pid}/report", json={"category": "spam"}
    )
    assert resp.status_code == 429
    assert "Retry-After" in resp.headers


@pytest.mark.asyncio
async def test_report_unknown_photo_404(session, client, test_user, storage, process):
    fid = await _add_fountain(session)
    await session.commit()

    resp = await client.post(
        f"/api/v1/fountains/{fid}/photos/{uuid.uuid4()}/report", json={"category": "spam"}
    )
    assert resp.status_code == 404


@pytest.mark.asyncio
async def test_report_wrong_fountain_path_404(session, client, test_user, storage, process):
    fid1 = await _add_fountain(session)
    fid2 = await _add_fountain(session)
    await session.commit()
    pid = await _upload_photo(client, fid1)

    resp = await client.post(
        f"/api/v1/fountains/{fid2}/photos/{pid}/report", json={"category": "spam"}
    )
    assert resp.status_code == 404
