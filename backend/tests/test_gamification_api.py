import pytest
from httpx import ASGITransport, AsyncClient
from sqlalchemy import text

from app.auth import get_current_user
from app.config import Settings, get_settings
from app.geo import point_geography
from app.main import app
from app.models import ContributionEvent, User, UserContributionStats


@pytest.fixture
def settings_override():
    def _apply(**kwargs):
        app.dependency_overrides[get_settings] = lambda: Settings(**kwargs)

    yield _apply
    app.dependency_overrides.pop(get_settings, None)


async def _user(session, key, display=None):
    u = User(logto_user_id=key, email=f"{key}@example.com", display_name=display or key.upper())
    session.add(u)
    await session.flush()
    return u


# ---------------- migration: GiST index ----------------
@pytest.mark.asyncio
async def test_location_gist_index_present(session):
    idx = dict(
        (
            await session.execute(
                text(
                    "SELECT indexname, indexdef FROM pg_indexes "
                    "WHERE tablename='contribution_events'"
                )
            )
        ).all()
    )
    assert "idx_contribution_events_location" in idx
    assert "gist" in idx["idx_contribution_events_location"].lower()


# ---------------- /me/badges ----------------
@pytest.mark.asyncio
async def test_me_badges_requires_auth(settings_override):
    settings_override(dev_auth_enabled=False)
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        r = await ac.get("/api/v1/me/badges")
    assert r.status_code == 401


@pytest.mark.asyncio
async def test_me_badges_from_stats(client, test_user, session):
    session.add(
        UserContributionStats(
            user_id=test_user.id, total_points=50, fountains_added=1, ratings_count=1
        )
    )
    await session.commit()
    keys = {b["key"] for b in (await client.get("/api/v1/me/badges")).json()}
    assert {"first_fountain", "hydrated_helper"} <= keys


@pytest.mark.asyncio
async def test_me_badges_reversed_rate_not_counted(client, test_user, session):
    for i in range(10):
        session.add(
            ContributionEvent(
                user_id=test_user.id,
                event_type="rate",
                points=2,
                status="reversed",
                dedup_key=f"rev-{i}",
                event_metadata={"rating_type_id": 3},
            )
        )
    await session.commit()
    keys = {b["key"] for b in (await client.get("/api/v1/me/badges")).json()}
    assert "pressure_tester" not in keys  # reversed don't count

    for i in range(10):
        session.add(
            ContributionEvent(
                user_id=test_user.id,
                event_type="rate",
                points=2,
                status="awarded",
                dedup_key=f"awd-{i}",
                event_metadata={"rating_type_id": 3},
            )
        )
    await session.commit()
    keys = {b["key"] for b in (await client.get("/api/v1/me/badges")).json()}
    assert "pressure_tester" in keys


# ---------------- leaderboard ----------------
@pytest.mark.asyncio
async def test_global_leaderboard_order_and_tie(client, session):
    a = await _user(session, "lb-a")
    b = await _user(session, "lb-b")
    c = await _user(session, "lb-c")
    session.add_all(
        [
            UserContributionStats(user_id=a.id, total_points=100),
            UserContributionStats(user_id=b.id, total_points=50),
            UserContributionStats(user_id=c.id, total_points=100),
        ]
    )
    await session.commit()
    rows = (await client.get("/api/v1/leaderboard/contributors")).json()
    pts = [r["points"] for r in rows]
    assert pts == [100, 100, 50]  # descending
    # The two 100-point users are tie-broken by user_id ASC (deterministic).
    tied = sorted([a, c], key=lambda u: str(u.id))
    assert [r["display_name"] for r in rows[:2]] == [tied[0].display_name, tied[1].display_name]
    assert rows[2]["display_name"] == b.display_name
    assert rows[0]["fountains_added"] is not None  # global rows carry counts


@pytest.mark.asyncio
async def test_global_leaderboard_excludes_zero_point_users(client, session):
    # A user whose points were all reversed (e.g. after a hard-delete) keeps a stats row at
    # total_points=0 — it must NOT linger on the public "top contributors" board (#119).
    keep = await _user(session, "lb-keep")
    zeroed = await _user(session, "lb-zeroed")
    session.add_all(
        [
            UserContributionStats(user_id=keep.id, total_points=10),
            UserContributionStats(user_id=zeroed.id, total_points=0, fountains_added=0),
        ]
    )
    await session.commit()
    rows = (await client.get("/api/v1/leaderboard/contributors")).json()
    names = [r["display_name"] for r in rows]
    assert keep.display_name in names
    assert zeroed.display_name not in names


@pytest.mark.asyncio
async def test_global_leaderboard_masks_subject(client, session):
    sub = "auth0|leak-sub"
    u = await _user(session, sub, display=sub)  # display_name == logto_user_id
    session.add(UserContributionStats(user_id=u.id, total_points=10))
    await session.commit()
    rows = (await client.get("/api/v1/leaderboard/contributors")).json()
    names = {r["display_name"] for r in rows}
    assert sub not in names and "Anonymous" in names


@pytest.mark.asyncio
async def test_local_leaderboard(client, session):
    near = await _user(session, "lb-near")
    far = await _user(session, "lb-far")
    # near events (within 5km of origin), far events (~78km away), and a reversed near event.
    session.add_all(
        [
            ContributionEvent(
                user_id=near.id,
                event_type="add_fountain",
                points=10,
                status="awarded",
                dedup_key="ln1",
                location=point_geography(0.001, 0.001),
            ),
            ContributionEvent(
                user_id=near.id,
                event_type="rate",
                points=2,
                status="reversed",
                dedup_key="ln2",
                location=point_geography(0.001, 0.001),
            ),
            ContributionEvent(
                user_id=far.id,
                event_type="add_fountain",
                points=10,
                status="awarded",
                dedup_key="lf1",
                location=point_geography(0.7, 0.7),
            ),
        ]
    )
    await session.commit()
    rows = (
        await client.get("/api/v1/leaderboard/contributors?near_lat=0&near_lng=0&radius_m=5000")
    ).json()
    assert len(rows) == 1
    assert rows[0]["display_name"] == "LB-NEAR"
    assert rows[0]["points"] == 10  # reversed near event excluded; far excluded
    assert rows[0]["fountains_added"] is None  # local rows have null counts


@pytest.mark.asyncio
async def test_local_leaderboard_tie_and_null_location(client, session):
    u1 = await _user(session, "loc-1")
    u2 = await _user(session, "loc-2")
    u3 = await _user(session, "loc-3")
    session.add_all(
        [
            ContributionEvent(
                user_id=u1.id,
                event_type="add_fountain",
                points=10,
                status="awarded",
                dedup_key="lt1",
                location=point_geography(0.001, 0.001),
            ),
            ContributionEvent(
                user_id=u2.id,
                event_type="add_fountain",
                points=10,
                status="awarded",
                dedup_key="lt2",
                location=point_geography(0.001, 0.001),
            ),
            ContributionEvent(  # NULL location -> excluded by ST_DWithin despite 99 points
                user_id=u3.id,
                event_type="add_fountain",
                points=99,
                status="awarded",
                dedup_key="lt3",
                location=None,
            ),
        ]
    )
    await session.commit()
    rows = (
        await client.get("/api/v1/leaderboard/contributors?near_lat=0&near_lng=0&radius_m=5000")
    ).json()
    names = [r["display_name"] for r in rows]
    assert "LOC-3" not in names  # null-location excluded
    tied = sorted([u1, u2], key=lambda u: str(u.id))
    assert names == [tied[0].display_name, tied[1].display_name]  # tie -> user_id ASC


@pytest.mark.asyncio
async def test_leaderboard_validation(client):
    assert (await client.get("/api/v1/leaderboard/contributors?near_lat=1")).status_code == 422
    assert (await client.get("/api/v1/leaderboard/contributors?limit=101")).status_code == 422
    assert (
        await client.get("/api/v1/leaderboard/contributors?near_lat=1&near_lng=2&radius_m=-5")
    ).status_code == 422


@pytest.mark.asyncio
async def test_leaderboard_public_and_empty(settings_override):
    # Public (no auth) + empty DB -> [].
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        r = await ac.get("/api/v1/leaderboard/contributors")
    assert r.status_code == 200 and r.json() == []


@pytest.mark.asyncio
async def test_me_badges_caller_only(client, test_user, session):
    session.add(UserContributionStats(user_id=test_user.id, total_points=50, fountains_added=1))
    other = await _user(session, "badge-other")
    session.add(UserContributionStats(user_id=other.id, total_points=999, notes_count=99))
    await session.commit()
    app.dependency_overrides[get_current_user] = lambda: other
    try:
        keys = {b["key"] for b in (await client.get("/api/v1/me/badges")).json()}
    finally:
        app.dependency_overrides[get_current_user] = lambda: test_user
    assert "note_taker" in keys  # other's badges, not test_user's
