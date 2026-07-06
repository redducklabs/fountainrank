"""#12 — the unified admin moderation queue, badge summary, and generalized dismiss.

Three new admin routes (all gated by ``require_admin``), added ALONGSIDE the untouched
photo-only routes (old mobile clients still call those):

- ``GET  /admin/reports``           — one heterogeneous queue across photo/note/fountain,
  pending-only, oldest-first, ≤3 truncated report notes per item, paginated, optional
  ``content_type`` filter, orphans excluded via a per-type EXISTS predicate.
- ``GET  /admin/reports/summary``   — ``{pending_count}`` = distinct pending items across types.
- ``POST /admin/reports/dismiss``   — reject an item's pending reports (per-type existence check).

Reporter free-text notes are admin-only PII: truncated ≤200 in SQL, ≤3 newest per item, and
never logged.
"""

from __future__ import annotations

import logging
import uuid
from datetime import UTC, datetime, timedelta

import pytest
from httpx import ASGITransport, AsyncClient
from sqlalchemy import select

from app.config import Settings, get_settings
from app.geo import point_geography
from app.main import app
from app.models import ContentReport, Fountain, FountainNote, FountainPhoto, User

pytestmark = pytest.mark.anyio

_SENTINEL_NOTE = "SECRET_PII_NOTE_do_not_log_12q"


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


# --- seeding helpers ----------------------------------------------------------------


async def _add_user(session, *, name: str) -> User:
    u = User(
        logto_user_id=f"u12-{uuid.uuid4()}",
        email=f"{uuid.uuid4()}@example.com",
        display_name=name,
    )
    session.add(u)
    await session.commit()
    await session.refresh(u)
    return u


async def _add_fountain(
    session, *, hidden: bool = False, placement_note: str | None = None
) -> Fountain:
    fountain = Fountain(
        location=point_geography(37.5, -122.2),
        is_working=True,
        is_hidden=hidden,
        placement_note=placement_note,
        created_source="admin_import",
    )
    session.add(fountain)
    await session.commit()
    await session.refresh(fountain)
    return fountain


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


async def _add_note(
    session, fountain: Fountain, author: User, *, body: str = "public note", hidden: bool = False
) -> FountainNote:
    note = FountainNote(fountain_id=fountain.id, user_id=author.id, body=body, is_hidden=hidden)
    session.add(note)
    await session.commit()
    await session.refresh(note)
    return note


async def _add_report(
    session,
    *,
    content_type: str,
    content_id: uuid.UUID,
    fountain_id: uuid.UUID,
    reporter: User,
    category: str = "spam",
    note: str | None = None,
    status: str = "pending",
    created_at: datetime | None = None,
) -> ContentReport:
    report = ContentReport(
        content_type=content_type,
        content_id=content_id,
        fountain_id=fountain_id,
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


async def _admin_user(session) -> User:
    return (
        await session.execute(select(User).where(User.logto_user_id == "admin-sub"))
    ).scalar_one()


# --- authz --------------------------------------------------------------------------


async def test_all_report_routes_require_admin(raw_client):
    routes = [
        ("GET", "/api/v1/admin/reports", None),
        ("GET", "/api/v1/admin/reports/summary", None),
        (
            "POST",
            "/api/v1/admin/reports/dismiss",
            {"content_type": "photo", "content_id": str(uuid.uuid4())},
        ),
    ]
    for method, path, body in routes:
        kwargs = {"json": body} if body is not None else {}
        anon = await raw_client.request(method, path, **kwargs)
        assert anon.status_code == 401, f"{method} {path}"
        non_admin = await raw_client.request(
            method, path, headers={"X-Dev-User": "regular-sub"}, **kwargs
        )
        assert non_admin.status_code == 403, f"{method} {path}"


# --- unified queue ------------------------------------------------------------------


async def test_queue_returns_all_types_oldest_first(raw_client, session):
    uploader = await _add_user(session, name="Uploader")
    author = await _add_user(session, name="Author")
    r1 = await _add_user(session, name="R1")
    r2 = await _add_user(session, name="R2")
    now = datetime.now(UTC)

    f1 = await _add_fountain(session, placement_note="near the north gate")
    f2 = await _add_fountain(session)

    # photo on f1: 2 pending (min T-10) + 1 resolved (excluded)
    photo = await _add_photo(session, f1, uploader)
    await _add_report(
        session,
        content_type="photo",
        content_id=photo.id,
        fountain_id=f1.id,
        reporter=r1,
        category="spam",
        created_at=now - timedelta(minutes=10),
    )
    await _add_report(
        session,
        content_type="photo",
        content_id=photo.id,
        fountain_id=f1.id,
        reporter=r2,
        category="inappropriate",
        created_at=now - timedelta(minutes=9),
    )
    await _add_report(
        session,
        content_type="photo",
        content_id=photo.id,
        fountain_id=f1.id,
        reporter=author,
        status="resolved",
        created_at=now - timedelta(minutes=1),
    )

    # fountain report on f1 (min T-8)
    await _add_report(
        session,
        content_type="fountain",
        content_id=f1.id,
        fountain_id=f1.id,
        reporter=r1,
        category="not_a_fountain",
        created_at=now - timedelta(minutes=8),
    )

    # note on f1 (min T-5)
    note = await _add_note(session, f1, author, body="a public note body")
    await _add_report(
        session,
        content_type="note",
        content_id=note.id,
        fountain_id=f1.id,
        reporter=r1,
        category="abuse",
        created_at=now - timedelta(minutes=5),
    )

    # photo on f2 (min T-3)
    photo2 = await _add_photo(session, f2, uploader)
    await _add_report(
        session,
        content_type="photo",
        content_id=photo2.id,
        fountain_id=f2.id,
        reporter=r1,
        created_at=now - timedelta(minutes=3),
    )

    resp = await raw_client.get("/api/v1/admin/reports", headers={"X-Dev-User": "admin-sub"})
    assert resp.status_code == 200
    rows = resp.json()
    assert [(r["content_type"], r["content_id"]) for r in rows] == [
        ("photo", str(photo.id)),
        ("fountain", str(f1.id)),
        ("note", str(note.id)),
        ("photo", str(photo2.id)),
    ]

    photo_row = rows[0]
    assert photo_row["report_count"] == 2  # resolved excluded
    assert sorted(photo_row["categories"]) == ["inappropriate", "spam"]
    assert photo_row["fountain_id"] == str(f1.id)
    assert photo_row["thumbnail_url"] == f"/api/v1/photos/{photo.id}/thumb"
    assert photo_row["url"] == f"/api/v1/photos/{photo.id}"
    assert photo_row["contributor"] == "Uploader"
    assert photo_row["is_hidden"] is False

    fountain_row = rows[1]
    assert fountain_row["fountain_label"] == "near the north gate"
    assert fountain_row["contributor"] is None
    assert fountain_row["report_count"] == 1

    note_row = rows[2]
    assert note_row["excerpt"] == "a public note body"
    assert note_row["contributor"] == "Author"


async def test_queue_content_type_filter(raw_client, session):
    uploader = await _add_user(session, name="Uploader")
    author = await _add_user(session, name="Author")
    r1 = await _add_user(session, name="R1")
    f = await _add_fountain(session)

    photo = await _add_photo(session, f, uploader)
    await _add_report(
        session, content_type="photo", content_id=photo.id, fountain_id=f.id, reporter=r1
    )
    note = await _add_note(session, f, author)
    await _add_report(
        session, content_type="note", content_id=note.id, fountain_id=f.id, reporter=r1
    )
    await _add_report(
        session,
        content_type="fountain",
        content_id=f.id,
        fountain_id=f.id,
        reporter=r1,
        category="not_a_fountain",
    )

    resp = await raw_client.get(
        "/api/v1/admin/reports",
        params={"content_type": "note"},
        headers={"X-Dev-User": "admin-sub"},
    )
    assert resp.status_code == 200
    rows = resp.json()
    assert [r["content_type"] for r in rows] == ["note"]
    assert rows[0]["content_id"] == str(note.id)


async def test_queue_bad_content_type_filter_422(raw_client):
    resp = await raw_client.get(
        "/api/v1/admin/reports",
        params={"content_type": "bogus"},
        headers={"X-Dev-User": "admin-sub"},
    )
    assert resp.status_code == 422


async def test_queue_includes_hidden_items(raw_client, session):
    author = await _add_user(session, name="Author")
    r1 = await _add_user(session, name="R1")
    f = await _add_fountain(session, hidden=True, placement_note="hidden fountain")
    await _add_report(
        session,
        content_type="fountain",
        content_id=f.id,
        fountain_id=f.id,
        reporter=r1,
        category="not_a_fountain",
    )
    note = await _add_note(session, f, author, hidden=True)
    await _add_report(
        session, content_type="note", content_id=note.id, fountain_id=f.id, reporter=r1
    )

    resp = await raw_client.get("/api/v1/admin/reports", headers={"X-Dev-User": "admin-sub"})
    assert resp.status_code == 200
    by_type = {r["content_type"]: r for r in resp.json()}
    assert by_type["fountain"]["is_hidden"] is True
    assert by_type["note"]["is_hidden"] is True


async def test_queue_notes_truncated_and_capped_to_three(raw_client, session):
    author = await _add_user(session, name="Author")
    f = await _add_fountain(session)
    note = await _add_note(session, f, author)
    now = datetime.now(UTC)
    reporters = [await _add_user(session, name=f"R{i}") for i in range(5)]
    for i, reporter in enumerate(reporters):
        await _add_report(
            session,
            content_type="note",
            content_id=note.id,
            fountain_id=f.id,
            reporter=reporter,
            note=f"note-{i}-" + ("x" * 300),
            created_at=now - timedelta(minutes=10 - i),  # i=4 newest
        )
    resp = await raw_client.get("/api/v1/admin/reports", headers={"X-Dev-User": "admin-sub"})
    row = resp.json()[0]
    notes = row["notes"]
    assert len(notes) == 3
    assert all(len(n) <= 200 for n in notes)
    assert notes[0].startswith("note-4-")
    assert notes[1].startswith("note-3-")
    assert notes[2].startswith("note-2-")
    assert row["report_count"] == 5


async def test_queue_pagination_stable_across_shared_timestamp(raw_client, session):
    uploader = await _add_user(session, name="Uploader")
    r1 = await _add_user(session, name="R1")
    f = await _add_fountain(session)
    # Same created_at on every report -> the (content_type, content_id) tiebreak must make
    # pagination deterministic (no skip/dup at a page boundary).
    ts = datetime.now(UTC) - timedelta(minutes=5)
    for _ in range(3):
        photo = await _add_photo(session, f, uploader)
        await _add_report(
            session,
            content_type="photo",
            content_id=photo.id,
            fountain_id=f.id,
            reporter=r1,
            created_at=ts,
        )

    full = await raw_client.get("/api/v1/admin/reports", headers={"X-Dev-User": "admin-sub"})
    order = [r["content_id"] for r in full.json()]
    assert len(order) == 3

    paged: list[str] = []
    for offset in range(3):
        page = await raw_client.get(
            "/api/v1/admin/reports",
            params={"limit": 1, "offset": offset},
            headers={"X-Dev-User": "admin-sub"},
        )
        ids = [r["content_id"] for r in page.json()]
        assert len(ids) == 1
        paged.extend(ids)
    assert paged == order  # stable: paginated concatenation == single-shot order


async def test_queue_excludes_orphan_reports(raw_client, session):
    uploader = await _add_user(session, name="Uploader")
    r1 = await _add_user(session, name="R1")
    f = await _add_fountain(session)
    now = datetime.now(UTC)

    # A real photo report (must appear).
    photo = await _add_photo(session, f, uploader)
    await _add_report(
        session,
        content_type="photo",
        content_id=photo.id,
        fountain_id=f.id,
        reporter=r1,
        created_at=now - timedelta(minutes=5),
    )

    # Orphan reports: content_id has NO content row (soft ref). These must NOT surface, and must
    # not corrupt the surviving row's pagination. Oldest timestamps so they'd sort first if buggy.
    await _add_report(
        session,
        content_type="photo",
        content_id=uuid.uuid4(),
        fountain_id=f.id,
        reporter=r1,
        note=_SENTINEL_NOTE,
        created_at=now - timedelta(minutes=20),
    )
    await _add_report(
        session,
        content_type="note",
        content_id=uuid.uuid4(),
        fountain_id=f.id,
        reporter=r1,
        note=_SENTINEL_NOTE,
        created_at=now - timedelta(minutes=19),
    )

    resp = await raw_client.get("/api/v1/admin/reports", headers={"X-Dev-User": "admin-sub"})
    assert resp.status_code == 200
    rows = resp.json()
    assert [(r["content_type"], r["content_id"]) for r in rows] == [("photo", str(photo.id))]
    assert _SENTINEL_NOTE not in resp.text  # orphan notes never leak


# --- summary ------------------------------------------------------------------------


async def test_summary_counts_distinct_pending_across_types(raw_client, session):
    uploader = await _add_user(session, name="Uploader")
    author = await _add_user(session, name="Author")
    r1 = await _add_user(session, name="R1")
    r2 = await _add_user(session, name="R2")
    f = await _add_fountain(session)

    # photo with 2 reports -> ONE distinct item
    photo = await _add_photo(session, f, uploader)
    await _add_report(
        session, content_type="photo", content_id=photo.id, fountain_id=f.id, reporter=r1
    )
    await _add_report(
        session, content_type="photo", content_id=photo.id, fountain_id=f.id, reporter=r2
    )
    # a note item
    note = await _add_note(session, f, author)
    await _add_report(
        session, content_type="note", content_id=note.id, fountain_id=f.id, reporter=r1
    )
    # a fountain item
    await _add_report(
        session,
        content_type="fountain",
        content_id=f.id,
        fountain_id=f.id,
        reporter=r1,
        category="not_a_fountain",
    )
    # a resolved report -> excluded
    photo2 = await _add_photo(session, f, uploader)
    await _add_report(
        session,
        content_type="photo",
        content_id=photo2.id,
        fountain_id=f.id,
        reporter=r1,
        status="resolved",
    )
    # an orphan -> excluded
    await _add_report(
        session, content_type="note", content_id=uuid.uuid4(), fountain_id=f.id, reporter=r1
    )

    resp = await raw_client.get(
        "/api/v1/admin/reports/summary", headers={"X-Dev-User": "admin-sub"}
    )
    assert resp.status_code == 200
    assert resp.json() == {"pending_count": 3}  # photo + note + fountain


# --- dismiss ------------------------------------------------------------------------


async def test_dismiss_rejects_pending_for_each_type(raw_client, session):
    uploader = await _add_user(session, name="Uploader")
    author = await _add_user(session, name="Author")
    r1 = await _add_user(session, name="R1")
    f = await _add_fountain(session)

    photo = await _add_photo(session, f, uploader)
    await _add_report(
        session, content_type="photo", content_id=photo.id, fountain_id=f.id, reporter=r1
    )
    note = await _add_note(session, f, author)
    await _add_report(
        session, content_type="note", content_id=note.id, fountain_id=f.id, reporter=r1
    )
    await _add_report(
        session,
        content_type="fountain",
        content_id=f.id,
        fountain_id=f.id,
        reporter=r1,
        category="not_a_fountain",
    )

    for content_type, content_id in (("photo", photo.id), ("note", note.id), ("fountain", f.id)):
        resp = await raw_client.post(
            "/api/v1/admin/reports/dismiss",
            headers={"X-Dev-User": "admin-sub"},
            json={"content_type": content_type, "content_id": str(content_id)},
        )
        assert resp.status_code == 204, content_type

    session.expire_all()
    admin = await _admin_user(session)
    rows = (await session.execute(select(ContentReport))).scalars().all()
    assert rows
    assert all(r.status == "resolved" and r.resolution == "rejected" for r in rows)
    assert all(r.resolved_by_user_id == admin.id and r.resolved_at is not None for r in rows)

    # Queue is now empty.
    queue = await raw_client.get("/api/v1/admin/reports", headers={"X-Dev-User": "admin-sub"})
    assert queue.json() == []


async def test_dismiss_idempotent_when_no_pending(raw_client, session):
    uploader = await _add_user(session, name="Uploader")
    r1 = await _add_user(session, name="R1")
    f = await _add_fountain(session)
    photo = await _add_photo(session, f, uploader)
    await _add_report(
        session, content_type="photo", content_id=photo.id, fountain_id=f.id, reporter=r1
    )

    first = await raw_client.post(
        "/api/v1/admin/reports/dismiss",
        headers={"X-Dev-User": "admin-sub"},
        json={"content_type": "photo", "content_id": str(photo.id)},
    )
    assert first.status_code == 204
    second = await raw_client.post(
        "/api/v1/admin/reports/dismiss",
        headers={"X-Dev-User": "admin-sub"},
        json={"content_type": "photo", "content_id": str(photo.id)},
    )
    assert second.status_code == 204  # idempotent no-op


async def test_dismiss_missing_target_404(raw_client, session):
    # Valid content_type but the target doesn't exist -> 404 (per-type existence check).
    for content_type in ("photo", "note", "fountain"):
        resp = await raw_client.post(
            "/api/v1/admin/reports/dismiss",
            headers={"X-Dev-User": "admin-sub"},
            json={"content_type": content_type, "content_id": str(uuid.uuid4())},
        )
        assert resp.status_code == 404, content_type


async def test_dismiss_bad_content_type_422(raw_client):
    resp = await raw_client.post(
        "/api/v1/admin/reports/dismiss",
        headers={"X-Dev-User": "admin-sub"},
        json={"content_type": "bogus", "content_id": str(uuid.uuid4())},
    )
    assert resp.status_code == 422


# --- PII: report notes never logged -------------------------------------------------


async def test_queue_and_dismiss_never_log_raw_notes(raw_client, session, caplog):
    uploader = await _add_user(session, name="Uploader")
    r1 = await _add_user(session, name="R1")
    f = await _add_fountain(session)
    photo = await _add_photo(session, f, uploader)
    await _add_report(
        session,
        content_type="photo",
        content_id=photo.id,
        fountain_id=f.id,
        reporter=r1,
        note=_SENTINEL_NOTE,
    )

    with caplog.at_level(logging.DEBUG):
        q = await raw_client.get("/api/v1/admin/reports", headers={"X-Dev-User": "admin-sub"})
        assert q.status_code == 200
        assert _SENTINEL_NOTE in q.text  # note IS in the response body...
        await raw_client.post(
            "/api/v1/admin/reports/dismiss",
            headers={"X-Dev-User": "admin-sub"},
            json={"content_type": "photo", "content_id": str(photo.id)},
        )
    assert _SENTINEL_NOTE not in caplog.text  # ...but never in the logs
