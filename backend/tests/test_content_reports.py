"""Content-report endpoints for notes (B2) and fountains (B3) (#11).

Mirrors the photo report suite (`test_photos_delete_report.py`) across the two new content
types. All three report endpoints share the `app/reports.py` chokepoint, so these focus on the
per-type category matrix (§6), target validation/scoping (404s), idempotency, rate limiting, and
the PII-safe logging guarantee (the raw note is never logged).
"""

from __future__ import annotations

import logging
import uuid
from datetime import UTC, datetime, timedelta

import pytest
from sqlalchemy import select

from app.auth import get_current_user
from app.geo import point_geography
from app.main import app
from app.models import ContentReport, Fountain, FountainNote, User
from app.rate_limit import REPORTS_PER_MIN

pytestmark = pytest.mark.asyncio


# --- seeding helpers ----------------------------------------------------------------


async def _add_fountain(session, *, created_source: str = "admin_import") -> Fountain:
    # created_source defaults to a non-'user' source so no added_by_user_id is required
    # (the ck_fountains_user_source_requires_user CHECK).
    fountain = Fountain(
        location=point_geography(37.5, -122.2),
        is_working=True,
        created_source=created_source,
    )
    session.add(fountain)
    await session.commit()
    await session.refresh(fountain)
    return fountain


async def _add_note(
    session, fountain: Fountain, author: User, *, hidden: bool = False
) -> FountainNote:
    note = FountainNote(
        fountain_id=fountain.id,
        user_id=author.id,
        body="a note",
        is_hidden=hidden,
    )
    session.add(note)
    await session.commit()
    await session.refresh(note)
    return note


async def _add_user(session, n: int) -> User:
    u = User(
        logto_user_id=f"cr-u{n}",
        email=f"cr-u{n}@example.com",
        display_name=f"CR User {n}",
    )
    session.add(u)
    await session.commit()
    await session.refresh(u)
    return u


async def _seed_reports_for(session, reporter: User, fountain: Fountain, n: int) -> None:
    """Seed n pending reports by `reporter` on distinct (soft) content_ids so the reporter's
    rolling rate window fills without tripping the per-item pending dedupe."""
    now = datetime.now(UTC)
    for i in range(n):
        session.add(
            ContentReport(
                content_type="note",
                content_id=uuid.uuid4(),
                fountain_id=fountain.id,
                reporter_user_id=reporter.id,
                category="spam",
                status="pending",
                created_at=now - timedelta(seconds=i),
            )
        )
    await session.commit()


def _as_user(u: User) -> None:
    app.dependency_overrides[get_current_user] = lambda: u


# --- B2: note report ----------------------------------------------------------------


async def test_report_note_any_signed_in_user_creates_pending_row(session, client, test_user):
    fountain = await _add_fountain(session)
    note = await _add_note(session, fountain, test_user)
    fid, nid, uid = fountain.id, note.id, test_user.id  # capture before the expiring rollback

    resp = await client.post(
        f"/api/v1/fountains/{fid}/notes/{nid}/report",
        json={"category": "abuse", "note": "harassment"},
    )
    assert resp.status_code == 204, resp.text

    await session.rollback()
    row = (
        await session.execute(select(ContentReport).where(ContentReport.content_id == nid))
    ).scalar_one()
    assert row.content_type == "note"
    assert row.fountain_id == fid
    assert row.reporter_user_id == uid
    assert row.category == "abuse"
    assert row.status == "pending"


async def test_report_note_category_outside_note_set_422(session, client, test_user):
    fountain = await _add_fountain(session)
    note = await _add_note(session, fountain, test_user)
    fid, nid = fountain.id, note.id

    # 'not_a_fountain' is a fountain/photo category, NOT allowed for a note.
    resp = await client.post(
        f"/api/v1/fountains/{fid}/notes/{nid}/report",
        json={"category": "not_a_fountain"},
    )
    assert resp.status_code == 422
    await session.rollback()
    assert (
        await session.execute(select(ContentReport).where(ContentReport.content_id == nid))
    ).scalar_one_or_none() is None


async def test_report_note_too_long_422(session, client, test_user):
    fountain = await _add_fountain(session)
    note = await _add_note(session, fountain, test_user)

    resp = await client.post(
        f"/api/v1/fountains/{fountain.id}/notes/{note.id}/report",
        json={"category": "spam", "note": "x" * 501},
    )
    assert resp.status_code == 422


async def test_report_note_duplicate_pending_is_idempotent(session, client, test_user):
    fountain = await _add_fountain(session)
    note = await _add_note(session, fountain, test_user)
    fid, nid = fountain.id, note.id

    r1 = await client.post(f"/api/v1/fountains/{fid}/notes/{nid}/report", json={"category": "spam"})
    r2 = await client.post(
        f"/api/v1/fountains/{fid}/notes/{nid}/report", json={"category": "abuse"}
    )
    assert r1.status_code == 204
    assert r2.status_code == 204  # no IntegrityError bubbles up on the duplicate

    await session.rollback()
    rows = (
        (await session.execute(select(ContentReport).where(ContentReport.content_id == nid)))
        .scalars()
        .all()
    )
    assert len(rows) == 1
    assert rows[0].category == "spam"  # original unchanged

    # The session is still usable afterward (a poisoned async session would fail here).
    ok = await client.get(f"/api/v1/fountains/{fid}/notes")
    assert ok.status_code == 200


async def test_report_note_rate_limited_429(session, client, test_user):
    fountain = await _add_fountain(session)
    note = await _add_note(session, fountain, test_user)
    # Fill the reporter's minute window with distinct-content reports; the NEXT new report 429s.
    await _seed_reports_for(session, test_user, fountain, REPORTS_PER_MIN)

    resp = await client.post(
        f"/api/v1/fountains/{fountain.id}/notes/{note.id}/report", json={"category": "spam"}
    )
    assert resp.status_code == 429
    assert "Retry-After" in resp.headers


async def test_report_hidden_note_allowed(session, client, test_user):
    fountain = await _add_fountain(session)
    note = await _add_note(session, fountain, test_user, hidden=True)
    fid, nid = fountain.id, note.id

    resp = await client.post(
        f"/api/v1/fountains/{fid}/notes/{nid}/report", json={"category": "spam"}
    )
    assert resp.status_code == 204
    await session.rollback()
    assert (
        await session.execute(select(ContentReport).where(ContentReport.content_id == nid))
    ).scalar_one_or_none() is not None


async def test_report_note_unknown_404(session, client, test_user):
    fountain = await _add_fountain(session)
    resp = await client.post(
        f"/api/v1/fountains/{fountain.id}/notes/{uuid.uuid4()}/report", json={"category": "spam"}
    )
    assert resp.status_code == 404


async def test_report_note_wrong_fountain_scope_404(session, client, test_user):
    fountain_a = await _add_fountain(session)
    fountain_b = await _add_fountain(session)
    note = await _add_note(session, fountain_a, test_user)
    fid_b, nid = fountain_b.id, note.id

    resp = await client.post(
        f"/api/v1/fountains/{fid_b}/notes/{nid}/report", json={"category": "spam"}
    )
    assert resp.status_code == 404
    await session.rollback()
    assert (
        await session.execute(select(ContentReport).where(ContentReport.content_id == nid))
    ).scalar_one_or_none() is None


async def test_report_note_raw_text_never_logged(session, client, test_user, caplog):
    fountain = await _add_fountain(session)
    note = await _add_note(session, fountain, test_user)
    sentinel = "SECRET_REPORT_NOTE_do_not_log_7b2c"

    with caplog.at_level(logging.DEBUG):
        resp = await client.post(
            f"/api/v1/fountains/{fountain.id}/notes/{note.id}/report",
            json={"category": "spam", "note": sentinel},
        )
        assert resp.status_code == 204
    assert sentinel not in caplog.text
