import uuid
from datetime import UTC, datetime, timedelta

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


@pytest.mark.asyncio
async def test_detail_condition_points_eligible_at_authenticated(client, test_user):
    # The detail GET resolves its viewer via get_optional_user, NOT the get_current_user the
    # `client` fixture overrides — and the fixture sends no auth header, so get_optional_user
    # returns None by default. To exercise the AUTHENTICATED eligibility branch we must
    # override get_optional_user (same pattern as test_fountains_detail.py /
    # test_gamification_api.py: app.dependency_overrides[get_optional_user] = lambda: test_user).
    from app.auth import get_optional_user
    from app.main import app

    fid = await _add_fountain(client)
    app.dependency_overrides[get_optional_user] = lambda: test_user
    try:
        before = (await client.get(f"/api/v1/fountains/{fid}")).json()
        assert before["condition_points_eligible_at"] is None
        assert before["condition_points_awarded"] is None  # GET never sets the award count
        await _report(client, fid, "working")
        after = (await client.get(f"/api/v1/fountains/{fid}")).json()
        assert after["condition_points_eligible_at"] is not None
        assert after["condition_points_awarded"] is None
    finally:
        app.dependency_overrides.pop(get_optional_user, None)


@pytest.mark.asyncio
async def test_detail_condition_points_eligible_at_anonymous(client):
    # No get_optional_user override + no auth header => anonymous viewer, so eligibility is
    # always null even immediately after a report (spec: null for anonymous callers).
    fid = await _add_fountain(client)
    await _report(client, fid, "working")  # report is attributed to test_user via the write seam
    detail = (await client.get(f"/api/v1/fountains/{fid}")).json()
    assert detail["condition_points_eligible_at"] is None


async def _total_points(session, user_id):
    from sqlalchemy import select

    from app.models import UserContributionStats

    return (
        await session.execute(
            select(UserContributionStats.total_points).where(
                UserContributionStats.user_id == user_id
            )
        )
    ).scalar_one_or_none() or 0


@pytest.mark.asyncio
async def test_repeat_condition_within_24h_awards_zero(client, test_user, session):
    fid = await _add_fountain(client)
    r1 = await _report(client, fid, "working")
    assert r1.json()["condition_points_awarded"] == 3
    p1 = await _total_points(session, test_user.id)
    # A different condition type on the same fountain within 24h is coalesced -> 0.
    r2 = await _report(client, fid, "broken")
    assert r2.json()["condition_points_awarded"] == 0
    assert await _total_points(session, test_user.id) == p1
    # The report row still persisted (data always persists).
    from sqlalchemy import func, select

    from app.models import ConditionReport

    n = (
        await session.execute(
            select(func.count())
            .select_from(ConditionReport)
            .where(ConditionReport.user_id == test_user.id)
        )
    ).scalar_one()
    assert n == 2


@pytest.mark.asyncio
async def test_condition_awards_again_after_window(client, test_user, session):
    from sqlalchemy import update

    from app.models import ContributionEvent

    fid = await _add_fountain(client)
    await _report(client, fid, "working")  # awards 3
    # Age the awarded event to just over 24h ago so the next report is eligible.
    await session.execute(
        update(ContributionEvent)
        .where(ContributionEvent.user_id == test_user.id)
        .values(created_at=datetime.now(tz=UTC) - timedelta(hours=24, minutes=1))
    )
    await session.commit()
    r = await _report(client, fid, "working")
    assert r.json()["condition_points_awarded"] == 3


@pytest.mark.asyncio
async def test_legacy_calendar_key_blocks_new_award(client, test_user, session):
    from app.contributions import ContributionSpec, record_contributions

    fid = await _add_fountain(client)
    # Seed a legacy calendar-day-keyed award 1h ago (old dk_verify shape).
    await record_contributions(
        session,
        [
            ContributionSpec(
                user_id=test_user.id,
                event_type="verify_working",
                dedup_key=f"verify:{test_user.id}:{fid}:legacy",
                fountain_id=fid,
                target_type="condition_report",
                target_id=__import__("uuid").uuid4(),
                created_at=datetime.now(tz=UTC) - timedelta(hours=1),
            )
        ],
    )
    await session.commit()
    r = await _report(client, fid, "working")
    assert r.json()["condition_points_awarded"] == 0


@pytest.mark.asyncio
async def test_first_problem_report_awards_two(client):
    # The non-working (report_condition) award path is a public contract: 2 points.
    fid = await _add_fountain(client)
    r = await _report(client, fid, "broken")
    assert r.json()["condition_points_awarded"] == 2
