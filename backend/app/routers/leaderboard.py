import logging
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, Query, Response, status
from sqlalchemy import and_, func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import InstrumentedAttribute

from app.auth import get_optional_user
from app.config import Settings, get_settings
from app.db import get_session
from app.display import public_display_name
from app.geo import point_geography
from app.models import ContributionEvent, User, UserContributionStats
from app.schemas import ContributorRow, LeaderboardOut, YourStanding

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/v1", tags=["leaderboard"])

# The selectable sort: `total` (default) plus the six *major* point-origination categories.
# Bonus events (first_fountain_bonus / first_in_area_bonus / first_rating_bonus) are never
# selectable — they still count toward `total` points.
LeaderboardSort = Literal[
    "total", "fountains", "ratings", "verifications", "conditions", "attributes", "notes"
]

# Each category sort -> (the denormalized UserContributionStats counter, the ContributionEvent
# event_type). The global board ranks on the counter; the local board counts the event_type.
# A guardrail test (test_gamification_api) asserts each event_type is a real _STAT_COUNTER key
# whose counter column matches, with POINTS[event_type] > 0 — locking the design's assumption
# that, for these categories, ranking by count equals ranking by points (spec §4).
_CATEGORY: dict[str, tuple[InstrumentedAttribute, str]] = {
    "fountains": (UserContributionStats.fountains_added, "add_fountain"),
    "ratings": (UserContributionStats.ratings_count, "rate"),
    "verifications": (UserContributionStats.verifications_count, "verify_working"),
    "conditions": (UserContributionStats.conditions_reported, "report_condition"),
    "attributes": (UserContributionStats.attributes_count, "observe_attribute"),
    "notes": (UserContributionStats.notes_count, "add_note"),
}


@router.get("/leaderboard/contributors", response_model=LeaderboardOut)
async def contributors(
    response: Response,
    limit: int = Query(default=20, ge=1, le=100),
    near_lat: float | None = Query(default=None, ge=-90.0, le=90.0),
    near_lng: float | None = Query(default=None, ge=-180.0, le=180.0),
    radius_m: float | None = Query(default=None, gt=0.0),
    sort: LeaderboardSort = Query(default="total"),
    user: User | None = Depends(get_optional_user),
    session: AsyncSession = Depends(get_session),
    settings: Settings = Depends(get_settings),
) -> LeaderboardOut:
    """Top contributors — global by total points (or a category counter), or local (in-area) when
    near_lat+near_lng are given. Public; author names go through public_display_name (never the raw
    subject). When the caller is signed in (get_optional_user), `you` carries their own standing —
    an invalid bearer is still a hard 401, never silently downgraded to anonymous (#117)."""
    # Viewer-dependent (`rows[].is_you` and `you` both vary per caller) even though the endpoint
    # stays PUBLIC — so it must never be shared-cached. A CDN/proxy storing one signed-in viewer's
    # board and serving it to another would leak their standing and mis-mark their row as "you".
    # Same hazard, same fix as GET /fountains/{id} and list_photos.
    response.headers["Cache-Control"] = "private, no-store"
    if (near_lat is None) != (near_lng is None):
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail="near_lat and near_lng must be provided together",
        )

    is_local = near_lat is not None and near_lng is not None
    if is_local:
        result = await _local_board(
            session, settings, near_lat, near_lng, radius_m, sort, limit, user
        )
    else:
        result = await _global_board(session, sort, limit, user)

    logger.info(
        "leaderboard served",
        extra={
            "scope": "local" if is_local else "global",
            "sort": sort,
            "limit": limit,
            "rows": len(result.rows),
            "you_resolved": result.you is not None,
        },
    )
    return result


# --- global board (denormalized UserContributionStats) -----------------------------------------
async def _global_board(
    session: AsyncSession, sort: LeaderboardSort, limit: int, user: User | None
) -> LeaderboardOut:
    metric_col = UserContributionStats.total_points if sort == "total" else _CATEGORY[sort][0]

    db_rows = (
        await session.execute(
            select(
                User.id,
                User.display_name,
                User.logto_user_id,
                User.nickname,
                UserContributionStats.total_points,
                metric_col.label("metric"),
            )
            .select_from(UserContributionStats)
            .join(User, User.id == UserContributionStats.user_id)
            # Exclude zero-metric users so a fully-reversed contributor (#119) — or anyone with no
            # contribution in the selected category — drops off the board entirely.
            .where(metric_col > 0)
            .order_by(metric_col.desc(), User.id.asc())
            .limit(limit)
        )
    ).all()

    rows = [
        ContributorRow(
            rank=i,
            display_name=public_display_name(r.display_name, r.logto_user_id, r.nickname),
            points=r.total_points,
            category_count=(None if sort == "total" else r.metric),
            is_you=user is not None and r.id == user.id,
        )
        for i, r in enumerate(db_rows, start=1)
    ]

    you = await _global_you(session, sort, metric_col, user) if user is not None else None
    return LeaderboardOut(rows=rows, you=you)


async def _global_you(
    session: AsyncSession, sort: LeaderboardSort, metric_col: InstrumentedAttribute, user: User
) -> YourStanding:
    stats = (
        await session.execute(
            select(UserContributionStats.total_points, metric_col.label("metric")).where(
                UserContributionStats.user_id == user.id
            )
        )
    ).first()
    total_points = stats.total_points if stats else 0
    mine = stats.metric if stats else 0
    category_count = None if sort == "total" else mine

    if mine <= 0:  # unranked: never count zero-metric users (incl. smaller user_id) ahead.
        return YourStanding(rank=None, points=total_points, category_count=category_count)

    # ordinal position = (# users strictly ahead in the metric DESC, user_id ASC order) + 1.
    ahead = (
        await session.execute(
            select(func.count())
            .select_from(UserContributionStats)
            .where(
                metric_col > 0,
                or_(
                    metric_col > mine,
                    and_(metric_col == mine, UserContributionStats.user_id < user.id),
                ),
            )
        )
    ).scalar_one()
    return YourStanding(rank=ahead + 1, points=total_points, category_count=category_count)


# --- local board (in-area scan over contribution_events) ---------------------------------------
async def _local_board(
    session: AsyncSession,
    settings: Settings,
    near_lat: float,
    near_lng: float,
    radius_m: float | None,
    sort: LeaderboardSort,
    limit: int,
    user: User | None,
) -> LeaderboardOut:
    radius = min(radius_m or settings.leaderboard_local_radius_m, settings.nearby_max_radius_m)
    point = point_geography(near_lat, near_lng)
    is_category = sort != "total"

    # base: every in-area contributor, ONE ST_DWithin scan. points = total over ALL awarded types
    # (so the secondary number is defined even for a caller who is unranked in a category).
    base_cols = [
        ContributionEvent.user_id.label("user_id"),
        func.coalesce(func.sum(ContributionEvent.points), 0).label("points"),
    ]
    if is_category:
        etype = _CATEGORY[sort][1]
        base_cols.append(
            func.count().filter(ContributionEvent.event_type == etype).label("category_count")
        )
    base = (
        select(*base_cols)
        .where(
            ContributionEvent.status == "awarded",
            func.ST_DWithin(ContributionEvent.location, point, radius),
        )
        .group_by(ContributionEvent.user_id)
        .cte("base")
    )

    active_metric = base.c.category_count if is_category else base.c.points
    # ranked: only users with a positive ACTIVE metric get a rank (ordinal row number).
    ranked = (
        select(
            base.c.user_id.label("user_id"),
            func.row_number()
            .over(order_by=(active_metric.desc(), base.c.user_id.asc()))
            .label("rn"),
        )
        .where(active_metric > 0)
        .cte("ranked")
    )

    # ONE statement: top-N ranked rows PLUS (for a signed-in caller) their own base row — even if
    # unranked (rn null) — via the OR. A single statement => one consistent snapshot, no race.
    visible = ranked.c.rn <= limit
    where_clause = or_(visible, base.c.user_id == user.id) if user is not None else visible
    select_cols = [
        base.c.user_id,
        base.c.points,
        ranked.c.rn,
        User.display_name,
        User.logto_user_id,
        User.nickname,
    ]
    if is_category:
        select_cols.append(base.c.category_count)
    db_rows = (
        await session.execute(
            select(*select_cols)
            .select_from(base)
            .join(ranked, ranked.c.user_id == base.c.user_id, isouter=True)
            .join(User, User.id == base.c.user_id)
            .where(where_clause)
        )
    ).all()

    in_list = sorted((r for r in db_rows if r.rn is not None and r.rn <= limit), key=lambda r: r.rn)
    rows = [
        ContributorRow(
            rank=r.rn,
            display_name=public_display_name(r.display_name, r.logto_user_id, r.nickname),
            points=int(r.points),
            category_count=(int(r.category_count) if is_category else None),
            is_you=user is not None and r.user_id == user.id,
        )
        for r in in_list
    ]

    you: YourStanding | None = None
    if user is not None:
        caller = next((r for r in db_rows if r.user_id == user.id), None)
        if caller is not None:
            you = YourStanding(
                rank=caller.rn,  # None when the caller is unranked (zero active metric)
                points=int(caller.points),
                category_count=(int(caller.category_count) if is_category else None),
            )
        else:  # signed in but no in-area events at all
            you = YourStanding(rank=None, points=0, category_count=(0 if is_category else None))
    return LeaderboardOut(rows=rows, you=you)
