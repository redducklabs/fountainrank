from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import Settings, get_settings
from app.db import get_session
from app.display import public_display_name
from app.geo import point_geography
from app.models import ContributionEvent, User, UserContributionStats
from app.schemas import ContributorRow

router = APIRouter(prefix="/api/v1", tags=["leaderboard"])


@router.get("/leaderboard/contributors", response_model=list[ContributorRow])
async def contributors(
    limit: int = Query(default=20, ge=1, le=100),
    near_lat: float | None = Query(default=None, ge=-90.0, le=90.0),
    near_lng: float | None = Query(default=None, ge=-180.0, le=180.0),
    radius_m: float | None = Query(default=None, gt=0.0),
    session: AsyncSession = Depends(get_session),
    settings: Settings = Depends(get_settings),
) -> list[ContributorRow]:
    """Top contributors — global by total points, or local (in-area) when near_lat+near_lng
    are given. Public; author names go through public_display_name (never the raw subject)."""
    if (near_lat is None) != (near_lng is None):
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail="near_lat and near_lng must be provided together",
        )

    if near_lat is not None and near_lng is not None:
        radius = min(radius_m or settings.leaderboard_local_radius_m, settings.nearby_max_radius_m)
        point = point_geography(near_lat, near_lng)
        points = func.coalesce(func.sum(ContributionEvent.points), 0).label("points")
        rows = (
            await session.execute(
                select(User.display_name, User.logto_user_id, points)
                .select_from(ContributionEvent)
                .join(User, User.id == ContributionEvent.user_id)
                .where(
                    ContributionEvent.status == "awarded",
                    func.ST_DWithin(ContributionEvent.location, point, radius),
                )
                .group_by(User.id, User.display_name, User.logto_user_id)
                .order_by(points.desc(), User.id.asc())
                .limit(limit)
            )
        ).all()
        return [
            ContributorRow(
                display_name=public_display_name(r.display_name, r.logto_user_id),
                points=int(r.points),
            )
            for r in rows
        ]

    rows = (
        await session.execute(
            select(
                User.display_name,
                User.logto_user_id,
                UserContributionStats.total_points,
                UserContributionStats.fountains_added,
                UserContributionStats.ratings_count,
            )
            .select_from(UserContributionStats)
            .join(User, User.id == UserContributionStats.user_id)
            # Exclude zero-point users so a contributor whose points were all reversed
            # (e.g. after a moderated hard-delete, #119) drops off the board entirely.
            .where(UserContributionStats.total_points > 0)
            .order_by(UserContributionStats.total_points.desc(), User.id.asc())
            .limit(limit)
        )
    ).all()
    return [
        ContributorRow(
            display_name=public_display_name(r.display_name, r.logto_user_id),
            points=r.total_points,
            fountains_added=r.fountains_added,
            ratings_count=r.ratings_count,
        )
        for r in rows
    ]
