"""Task B14 — admin photo moderation queue + hide/dismiss/delete.

The admin router gains five photo routes (all gated by ``require_admin``):

- ``GET  /admin/photo-reports``           — moderation queue (grouped by photo, pending-only,
  oldest-first, ≤3 truncated notes per photo, paginated).
- ``GET  /admin/photo-reports/summary``   — ``{pending_photo_count}`` = distinct pending photos.
- ``PATCH /admin/photos/{id}``            — hide/unhide: flips ``is_hidden`` + stamps, resolves
  this photo's pending reports on hide (``resolution='hidden'``), reverses/reactivates the point.
- ``POST /admin/photos/{id}/dismiss-reports`` — resolve pending reports ``rejected``; photo stays.
- ``DELETE /admin/photos/{id}``           — delete both Spaces objects first (5xx + storage_cleanup
  on failure), reverse the point, delete the row (reports cascade).

Free-text report notes are admin-only PII: they are truncated to ≤200 chars **in SQL**, capped at
the 3 newest per photo, and **never logged** — the audit-log tests assert a sentinel note string
never reaches the logs. ``get_storage`` is monkeypatched so no real S3 work runs.
"""

from __future__ import annotations

import logging
import uuid
from datetime import UTC, datetime, timedelta

import pytest
from httpx import ASGITransport, AsyncClient
from sqlalchemy import select

import app.routers.admin as admin_module
import app.routers.photos as photos_module
from app.config import Settings, get_settings
from app.geo import point_geography
from app.main import app
from app.models import (
    ContentReport,
    ContributionEvent,
    Fountain,
    FountainPhoto,
    User,
    UserContributionStats,
)

pytestmark = pytest.mark.anyio

_SENTINEL_NOTE = "SECRET_PII_NOTE_do_not_log_9f3a"


# --- fixtures -----------------------------------------------------------------------


@pytest.fixture
def admin_settings():
    app.dependency_overrides[get_settings] = lambda: Settings(
        dev_auth_enabled=True,
        admin_subjects=["admin-sub"],
    )
    yield
    app.dependency_overrides.pop(get_settings, None)


@pytest.fixture
async def raw_client(admin_settings):
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        yield ac


class _FakeStorage:
    def __init__(self, *, delete_raises: bool = False):
        self.deleted_keys: list[str] = []
        self._delete_raises = delete_raises

    def delete_object(self, key: str) -> None:
        if self._delete_raises:
            raise RuntimeError("simulated Spaces delete failure")
        self.deleted_keys.append(key)

    def presign_get(self, key: str) -> str:
        return "https://signed.example.com/object?sig=abc"


@pytest.fixture
def storage(monkeypatch) -> _FakeStorage:
    s = _FakeStorage()
    monkeypatch.setattr(admin_module, "get_storage", lambda settings: s)
    # The public read endpoint lives in photos_module; point it at the same fake so a
    # visible photo redirects instead of 503-ing when a test exercises GET /photos/{id}.
    monkeypatch.setattr(photos_module, "get_storage", lambda settings: s)
    return s


@pytest.fixture
def failing_storage(monkeypatch) -> _FakeStorage:
    s = _FakeStorage(delete_raises=True)
    monkeypatch.setattr(admin_module, "get_storage", lambda settings: s)
    return s


# --- seeding helpers ----------------------------------------------------------------


async def _add_fountain(session) -> Fountain:
    fountain = Fountain(
        location=point_geography(37.5, -122.2),
        is_working=True,
        created_source="admin_import",
    )
    session.add(fountain)
    await session.commit()
    await session.refresh(fountain)
    return fountain


async def _add_user(session, *, name: str) -> User:
    u = User(
        logto_user_id=f"b14-{uuid.uuid4()}",
        email=f"{uuid.uuid4()}@example.com",
        display_name=name,
    )
    session.add(u)
    await session.commit()
    await session.refresh(u)
    return u


async def _add_photo(
    session, fountain: Fountain, uploader: User, *, hidden: bool = False
) -> FountainPhoto:
    pid = uuid.uuid4()
    photo = FountainPhoto(
        id=pid,
        fountain_id=fountain.id,
        user_id=uploader.id,
        storage_key=f"fountains/{fountain.id}/{pid}.jpg",
        thumbnail_key=f"fountains/{fountain.id}/{pid}_thumb.jpg",
        content_type="image/jpeg",
        width=800,
        height=600,
        byte_size=12345,
        is_hidden=hidden,
    )
    session.add(photo)
    await session.commit()
    await session.refresh(photo)
    return photo


async def _add_report(
    session,
    photo: FountainPhoto,
    reporter: User,
    *,
    category: str = "spam",
    note: str | None = None,
    status: str = "pending",
    created_at: datetime | None = None,
) -> ContentReport:
    report = ContentReport(
        content_type="photo",
        content_id=photo.id,
        fountain_id=photo.fountain_id,
        reporter_user_id=reporter.id,
        category=category,
        note=note,
        status=status,
        resolution="rejected" if status == "resolved" else None,
        created_at=created_at or datetime.now(UTC),
    )
    session.add(report)
    await session.commit()
    await session.refresh(report)
    return report


async def _award_photo_point(session, photo: FountainPhoto, uploader: User) -> ContributionEvent:
    event = ContributionEvent(
        user_id=uploader.id,
        fountain_id=photo.fountain_id,
        target_type="photo",
        target_id=photo.id,
        event_type="photo_first",
        points=5,
        status="awarded",
        dedup_key=f"photo_first:{photo.id}",
    )
    session.add(event)
    session.add(
        UserContributionStats(user_id=uploader.id, total_points=5),
    )
    await session.commit()
    await session.refresh(event)
    return event


async def _admin_user(session) -> User:
    return (
        await session.execute(select(User).where(User.logto_user_id == "admin-sub"))
    ).scalar_one()


# --- authz --------------------------------------------------------------------------


async def test_all_photo_routes_require_admin(raw_client, session):
    uploader = await _add_user(session, name="Uploader")
    fountain = await _add_fountain(session)
    photo = await _add_photo(session, fountain, uploader)

    routes = [
        ("GET", "/api/v1/admin/photo-reports", None),
        ("GET", "/api/v1/admin/photo-reports/summary", None),
        ("PATCH", f"/api/v1/admin/photos/{photo.id}", {"is_hidden": True}),
        ("POST", f"/api/v1/admin/photos/{photo.id}/dismiss-reports", None),
        ("DELETE", f"/api/v1/admin/photos/{photo.id}", None),
    ]
    for method, path, body in routes:
        kwargs = {"json": body} if body is not None else {}
        anon = await raw_client.request(method, path, **kwargs)
        assert anon.status_code == 401, f"{method} {path}"
        non_admin = await raw_client.request(
            method, path, headers={"X-Dev-User": "regular-sub"}, **kwargs
        )
        assert non_admin.status_code == 403, f"{method} {path}"


# --- queue --------------------------------------------------------------------------


async def test_queue_groups_by_photo_pending_only_oldest_first(raw_client, session):
    uploader = await _add_user(session, name="Uploader")
    reporter1 = await _add_user(session, name="R1")
    reporter2 = await _add_user(session, name="R2")
    reporter3 = await _add_user(session, name="R3")
    fountain = await _add_fountain(session)

    now = datetime.now(UTC)

    # photo A: 3 pending reports (two categories) + 1 already-resolved report.
    photo_a = await _add_photo(session, fountain, uploader)
    await _add_report(
        session, photo_a, reporter1, category="spam", created_at=now - timedelta(minutes=5)
    )
    await _add_report(
        session, photo_a, reporter2, category="inappropriate", created_at=now - timedelta(minutes=4)
    )
    await _add_report(
        session, photo_a, reporter3, category="spam", created_at=now - timedelta(minutes=3)
    )
    await _add_report(
        session,
        photo_a,
        reporter1,
        category="other",
        status="resolved",
        created_at=now - timedelta(minutes=2),
    )

    # photo B: a single pending report, but OLDER than any of photo A's -> sorts first.
    photo_b = await _add_photo(session, fountain, uploader)
    await _add_report(
        session,
        photo_b,
        reporter1,
        category="not_a_fountain",
        created_at=now - timedelta(minutes=10),
    )

    # photo C: only a resolved report -> must NOT appear in the pending queue.
    photo_c = await _add_photo(session, fountain, uploader)
    await _add_report(
        session, photo_c, reporter1, status="resolved", created_at=now - timedelta(minutes=1)
    )

    resp = await raw_client.get("/api/v1/admin/photo-reports", headers={"X-Dev-User": "admin-sub"})
    assert resp.status_code == 200
    rows = resp.json()
    ids = [r["photo_id"] for r in rows]
    assert ids == [str(photo_b.id), str(photo_a.id)]  # oldest first, C absent
    assert str(photo_c.id) not in ids

    a_row = next(r for r in rows if r["photo_id"] == str(photo_a.id))
    assert a_row["report_count"] == 3  # resolved report excluded
    assert sorted(a_row["categories"]) == ["inappropriate", "spam"]
    assert a_row["fountain_id"] == str(fountain.id)
    assert a_row["url"] == f"/api/v1/photos/{photo_a.id}"
    assert a_row["thumbnail_url"] == f"/api/v1/photos/{photo_a.id}/thumb"
    assert a_row["is_hidden"] is False
    assert a_row["uploaded_by"] == "Uploader"

    b_row = next(r for r in rows if r["photo_id"] == str(photo_b.id))
    assert b_row["report_count"] == 1
    assert b_row["categories"] == ["not_a_fountain"]


async def test_queue_notes_truncated_and_capped_to_three(raw_client, session):
    uploader = await _add_user(session, name="Uploader")
    fountain = await _add_fountain(session)
    photo = await _add_photo(session, fountain, uploader)

    now = datetime.now(UTC)
    reporters = [await _add_user(session, name=f"R{i}") for i in range(5)]
    # 5 pending reports; notes are long. Newest note should be first, only 3 returned.
    for i, reporter in enumerate(reporters):
        await _add_report(
            session,
            photo,
            reporter,
            note=f"note-{i}-" + ("x" * 300),
            created_at=now - timedelta(minutes=10 - i),  # i=4 is newest
        )

    resp = await raw_client.get("/api/v1/admin/photo-reports", headers={"X-Dev-User": "admin-sub"})
    assert resp.status_code == 200
    row = resp.json()[0]
    notes = row["notes"]
    assert len(notes) == 3  # capped at 3
    assert all(len(n) <= 200 for n in notes)  # truncated in SQL
    # newest three, newest first
    assert notes[0].startswith("note-4-")
    assert notes[1].startswith("note-3-")
    assert notes[2].startswith("note-2-")
    assert row["report_count"] == 5


async def test_queue_pagination(raw_client, session):
    uploader = await _add_user(session, name="Uploader")
    reporter = await _add_user(session, name="R")
    fountain = await _add_fountain(session)
    now = datetime.now(UTC)

    photos = []
    for i in range(3):
        photo = await _add_photo(session, fountain, uploader)
        await _add_report(session, photo, reporter, created_at=now - timedelta(minutes=10 - i))
        photos.append(photo)
    # oldest-first order is photos[0], photos[1], photos[2]

    page1 = await raw_client.get(
        "/api/v1/admin/photo-reports",
        params={"limit": 2, "offset": 0},
        headers={"X-Dev-User": "admin-sub"},
    )
    assert [r["photo_id"] for r in page1.json()] == [str(photos[0].id), str(photos[1].id)]

    page2 = await raw_client.get(
        "/api/v1/admin/photo-reports",
        params={"limit": 2, "offset": 2},
        headers={"X-Dev-User": "admin-sub"},
    )
    assert [r["photo_id"] for r in page2.json()] == [str(photos[2].id)]


async def test_summary_counts_distinct_pending_photos(raw_client, session):
    uploader = await _add_user(session, name="Uploader")
    r1 = await _add_user(session, name="R1")
    r2 = await _add_user(session, name="R2")
    fountain = await _add_fountain(session)

    photo_a = await _add_photo(session, fountain, uploader)
    await _add_report(session, photo_a, r1)
    await _add_report(session, photo_a, r2)  # 2 reports, still ONE distinct photo
    photo_b = await _add_photo(session, fountain, uploader)
    await _add_report(session, photo_b, r1)
    photo_c = await _add_photo(session, fountain, uploader)
    await _add_report(session, photo_c, r1, status="resolved")  # not pending -> excluded

    resp = await raw_client.get(
        "/api/v1/admin/photo-reports/summary", headers={"X-Dev-User": "admin-sub"}
    )
    assert resp.status_code == 200
    assert resp.json() == {"pending_photo_count": 2}


# --- hide / unhide ------------------------------------------------------------------


async def test_hide_flips_stamps_resolves_reverses_and_read_404s(raw_client, session, storage):
    uploader = await _add_user(session, name="Uploader")
    reporter = await _add_user(session, name="R1")
    fountain = await _add_fountain(session)
    photo = await _add_photo(session, fountain, uploader)
    photo_id = photo.id
    await _add_report(session, photo, reporter, note="please hide this")
    await _award_photo_point(session, photo, uploader)

    resp = await raw_client.patch(
        f"/api/v1/admin/photos/{photo_id}",
        headers={"X-Dev-User": "admin-sub"},
        json={"is_hidden": True},
    )
    assert resp.status_code == 200
    assert resp.json()["is_hidden"] is True

    session.expire_all()
    admin = await _admin_user(session)

    fresh = (
        await session.execute(select(FountainPhoto).where(FountainPhoto.id == photo_id))
    ).scalar_one()
    assert fresh.is_hidden is True
    assert fresh.hidden_by_user_id == admin.id
    assert fresh.hidden_at is not None

    report = (
        await session.execute(
            select(ContentReport).where(
                ContentReport.content_type == "photo", ContentReport.content_id == photo_id
            )
        )
    ).scalar_one()
    assert report.status == "resolved"
    assert report.resolution == "hidden"
    assert report.resolved_by_user_id == admin.id
    assert report.resolved_at is not None

    event = (
        await session.execute(
            select(ContributionEvent).where(ContributionEvent.target_id == photo_id)
        )
    ).scalar_one()
    assert event.status == "reversed"

    # The gated read endpoint now 404s (is_hidden=true, B11).
    read = await raw_client.get(f"/api/v1/photos/{photo_id}", follow_redirects=False)
    assert read.status_code == 404


async def test_unhide_reactivates_and_read_resolves(raw_client, session, storage):
    uploader = await _add_user(session, name="Uploader")
    reporter = await _add_user(session, name="R1")
    fountain = await _add_fountain(session)
    photo = await _add_photo(session, fountain, uploader)
    photo_id = photo.id
    await _add_report(session, photo, reporter)
    await _award_photo_point(session, photo, uploader)

    # hide, then unhide
    await raw_client.patch(
        f"/api/v1/admin/photos/{photo_id}",
        headers={"X-Dev-User": "admin-sub"},
        json={"is_hidden": True},
    )
    resp = await raw_client.patch(
        f"/api/v1/admin/photos/{photo_id}",
        headers={"X-Dev-User": "admin-sub"},
        json={"is_hidden": False},
    )
    assert resp.status_code == 200
    assert resp.json()["is_hidden"] is False

    session.expire_all()
    fresh = (
        await session.execute(select(FountainPhoto).where(FountainPhoto.id == photo_id))
    ).scalar_one()
    assert fresh.is_hidden is False
    assert fresh.hidden_by_user_id is None
    assert fresh.hidden_at is None

    # The point is re-awarded.
    event = (
        await session.execute(
            select(ContributionEvent).where(ContributionEvent.target_id == photo_id)
        )
    ).scalar_one()
    assert event.status == "awarded"

    # Already-resolved report stays resolved (unhide does not un-resolve).
    report = (
        await session.execute(
            select(ContentReport).where(
                ContentReport.content_type == "photo", ContentReport.content_id == photo_id
            )
        )
    ).scalar_one()
    assert report.status == "resolved"

    # The gated read endpoint resolves again (302 redirect via mocked storage).
    read = await raw_client.get(f"/api/v1/photos/{photo_id}", follow_redirects=False)
    assert read.status_code == 302


# --- dismiss ------------------------------------------------------------------------


async def test_dismiss_sets_rejected_and_photo_stays_visible(raw_client, session):
    uploader = await _add_user(session, name="Uploader")
    r1 = await _add_user(session, name="R1")
    r2 = await _add_user(session, name="R2")
    fountain = await _add_fountain(session)
    photo = await _add_photo(session, fountain, uploader)
    photo_id = photo.id
    await _add_report(session, photo, r1)
    await _add_report(session, photo, r2)

    resp = await raw_client.post(
        f"/api/v1/admin/photos/{photo_id}/dismiss-reports",
        headers={"X-Dev-User": "admin-sub"},
    )
    assert resp.status_code == 204

    session.expire_all()
    admin = await _admin_user(session)
    reports = (
        (
            await session.execute(
                select(ContentReport).where(
                    ContentReport.content_type == "photo", ContentReport.content_id == photo_id
                )
            )
        )
        .scalars()
        .all()
    )
    assert len(reports) == 2
    assert all(r.status == "resolved" and r.resolution == "rejected" for r in reports)
    assert all(r.resolved_by_user_id == admin.id and r.resolved_at is not None for r in reports)

    fresh = (
        await session.execute(select(FountainPhoto).where(FountainPhoto.id == photo_id))
    ).scalar_one()
    assert fresh.is_hidden is False  # photo stays visible

    # Dismissed photo drops out of the queue.
    queue = await raw_client.get("/api/v1/admin/photo-reports", headers={"X-Dev-User": "admin-sub"})
    assert queue.json() == []


async def test_dismiss_unknown_photo_404(raw_client, session):
    resp = await raw_client.post(
        f"/api/v1/admin/photos/{uuid.uuid4()}/dismiss-reports",
        headers={"X-Dev-User": "admin-sub"},
    )
    assert resp.status_code == 404


# --- delete -------------------------------------------------------------------------


async def test_delete_removes_objects_row_and_reverses_point(raw_client, session, storage):
    uploader = await _add_user(session, name="Uploader")
    reporter = await _add_user(session, name="R1")
    fountain = await _add_fountain(session)
    photo = await _add_photo(session, fountain, uploader)
    photo_id = photo.id
    await _add_report(session, photo, reporter)
    await _award_photo_point(session, photo, uploader)
    storage_key, thumbnail_key = photo.storage_key, photo.thumbnail_key

    resp = await raw_client.delete(
        f"/api/v1/admin/photos/{photo_id}", headers={"X-Dev-User": "admin-sub"}
    )
    assert resp.status_code == 204

    assert sorted(storage.deleted_keys) == sorted([storage_key, thumbnail_key])

    session.expire_all()
    assert (
        await session.execute(select(FountainPhoto).where(FountainPhoto.id == photo_id))
    ).scalar_one_or_none() is None
    # reports removed by cascade
    assert (
        (
            await session.execute(
                select(ContentReport).where(
                    ContentReport.content_type == "photo", ContentReport.content_id == photo_id
                )
            )
        )
        .scalars()
        .all()
    ) == []
    # point reversed (event survives, fountain_id preserved via SET NULL is fine)
    event = (
        await session.execute(
            select(ContributionEvent).where(ContributionEvent.target_id == photo_id)
        )
    ).scalar_one()
    assert event.status == "reversed"


async def test_delete_storage_failure_returns_5xx_and_records_cleanup(
    raw_client, session, failing_storage
):
    uploader = await _add_user(session, name="Uploader")
    fountain = await _add_fountain(session)
    photo = await _add_photo(session, fountain, uploader)
    photo_id = photo.id
    storage_key, thumbnail_key = photo.storage_key, photo.thumbnail_key

    resp = await raw_client.delete(
        f"/api/v1/admin/photos/{photo_id}", headers={"X-Dev-User": "admin-sub"}
    )
    assert 500 <= resp.status_code < 600

    session.expire_all()
    # Row untouched (delete not committed on storage failure).
    assert (
        await session.execute(select(FountainPhoto).where(FountainPhoto.id == photo_id))
    ).scalar_one_or_none() is not None

    from sqlalchemy import text as _text

    cleanup_rows = (
        await session.execute(
            _text("SELECT object_key, reason FROM storage_cleanup ORDER BY object_key")
        )
    ).all()
    assert {r.reason for r in cleanup_rows} == {"moderation_delete"}
    assert {r.object_key for r in cleanup_rows} == {storage_key, thumbnail_key}


async def test_delete_unknown_photo_404(raw_client, session, storage):
    resp = await raw_client.delete(
        f"/api/v1/admin/photos/{uuid.uuid4()}", headers={"X-Dev-User": "admin-sub"}
    )
    assert resp.status_code == 404


# --- audit logs carry no raw notes --------------------------------------------------


async def test_audit_logs_never_contain_raw_notes(raw_client, session, storage, caplog):
    uploader = await _add_user(session, name="Uploader")
    reporter = await _add_user(session, name="R1")
    fountain = await _add_fountain(session)

    photo_hide = await _add_photo(session, fountain, uploader)
    await _add_report(session, photo_hide, reporter, note=_SENTINEL_NOTE)
    photo_dismiss = await _add_photo(session, fountain, uploader)
    await _add_report(session, photo_dismiss, reporter, note=_SENTINEL_NOTE)

    with caplog.at_level(logging.DEBUG):
        # Queue read (reads notes but must not log them).
        q = await raw_client.get("/api/v1/admin/photo-reports", headers={"X-Dev-User": "admin-sub"})
        assert q.status_code == 200
        # The sentinel note IS in the response body...
        assert _SENTINEL_NOTE in q.text

        await raw_client.patch(
            f"/api/v1/admin/photos/{photo_hide.id}",
            headers={"X-Dev-User": "admin-sub"},
            json={"is_hidden": True},
        )
        await raw_client.post(
            f"/api/v1/admin/photos/{photo_dismiss.id}/dismiss-reports",
            headers={"X-Dev-User": "admin-sub"},
        )

    # ...but never in the logs.
    assert _SENTINEL_NOTE not in caplog.text


# --- fountain-delete cascades every content_report -----------------------------------


async def test_admin_delete_fountain_cascades_all_content_reports(raw_client, session, storage):
    """Deleting a fountain removes ALL its content_reports (photo + fountain types) via the
    fountain_id ON DELETE CASCADE — no per-type explicit cleanup needed (spec §3.2)."""
    uploader = await _add_user(session, name="Uploader")
    reporter = await _add_user(session, name="R1")
    fountain = await _add_fountain(session)
    fountain_id = fountain.id

    # A pending report on the fountain's photo...
    photo = await _add_photo(session, fountain, uploader)
    await _add_report(session, photo, reporter, category="spam")
    # ...and a pending report on the fountain itself (content_type='fountain').
    session.add(
        ContentReport(
            content_type="fountain",
            content_id=fountain_id,
            fountain_id=fountain_id,
            reporter_user_id=reporter.id,
            category="not_a_fountain",
            status="pending",
        )
    )
    await session.commit()

    resp = await raw_client.delete(
        f"/api/v1/admin/fountains/{fountain_id}", headers={"X-Dev-User": "admin-sub"}
    )
    assert resp.status_code == 204

    session.expire_all()
    remaining = (
        (
            await session.execute(
                select(ContentReport).where(ContentReport.fountain_id == fountain_id)
            )
        )
        .scalars()
        .all()
    )
    assert remaining == []
