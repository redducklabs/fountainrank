"""Public, crawlable place lists for the SEO pages (#127, spec §5).

``GET /api/v1/places`` returns the canonical countries (no ``country`` param) or a country's
cities (``country=<iso2>``), each with the precomputed non-hidden ``fountain_count``. The read
path reads only the precomputed membership columns on ``place_boundaries`` — it NEVER runs a live
``ST_Covers`` (spec §5, the mandatory scale rule). Unauthenticated and cache-friendly.
"""

import logging

from fastapi import APIRouter, Depends, Query, Response
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import Settings, get_settings
from app.db import get_session
from app.models import PlaceBoundary
from app.schemas import PlaceOut

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/v1", tags=["places"])


def _set_cache(response: Response, settings: Settings) -> None:
    ttl = settings.seo_cache_max_age_seconds
    response.headers["Cache-Control"] = f"public, max-age={ttl}, s-maxage={ttl}"


@router.get("/places", response_model=list[PlaceOut])
async def list_places(
    response: Response,
    country: str | None = Query(
        default=None,
        min_length=2,
        max_length=2,
        description=(
            "ISO-3166-1 alpha-2 country code. Omit to list countries; provide it to list that "
            "country's cities (its canonical child places)."
        ),
    ),
    limit: int = Query(default=200, ge=1, le=1000),
    offset: int = Query(default=0, ge=0),
    session: AsyncSession = Depends(get_session),
    settings: Settings = Depends(get_settings),
) -> list[PlaceOut]:
    """List crawlable places, most-populous first.

    Countries when ``country`` is omitted; the cities of ``country`` otherwise. Only **canonical**
    places (one per ``(country_code, slug)``) with ``fountain_count >= seo_place_min_fountains``
    are returned — the thin-content gate (spec §7). Hidden fountains are already excluded from
    ``fountain_count`` (denormalized at membership refresh), so no per-row hidden filter is needed
    here. Bounded by ``limit``/``offset`` and served with a public ``Cache-Control`` (both in the
    contract, not just tests).
    """
    min_count = settings.seo_place_min_fountains
    stmt = (
        select(PlaceBoundary)
        .where(
            PlaceBoundary.is_canonical.is_(True),
            PlaceBoundary.fountain_count >= min_count,
        )
        .order_by(
            PlaceBoundary.fountain_count.desc(),
            PlaceBoundary.name.asc(),
            PlaceBoundary.id.asc(),
        )
        .limit(limit)
        .offset(offset)
    )

    if country is None:
        stmt = stmt.where(PlaceBoundary.subtype == "country")
        scope = "countries"
        country_code = None
    else:
        country_code = country.lower()
        # Resolve the canonical country row, then return its children. A country below the gate
        # (or not loaded) yields no cities — the country page 404s on its own (web notFound()).
        parent_id = (
            await session.execute(
                select(PlaceBoundary.id).where(
                    PlaceBoundary.subtype == "country",
                    PlaceBoundary.country_code == country_code,
                    PlaceBoundary.is_canonical.is_(True),
                )
            )
        ).scalar_one_or_none()
        if parent_id is None:
            _set_cache(response, settings)
            logger.info(
                "places served",
                extra={
                    "scope": "cities",
                    "country": country_code,
                    "rows": 0,
                    "country_found": False,
                },
            )
            return []
        stmt = stmt.where(
            PlaceBoundary.parent_id == parent_id,
            PlaceBoundary.subtype != "country",
        )
        scope = "cities"

    rows = (await session.execute(stmt)).scalars().all()
    _set_cache(response, settings)
    logger.info(
        "places served",
        extra={
            "scope": scope,
            "country": country_code,
            "rows": len(rows),
            "limit": limit,
            "offset": offset,
        },
    )
    return [PlaceOut.model_validate(row) for row in rows]
