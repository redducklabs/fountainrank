import pytest
from httpx import ASGITransport, AsyncClient
from sqlalchemy import text

from app.auth import get_current_user, get_optional_user
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
_LB = "/api/v1/leaderboard/contributors"


async def _leaderboard(path, caller=None):
    """GET the leaderboard. When `caller` is given, override get_optional_user so the request is
    treated as that signed-in user (mirrors test_fountains_detail.py); else anonymous."""
    if caller is not None:
        app.dependency_overrides[get_optional_user] = lambda: caller
    try:
        transport = ASGITransport(app=app)
        async with AsyncClient(transport=transport, base_url="http://test") as ac:
            return await ac.get(path)
    finally:
        app.dependency_overrides.pop(get_optional_user, None)


def _near(*event_types_points, dedup_prefix, user_id, lat=0.001, lng=0.001, status="awarded"):
    return [
        ContributionEvent(
            user_id=user_id,
            event_type=et,
            points=pts,
            status=status,
            dedup_key=f"{dedup_prefix}{i}",
            location=point_geography(lat, lng),
        )
        for i, (et, pts) in enumerate(event_types_points)
    ]


@pytest.mark.asyncio
async def test_global_leaderboard_order_and_tie(session):
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
    body = (await _leaderboard(_LB)).json()
    rows = body["rows"]
    assert [r["points"] for r in rows] == [100, 100, 50]  # descending
    assert [r["rank"] for r in rows] == [1, 2, 3]  # ordinal 1-based
    assert all(r["category_count"] is None for r in rows)  # sort=total
    # The two 100-point users are tie-broken by user_id ASC (deterministic).
    tied = sorted([a, c], key=lambda u: str(u.id))
    assert [r["display_name"] for r in rows[:2]] == [tied[0].display_name, tied[1].display_name]
    assert rows[2]["display_name"] == b.display_name
    assert body["you"] is None  # anonymous


@pytest.mark.asyncio
async def test_global_leaderboard_excludes_zero_point_users(session):
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
    names = [r["display_name"] for r in (await _leaderboard(_LB)).json()["rows"]]
    assert keep.display_name in names
    assert zeroed.display_name not in names


@pytest.mark.asyncio
async def test_global_leaderboard_masks_subject(session):
    sub = "auth0|leak-sub"
    u = await _user(session, sub, display=sub)  # display_name == logto_user_id
    session.add(UserContributionStats(user_id=u.id, total_points=10))
    await session.commit()
    names = {r["display_name"] for r in (await _leaderboard(_LB)).json()["rows"]}
    assert sub not in names and "Anonymous" in names


@pytest.mark.asyncio
async def test_global_leaderboard_uses_nickname(session):
    # A user whose display_name fell back to the subject but who set a nickname shows the nickname,
    # never the subject or "Anonymous".
    sub = "auth0|nick-sub"
    u = await _user(session, sub, display=sub)  # would otherwise mask
    u.nickname = "Hydration Hero"
    session.add(UserContributionStats(user_id=u.id, total_points=10))
    await session.commit()
    names = {r["display_name"] for r in (await _leaderboard(_LB)).json()["rows"]}
    assert "Hydration Hero" in names
    assert sub not in names and "Anonymous" not in names


@pytest.mark.asyncio
async def test_global_category_leaderboard(session):
    a = await _user(session, "cat-a")
    b = await _user(session, "cat-b")
    c = await _user(session, "cat-c")
    session.add_all(
        [
            UserContributionStats(user_id=a.id, total_points=100, ratings_count=2, notes_count=5),
            UserContributionStats(user_id=b.id, total_points=20, ratings_count=9, notes_count=0),
            UserContributionStats(user_id=c.id, total_points=50, ratings_count=0, notes_count=3),
        ]
    )
    await session.commit()
    rows = (await _leaderboard(f"{_LB}?sort=ratings")).json()["rows"]
    # ordered by ratings_count desc: b(9), a(2). c has 0 ratings -> excluded.
    assert [r["display_name"] for r in rows] == [b.display_name, a.display_name]
    assert [r["category_count"] for r in rows] == [9, 2]
    assert [r["points"] for r in rows] == [20, 100]  # points = TOTAL points, not the category
    assert [r["rank"] for r in rows] == [1, 2]
    # A different (non-fountains) category orders independently: notes -> a(5), c(3); b excluded.
    rows2 = (await _leaderboard(f"{_LB}?sort=notes")).json()["rows"]
    assert [r["display_name"] for r in rows2] == [a.display_name, c.display_name]
    assert [r["category_count"] for r in rows2] == [5, 3]


@pytest.mark.asyncio
async def test_local_leaderboard(session):
    near = await _user(session, "lb-near")
    far = await _user(session, "lb-far")
    session.add_all(
        # near: an awarded add (counts) + a reversed rate (excluded); far: an awarded add (excluded)
        _near(("add_fountain", 10), dedup_prefix="ln-a", user_id=near.id)
        + _near(("rate", 2), dedup_prefix="ln-r", user_id=near.id, status="reversed")
        + _near(("add_fountain", 10), dedup_prefix="lf", user_id=far.id, lat=0.7, lng=0.7)
    )
    await session.commit()
    rows = (await _leaderboard(f"{_LB}?near_lat=0&near_lng=0&radius_m=5000")).json()["rows"]
    assert len(rows) == 1
    assert rows[0]["display_name"] == "LB-NEAR"
    assert rows[0]["points"] == 10  # reversed near event excluded; far excluded
    assert rows[0]["rank"] == 1
    assert rows[0]["category_count"] is None  # sort=total -> no category count


@pytest.mark.asyncio
async def test_local_leaderboard_tie_and_null_location(session):
    u1 = await _user(session, "loc-1")
    u2 = await _user(session, "loc-2")
    u3 = await _user(session, "loc-3")
    session.add_all(
        _near(("add_fountain", 10), dedup_prefix="lt1", user_id=u1.id)
        + _near(("add_fountain", 10), dedup_prefix="lt2", user_id=u2.id)
        + [  # NULL location -> excluded by ST_DWithin despite 99 points
            ContributionEvent(
                user_id=u3.id,
                event_type="add_fountain",
                points=99,
                status="awarded",
                dedup_key="lt3",
                location=None,
            )
        ]
    )
    await session.commit()
    names = [
        r["display_name"]
        for r in (await _leaderboard(f"{_LB}?near_lat=0&near_lng=0&radius_m=5000")).json()["rows"]
    ]
    assert "LOC-3" not in names  # null-location excluded
    tied = sorted([u1, u2], key=lambda u: str(u.id))
    assert names == [tied[0].display_name, tied[1].display_name]  # tie -> user_id ASC


@pytest.mark.asyncio
async def test_local_category_leaderboard(session):
    u = await _user(session, "lc-u")
    v = await _user(session, "lc-v")
    session.add_all(
        # u: 1 add + 2 rates near (2 ratings, total 14); v: 1 rate near + 1 rate far (1 near rating)
        _near(("add_fountain", 10), ("rate", 2), ("rate", 2), dedup_prefix="lcu", user_id=u.id)
        + _near(("rate", 2), dedup_prefix="lcv-near", user_id=v.id)
        + _near(("rate", 2), dedup_prefix="lcv-far", user_id=v.id, lat=0.7, lng=0.7)
    )
    await session.commit()
    rows = (await _leaderboard(f"{_LB}?near_lat=0&near_lng=0&radius_m=5000&sort=ratings")).json()[
        "rows"
    ]
    assert [r["display_name"] for r in rows] == [u.display_name, v.display_name]
    assert [r["category_count"] for r in rows] == [2, 1]  # near ratings only
    assert [r["points"] for r in rows] == [14, 2]  # total in-area points over ALL types


@pytest.mark.asyncio
async def test_local_category_tie_break(session):
    # Equal category_count must tie-break by user_id ASC, NOT by total points (Codex review-1).
    u1 = await _user(session, "tb-1")
    u2 = await _user(session, "tb-2")
    session.add_all(
        # both have exactly 1 near rating; u1 ALSO added a fountain (more total points)
        _near(("rate", 2), ("add_fountain", 10), dedup_prefix="tb1", user_id=u1.id)
        + _near(("rate", 2), dedup_prefix="tb2", user_id=u2.id)
    )
    await session.commit()
    rows = (await _leaderboard(f"{_LB}?near_lat=0&near_lng=0&radius_m=5000&sort=ratings")).json()[
        "rows"
    ]
    assert [r["category_count"] for r in rows] == [1, 1]
    tied = sorted([u1, u2], key=lambda u: str(u.id))
    assert [r["display_name"] for r in rows] == [tied[0].display_name, tied[1].display_name]


# ---- `you` (caller's own standing) ----
@pytest.mark.asyncio
async def test_leaderboard_you_in_top_n(session):
    a = await _user(session, "you-a")
    me = await _user(session, "you-me")
    session.add_all(
        [
            UserContributionStats(user_id=a.id, total_points=100),
            UserContributionStats(user_id=me.id, total_points=50),
        ]
    )
    await session.commit()
    body = (await _leaderboard(_LB, caller=me)).json()
    me_row = next(r for r in body["rows"] if r["display_name"] == me.display_name)
    assert me_row["is_you"] is True and me_row["rank"] == 2
    assert next(r for r in body["rows"] if r["display_name"] == a.display_name)["is_you"] is False
    assert body["you"]["rank"] == 2  # still returned; client pins only when no is_you row


@pytest.mark.asyncio
async def test_leaderboard_you_below_top_n(session):
    ahead = [await _user(session, f"bn-{i}") for i in range(3)]
    me = await _user(session, "bn-me")
    session.add_all(
        [
            UserContributionStats(user_id=u.id, total_points=p)
            for u, p in zip(ahead, [100, 90, 80], strict=True)
        ]
        + [UserContributionStats(user_id=me.id, total_points=10)]
    )
    await session.commit()
    body = (await _leaderboard(f"{_LB}?limit=2", caller=me)).json()
    assert len(body["rows"]) == 2  # only the top 2
    assert all(r["is_you"] is False for r in body["rows"])
    assert body["you"] == {"rank": 4, "points": 10, "category_count": None}


@pytest.mark.asyncio
async def test_leaderboard_you_unranked_in_category(session):
    other = await _user(session, "uc-other")
    me = await _user(session, "uc-me")
    session.add_all(
        [
            UserContributionStats(user_id=other.id, total_points=30, notes_count=3),
            UserContributionStats(user_id=me.id, total_points=20, ratings_count=10, notes_count=0),
        ]
    )
    await session.commit()
    body = (await _leaderboard(f"{_LB}?sort=notes", caller=me)).json()
    assert all(r["display_name"] != me.display_name for r in body["rows"])  # 0 notes -> off board
    # unranked in this category, but points/category_count still reflect reality
    assert body["you"] == {"rank": None, "points": 20, "category_count": 0}


@pytest.mark.asyncio
async def test_leaderboard_you_total_unranked(session):
    keep = await _user(session, "tu-keep")
    me = await _user(session, "tu-me")
    session.add_all(
        [
            UserContributionStats(user_id=keep.id, total_points=10),
            UserContributionStats(user_id=me.id, total_points=0),  # all reversed
        ]
    )
    await session.commit()
    body = (await _leaderboard(_LB, caller=me)).json()
    assert all(r["display_name"] != me.display_name for r in body["rows"])
    assert body["you"] == {"rank": None, "points": 0, "category_count": None}


@pytest.mark.asyncio
async def test_leaderboard_zero_metric_not_counted_ahead(session):
    # A zero-metric user must never be counted ahead of a ranked caller (the metric_col>0 guard).
    me = await _user(session, "zm-me")
    zero = await _user(session, "zm-zero")
    session.add_all(
        [
            UserContributionStats(user_id=me.id, total_points=10),
            UserContributionStats(user_id=zero.id, total_points=0),
        ]
    )
    await session.commit()
    body = (await _leaderboard(_LB, caller=me)).json()
    assert body["you"]["rank"] == 1
    assert [r["display_name"] for r in body["rows"]] == [me.display_name]


@pytest.mark.asyncio
async def test_leaderboard_local_you_below_cut(session):
    # Local `you` derives from the SAME in-area scan and is rankable even below the limit.
    others = [await _user(session, f"lyb-{i}") for i in range(3)]
    me = await _user(session, "lyb-me")
    events = []
    for u, n in zip(others, [3, 2, 2], strict=True):  # 3, 2, 2 near adds
        events += _near(
            *[("add_fountain", 10)] * n, dedup_prefix=f"lyb{u.display_name}", user_id=u.id
        )
    events += _near(("add_fountain", 10), dedup_prefix="lybme", user_id=me.id)  # 1 add -> last
    session.add_all(events)
    await session.commit()
    body = (
        await _leaderboard(f"{_LB}?near_lat=0&near_lng=0&radius_m=5000&limit=2", caller=me)
    ).json()
    assert len(body["rows"]) == 2
    assert all(r["is_you"] is False for r in body["rows"])
    assert body["you"]["rank"] == 4 and body["you"]["points"] == 10


# ---- security: optional-auth must still 401 an invalid bearer ----
@pytest.mark.asyncio
async def test_leaderboard_invalid_bearer_401(settings_override):
    settings_override(dev_auth_enabled=True)
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        # present-but-invalid bearer -> hard 401 even with the dev seam enabled + X-Dev-User present
        r1 = await ac.get(
            _LB, headers={"Authorization": "Bearer not-a-jwt", "X-Dev-User": "logto-x"}
        )
        # non-Bearer scheme -> 401
        r2 = await ac.get(_LB, headers={"Authorization": "Basic abc"})
    assert r1.status_code == 401
    assert r2.status_code == 401


# ---- guardrail: the category map must stay consistent with the contribution counters ----
def test_leaderboard_category_map_guardrail():
    from app.contributions import _STAT_COUNTER, POINTS
    from app.routers.leaderboard import _CATEGORY

    for key, (col, etype) in _CATEGORY.items():
        assert etype in _STAT_COUNTER, f"{key}: {etype!r} is not a counter event type"
        assert _STAT_COUNTER[etype] == col.key, f"{key}: counter column mismatch ({col.key})"
        assert POINTS[etype] > 0, (
            f"{key}: POINTS[{etype!r}] must be positive for count==points-order"
        )


# ---- validation + empty shape ----
@pytest.mark.asyncio
async def test_leaderboard_validation(session):
    assert (await _leaderboard(f"{_LB}?near_lat=1")).status_code == 422  # unpaired
    assert (await _leaderboard(f"{_LB}?limit=101")).status_code == 422
    assert (await _leaderboard(f"{_LB}?near_lat=1&near_lng=2&radius_m=-5")).status_code == 422
    assert (await _leaderboard(f"{_LB}?sort=bogus")).status_code == 422  # unknown sort


@pytest.mark.asyncio
async def test_leaderboard_anonymous_and_empty(session):
    # Anonymous + empty DB -> exactly {"rows": [], "you": null}.
    r = await _leaderboard(_LB)
    assert r.status_code == 200 and r.json() == {"rows": [], "you": None}


@pytest.mark.asyncio
async def test_leaderboard_signed_in_empty(session):
    me = await _user(session, "se-me")
    await session.commit()
    body = (await _leaderboard(_LB, caller=me)).json()
    assert body == {"rows": [], "you": {"rank": None, "points": 0, "category_count": None}}


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
