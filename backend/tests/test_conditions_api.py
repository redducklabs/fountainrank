import uuid

import pytest
from httpx import ASGITransport, AsyncClient
from sqlalchemy import func, select

from app.auth import get_current_user
from app.config import Settings, get_settings
from app.main import app
from app.models import ContributionEvent, User, UserContributionStats

LOC = {"latitude": 5.0, "longitude": 6.0}


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


async def _report(client, fid, status_value, is_proximate=False):
    return await client.post(
        f"/api/v1/fountains/{fid}/conditions",
        json={"status": status_value, "is_proximate": is_proximate},
    )


@pytest.mark.asyncio
async def test_single_report_is_advisory_corroboration_makes_authoritative(
    client, test_user, session
):
    fid = await _add_fountain(client)
    # Single broken -> advisory reported_issue (one actor can't flip authoritative).
    r1 = await _report(client, fid, "broken")
    assert r1.status_code == 200
    assert r1.json()["current_status"] == "reported_issue"

    # A second distinct user corroborates -> authoritative not_working.
    u2 = User(logto_user_id="cond-api-2", email="ca2@example.com", display_name="C2")
    session.add(u2)
    await session.commit()
    app.dependency_overrides[get_current_user] = lambda: u2
    try:
        r2 = await _report(client, fid, "broken")
    finally:
        app.dependency_overrides[get_current_user] = lambda: test_user
    assert r2.json()["current_status"] == "not_working"

    # Reflected on the map pin too.
    pins = (
        await client.get("/api/v1/fountains/bbox?min_lat=4&min_lng=5&max_lat=6&max_lng=7")
    ).json()
    pin = next(p for p in pins if p["id"] == fid)
    assert pin["current_status"] == "not_working"


@pytest.mark.asyncio
async def test_verify_working_sets_last_verified(client):
    fid = await _add_fountain(client)
    r = await _report(client, fid, "working")
    body = r.json()
    assert body["last_verified_at"] is not None
    # A single working report is not corroborated -> current_status stays null (baseline).
    assert body["current_status"] is None


@pytest.mark.asyncio
async def test_event_emitted_with_target_and_per_day_dedup(client, test_user, session):
    fid = await _add_fountain(client)
    await _report(client, fid, "working")
    ev = (
        await session.execute(
            select(ContributionEvent).where(
                ContributionEvent.user_id == test_user.id,
                ContributionEvent.event_type == "verify_working",
            )
        )
    ).scalar_one()
    assert ev.target_type == "condition_report" and ev.target_id is not None

    points1 = (
        await session.execute(
            select(UserContributionStats.total_points).where(
                UserContributionStats.user_id == test_user.id
            )
        )
    ).scalar_one()
    # Second verify same day -> idempotent (no extra points).
    await _report(client, fid, "working")
    points2 = (
        await session.execute(
            select(UserContributionStats.total_points).where(
                UserContributionStats.user_id == test_user.id
            )
        )
    ).scalar_one()
    assert points2 == points1
    n_verify = (
        await session.execute(
            select(func.count())
            .select_from(ContributionEvent)
            .where(
                ContributionEvent.user_id == test_user.id,
                ContributionEvent.event_type == "verify_working",
            )
        )
    ).scalar_one()
    assert n_verify == 1


@pytest.mark.asyncio
async def test_report_condition_counts_separately(client, test_user, session):
    fid = await _add_fountain(client)
    await _report(client, fid, "low_pressure")
    stats = (
        await session.execute(
            select(UserContributionStats).where(UserContributionStats.user_id == test_user.id)
        )
    ).scalar_one()
    assert stats.conditions_reported == 1
    assert stats.verifications_count == 0


@pytest.mark.asyncio
async def test_bad_status_422(client):
    fid = await _add_fountain(client)
    r = await _report(client, fid, "exploded")
    assert r.status_code == 422


@pytest.mark.asyncio
async def test_conditions_requires_auth(settings_override):
    settings_override(dev_auth_enabled=False)
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        r = await ac.post(
            f"/api/v1/fountains/{uuid.uuid4()}/conditions", json={"status": "working"}
        )
    assert r.status_code == 401
