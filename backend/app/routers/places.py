"""Public, crawlable place lists for the SEO pages (#127, spec §5).

``GET /api/v1/places`` returns the canonical countries (no ``country`` param) or a country's
cities (``country=<iso2>``), each with the precomputed non-hidden ``fountain_count``. The read
path reads only the precomputed membership columns on ``place_boundaries`` — it NEVER runs a live
``ST_Covers`` (spec §5, the mandatory scale rule). Unauthenticated and cache-friendly.
"""

import logging

from fastapi import APIRouter, Depends, HTTPException, Query, Response, status
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import Settings, get_settings
from app.db import get_session
from app.geo import latitude_of, longitude_of
from app.models import Fountain, FountainPhoto, PlaceBoundary, PlaceScopeConfig
from app.schemas import CityFountainPin, CityFountainsOut, Coordinates, PlaceOut

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/v1", tags=["places"])


def _set_cache(response: Response, settings: Settings) -> None:
    ttl = settings.seo_cache_max_age_seconds
    response.headers["Cache-Control"] = f"public, max-age={ttl}, s-maxage={ttl}"


async def _scope_city_routes_ready(session: AsyncSession, country_code: str) -> bool:
    """Whether this scope's CITY routes are signed off as ready (spec §4.2/§7). A missing
    place_scope_config row (or city_routes_ready=false) means NOT ready — the safe default that
    keeps a new scope's city routes out of the index/sitemap until an owner signs off in a
    migration."""
    return bool(
        await session.scalar(
            select(PlaceScopeConfig.city_routes_ready).where(
                PlaceScopeConfig.country_code == country_code
            )
        )
    )


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
    order_by = (
        PlaceBoundary.fountain_count.desc(),
        PlaceBoundary.name.asc(),
        PlaceBoundary.id.asc(),
    )

    if country is None:
        # Countries are keyed by country_code (the URL segment) and the loader keeps exactly one
        # `class='land'` row per code. They are NEVER is_canonical: that flag disambiguates same
        # (country_code, slug) *city* rows only (see app/membership.py — "only city-eligible places
        # are ever canonical"). So do NOT filter countries on is_canonical, or this returns nothing
        # for a normally-loaded scope (US/LU are non-canonical countries).
        stmt = (
            select(PlaceBoundary)
            .where(
                PlaceBoundary.subtype == "country",
                PlaceBoundary.fountain_count >= min_count,
            )
            .order_by(*order_by)
            .limit(limit)
            .offset(offset)
        )
        scope = "countries"
        country_code = None
    else:
        country_code = country.lower()
        # Resolve the country row by code (one per code from the loader; overture_id gives a
        # deterministic pick if that invariant is ever violated). A country not loaded yields no
        # cities — the country page 404s on its own (web notFound()).
        parent_id = (
            await session.execute(
                select(PlaceBoundary.id)
                .where(
                    PlaceBoundary.subtype == "country",
                    PlaceBoundary.country_code == country_code,
                )
                .order_by(PlaceBoundary.overture_id.asc())
                .limit(1)
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
        if not await _scope_city_routes_ready(session, country_code):
            _set_cache(response, settings)
            logger.info(
                "places served",
                extra={"scope": "cities", "country": country_code, "rows": 0, "scope_ready": False},
            )
            return []
        # Cities ARE is_canonical: canonicalization keeps exactly one row per (country_code, slug)
        # among city-eligible subtypes, which is what owns the /[country]/[city] URL — so the flag
        # is correct and required here to collapse slug collisions.
        stmt = (
            select(PlaceBoundary)
            .where(
                PlaceBoundary.parent_id == parent_id,
                PlaceBoundary.subtype != "country",
                PlaceBoundary.is_canonical.is_(True),
                PlaceBoundary.fountain_count >= min_count,
            )
            .order_by(*order_by)
            .limit(limit)
            .offset(offset)
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


@router.get("/places/{country}/{city}/fountains", response_model=CityFountainsOut)
async def city_fountains(
    response: Response,
    country: str,
    city: str,
    limit: int = Query(default=100, ge=1, le=500),
    offset: int = Query(default=0, ge=0),
    session: AsyncSession = Depends(get_session),
    settings: Settings = Depends(get_settings),
) -> CityFountainsOut:
    """The canonical city for /[country]/[city] plus its ranked, paginated fountains (spec §4.3/§5).

    Resolves the canonical place owning ``(country_code, slug)`` (both matched lowercased — slugs
    are stored lowercased), then returns its NON-HIDDEN fountains best-rated first (Bayesian
    ``ranking_score`` DESC, unrated last). Reads the precomputed ``city_place_id`` membership, not a
    live ST_Covers (spec §5). Public + cacheable. 404 when no canonical city matches, so the page
    can ``notFound()``.
    """
    cc = country.lower()
    slug = city.lower()
    place = (
        await session.execute(
            select(PlaceBoundary).where(
                PlaceBoundary.country_code == cc,
                PlaceBoundary.slug == slug,
                PlaceBoundary.is_canonical.is_(True),
                PlaceBoundary.subtype != "country",
            )
        )
    ).scalar_one_or_none()
    if place is None:
        _set_cache(response, settings)
        logger.info("city fountains: no canonical city", extra={"country": cc, "slug": slug})
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="No such city")

    # Correlated scalar subqueries: the newest visible photo's id (for the thumbnail URL) and the
    # visible-photo count. Both return exactly one value per Fountain row, so they don't change the
    # page's row count, order, or pagination — they're just extra columns on the same select.
    thumb_id_sq = (
        select(FountainPhoto.id)
        .where(FountainPhoto.fountain_id == Fountain.id, FountainPhoto.is_hidden.is_(False))
        .order_by(FountainPhoto.created_at.desc())
        .limit(1)
        .correlate(Fountain)
        .scalar_subquery()
    )
    photo_count_sq = (
        select(func.count())
        .select_from(FountainPhoto)
        .where(FountainPhoto.fountain_id == Fountain.id, FountainPhoto.is_hidden.is_(False))
        .correlate(Fountain)
        .scalar_subquery()
    )

    rows = (
        await session.execute(
            select(
                Fountain.id,
                latitude_of(Fountain.location),
                longitude_of(Fountain.location),
                Fountain.is_working,
                Fountain.average_rating,
                Fountain.rating_count,
                Fountain.ranking_score,
                Fountain.current_status,
                Fountain.last_verified_at,
                thumb_id_sq.label("thumb_id"),
                photo_count_sq.label("photo_count"),
            )
            .where(Fountain.city_place_id == place.id, Fountain.is_hidden.is_(False))
            # Best-rated first: Bayesian ranking_score desc, unrated (NULL) last; then more-rated,
            # then id for a stable, deterministic page across offsets.
            .order_by(
                Fountain.ranking_score.desc().nulls_last(),
                Fountain.rating_count.desc(),
                Fountain.id.asc(),
            )
            .limit(limit)
            .offset(offset)
        )
    ).all()
    fountains = [
        CityFountainPin(
            id=row.id,
            location=Coordinates(latitude=float(row[1]), longitude=float(row[2])),
            is_working=row.is_working,
            average_rating=row.average_rating,
            rating_count=row.rating_count,
            ranking_score=row.ranking_score,
            current_status=row.current_status,
            last_verified_at=row.last_verified_at,
            photo_count=row.photo_count,
            thumbnail_url=(f"/api/v1/photos/{row.thumb_id}/thumb" if row.thumb_id else None),
        )
        for row in rows
    ]
    indexable = place.fountain_count >= settings.seo_place_min_fountains and (
        await _scope_city_routes_ready(session, cc)
    )
    _set_cache(response, settings)
    logger.info(
        "city fountains served",
        extra={
            "country": cc,
            "slug": slug,
            "place_id": str(place.id),
            "rows": len(fountains),
            "indexable": indexable,
            "limit": limit,
            "offset": offset,
        },
    )
    return CityFountainsOut(
        place=PlaceOut.model_validate(place), fountains=fountains, indexable=indexable
    )
