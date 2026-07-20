"""Public site-wide stats for the homepage positioning copy.

``GET /api/v1/stats`` returns the two headline numbers the homepage renders dynamically: the total
non-hidden fountain count and the number of countries with fountains. Read directly (a live count of
the fountains table for the total, the precomputed ``fountain_count`` on country places for the
country set) — cheap, cacheable, and unauthenticated. Rendering these live keeps the positioning
copy ("Browse N+ fountains across C countries") honest as the dataset grows, not a hardcoded claim.
"""

import logging

from fastapi import APIRouter, Depends, Response
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import Settings, get_settings
from app.db import get_session
from app.models import Fountain, PlaceBoundary
from app.schemas import SiteStatsOut

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/v1", tags=["stats"])


@router.get("/stats", response_model=SiteStatsOut)
async def site_stats(
    response: Response,
    session: AsyncSession = Depends(get_session),
    settings: Settings = Depends(get_settings),
) -> SiteStatsOut:
    """Site-wide public counts for the homepage positioning copy.

    ``total_fountains`` counts every non-hidden fountain (the honest "N+ fountains" headline — a
    live count, not a sum of per-place ``fountain_count``, which would miss fountains outside any
    place). ``total_countries`` counts the country places with at least one non-hidden fountain (the
    same set the browse hub lists). Unauthenticated + cacheable; no live ST_Covers.
    """
    total_fountains = (
        await session.execute(
            select(func.count()).select_from(Fountain).where(Fountain.is_hidden.is_(False))
        )
    ).scalar_one()
    total_countries = (
        await session.execute(
            select(func.count())
            .select_from(PlaceBoundary)
            .where(PlaceBoundary.place_kind == "country", PlaceBoundary.fountain_count > 0)
        )
    ).scalar_one()
    ttl = settings.seo_cache_max_age_seconds
    response.headers["Cache-Control"] = f"public, max-age={ttl}, s-maxage={ttl}"
    logger.info(
        "site stats served",
        extra={"total_fountains": total_fountains, "total_countries": total_countries},
    )
    return SiteStatsOut(total_fountains=total_fountains, total_countries=total_countries)
