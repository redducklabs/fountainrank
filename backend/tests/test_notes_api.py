import uuid

import pytest
from httpx import ASGITransport, AsyncClient
from sqlalchemy import select, update

from app.auth import get_current_user
from app.config import Settings, get_settings
from app.main import app
from app.models import ContributionEvent, FountainNote, User, UserContributionStats

LOC = {"latitude": 7.0, "longitude": 8.0}


@pytest.fixture
def settings_override():
    def _apply(**kwargs):
        app.dependency_overrides[get_settings] = lambda: Settings(**kwargs)

    yield _apply
    app.dependency_overrides.pop(get_settings, None)


async def _add_fountain(client) -> str:
    r = await client.post("/api/v1/fountains", json={"location": LOC})
    assert r.status_code == 201
    return r.json()["id"]


@pytest.mark.asyncio
async def test_create_edit_and_read(client, test_user, session):
    fid = await _add_fountain(client)
    r1 = await client.post(f"/api/v1/fountains/{fid}/notes", json={"body": "  cold and clean  "})
    assert r1.status_code == 200
    assert r1.json()["body"] == "cold and clean"  # trimmed
    created = r1.json()["updated_at"]

    notes = (await client.get(f"/api/v1/fountains/{fid}/notes")).json()
    assert len(notes) == 1
    assert notes[0]["author_display_name"] == test_user.display_name

    # Edit (same user) replaces the single note + advances updated_at.
    r2 = await client.post(f"/api/v1/fountains/{fid}/notes", json={"body": "now lukewarm"})
    assert r2.json()["body"] == "now lukewarm"
    assert r2.json()["updated_at"] >= created
    notes2 = (await client.get(f"/api/v1/fountains/{fid}/notes")).json()
    assert len(notes2) == 1  # replaced, not duplicated


@pytest.mark.asyncio
async def test_two_users_two_notes_newest_first(client, test_user, session):
    fid = await _add_fountain(client)
    await client.post(f"/api/v1/fountains/{fid}/notes", json={"body": "first user"})
    u2 = User(logto_user_id="note-u2", email="note2@example.com", display_name="U2")
    session.add(u2)
    await session.commit()
    app.dependency_overrides[get_current_user] = lambda: u2
    try:
        await client.post(f"/api/v1/fountains/{fid}/notes", json={"body": "second user"})
    finally:
        app.dependency_overrides[get_current_user] = lambda: test_user
    notes = (await client.get(f"/api/v1/fountains/{fid}/notes")).json()
    assert len(notes) == 2
    assert notes[0]["body"] == "second user"  # newest first


@pytest.mark.asyncio
async def test_hidden_note_excluded_and_edit_stays_hidden(client, test_user, session):
    fid = await _add_fountain(client)
    await client.post(f"/api/v1/fountains/{fid}/notes", json={"body": "visible"})
    note = (
        await session.execute(select(FountainNote).where(FountainNote.user_id == test_user.id))
    ).scalar_one()
    # Moderator hides it.
    await session.execute(
        update(FountainNote).where(FountainNote.id == note.id).values(is_hidden=True)
    )
    await session.commit()
    assert (await client.get(f"/api/v1/fountains/{fid}/notes")).json() == []

    # Same user edits -> must STAY hidden (no self-unhide), body updated in DB.
    await client.post(f"/api/v1/fountains/{fid}/notes", json={"body": "trying to resurface"})
    assert (await client.get(f"/api/v1/fountains/{fid}/notes")).json() == []
    refreshed = (
        await session.execute(select(FountainNote).where(FountainNote.id == note.id))
    ).scalar_one()
    await session.refresh(refreshed)
    assert refreshed.is_hidden is True
    assert refreshed.body == "trying to resurface"


@pytest.mark.asyncio
async def test_body_validation(client):
    fid = await _add_fountain(client)
    assert (
        await client.post(f"/api/v1/fountains/{fid}/notes", json={"body": "   "})
    ).status_code == 422
    assert (
        await client.post(f"/api/v1/fountains/{fid}/notes", json={"body": ""})
    ).status_code == 422
    assert (
        await client.post(f"/api/v1/fountains/{fid}/notes", json={"body": "x" * 1001})
    ).status_code == 422
    assert (
        await client.post(f"/api/v1/fountains/{fid}/notes", json={"body": "x" * 1000})
    ).status_code == 200


@pytest.mark.asyncio
async def test_event_emitted_and_no_double_award(client, test_user, session):
    fid = await _add_fountain(client)
    await client.post(f"/api/v1/fountains/{fid}/notes", json={"body": "n1"})
    ev = (
        await session.execute(
            select(ContributionEvent).where(
                ContributionEvent.user_id == test_user.id,
                ContributionEvent.event_type == "add_note",
            )
        )
    ).scalar_one()
    assert ev.target_type == "note" and ev.target_id is not None
    stats = (
        await session.execute(
            select(UserContributionStats).where(UserContributionStats.user_id == test_user.id)
        )
    ).scalar_one()
    assert stats.notes_count == 1
    pts = stats.total_points
    # Edit -> no re-award.
    await client.post(f"/api/v1/fountains/{fid}/notes", json={"body": "n2"})
    stats2 = (
        await session.execute(
            select(UserContributionStats).where(UserContributionStats.user_id == test_user.id)
        )
    ).scalar_one()
    assert stats2.notes_count == 1 and stats2.total_points == pts


@pytest.mark.asyncio
async def test_public_note_does_not_leak_logto_subject(client, test_user, session):
    from app.display import ANONYMOUS_DISPLAY_NAME

    fid = await _add_fountain(client)
    # Simulate provisioning that fell back to the Logto subject (no name/username):
    # display_name == logto_user_id (the raw subject).
    sub = "auth0|deadbeefsubject"
    leaky = User(logto_user_id=sub, email="leak@example.com", display_name=sub)
    session.add(leaky)
    await session.commit()
    app.dependency_overrides[get_current_user] = lambda: leaky
    try:
        await client.post(
            f"/api/v1/fountains/{fid}/notes", json={"body": "hi from a synced-less user"}
        )
    finally:
        app.dependency_overrides[get_current_user] = lambda: test_user

    notes = (await client.get(f"/api/v1/fountains/{fid}/notes")).json()
    assert len(notes) == 1
    assert notes[0]["author_display_name"] == ANONYMOUS_DISPLAY_NAME
    assert sub not in notes[0]["author_display_name"]


@pytest.mark.asyncio
async def test_notes_404_on_missing_fountain(client):
    assert (await client.get(f"/api/v1/fountains/{uuid.uuid4()}/notes")).status_code == 404


@pytest.mark.asyncio
async def test_notes_write_requires_auth(settings_override):
    settings_override(dev_auth_enabled=False)
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        r = await ac.post(f"/api/v1/fountains/{uuid.uuid4()}/notes", json={"body": "hi"})
    assert r.status_code == 401
