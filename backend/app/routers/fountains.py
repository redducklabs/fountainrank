import logging
import uuid
from datetime import UTC, datetime

from fastapi import APIRouter, Depends, HTTPException, Query, Response, status
from fastapi.responses import JSONResponse
from geoalchemy2 import Geography, Geometry
from sqlalchemy import cast, func, select
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth import get_current_user, get_optional_user, require_named_user
from app.conditions import recompute_fountain_status
from app.config import Settings, get_settings
from app.consensus import recompute_attribute_consensus
from app.contributions import (
    ContributionSpec,
    condition_points_eligible_at,
    dk_add_fountain,
    dk_condition_award,
    dk_first_fountain,
    dk_first_in_area,
    dk_first_rating,
    dk_note,
    dk_observe_attr,
    dk_rate,
    latest_awarded_condition_at,
    points_for,
    record_contributions,
)
from app.db import get_session
from app.display import public_display_name
from app.filters import (
    SEO_ATTRIBUTE_FILTERS,
    DiscoveryFilters,
    SeoAttribute,
    apply_discovery_filters,
    attribute_consensus_match,
    discovery_filters,
    fountain_indexable_predicate,
)
from app.geo import latitude_of, longitude_of, point_geography
from app.locks import ADD_FOUNTAIN_LOCK_KEY
from app.membership import recompute_fountain_membership
from app.models import (
    AttributeObservation,
    AttributeType,
    ConditionReport,
    Fountain,
    FountainAttributeConsensus,
    FountainNote,
    PlaceBoundary,
    Rating,
    RatingType,
    User,
)
from app.ranking import recompute_fountain_ranking
from app.reports import create_content_report
from app.schemas import (
    AddFountainRequest,
    AddNoteRequest,
    AttributeConsensusOut,
    AttributeFountainsOut,
    ConditionReportRequest,
    Coordinates,
    DimensionSummary,
    DisplayNameRequiredConflict,
    DuplicateFountainConflict,
    FountainDetail,
    FountainPin,
    FountainPlaceOut,
    FountainSitemapOut,
    NoteOut,
    ObserveAttributesRequest,
    PlaceOut,
    RateRequest,
    RatingInput,
    ReportContentRequest,
)

router = APIRouter(prefix="/api/v1", tags=["fountains"])
logger = logging.getLogger(__name__)
TRUNCATED_HEADER = "X-FountainRank-Truncated"


async def _validate_rating_types(session: AsyncSession, ratings: list[RatingInput]) -> None:
    if not ratings:
        return
    ids = {r.rating_type_id for r in ratings}
    # Only fountain-scoped dimensions are valid on a fountain (place_type scoping, #44):
    # a restroom rating_type can't be applied here and is treated as unknown.
    known = set(
        (
            await session.execute(
                select(RatingType.id).where(
                    RatingType.id.in_(ids), RatingType.place_type == "fountain"
                )
            )
        )
        .scalars()
        .all()
    )
    unknown = ids - known
    if unknown:
        logger.warning("rejected unknown/non-fountain rating_type_id(s): %s", sorted(unknown))
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail=f"unknown rating_type_id(s): {sorted(unknown)}",
        )


async def _upsert_ratings(
    session: AsyncSession, *, fountain_id: uuid.UUID, user_id: uuid.UUID, ratings: list[RatingInput]
) -> dict[int, uuid.UUID]:
    # Atomic upsert via ON CONFLICT on the (fountain_id, user_id, rating_type_id) unique
    # constraint. A SELECT-then-INSERT would race two concurrent submissions for the same
    # user/fountain/dimension (both see no row, both INSERT) -> one hits IntegrityError ->
    # a 500. ON CONFLICT DO UPDATE makes the create-or-edit atomic. Dedupe within the
    # request (last value wins) so a single statement never touches the same conflict key
    # twice — Postgres rejects "ON CONFLICT ... cannot affect row a second time".
    stars_by_type = {r.rating_type_id: r.stars for r in ratings}
    if not stars_by_type:
        return {}
    stmt = pg_insert(Rating).values(
        [
            {
                "id": uuid.uuid4(),
                "fountain_id": fountain_id,
                "user_id": user_id,
                "rating_type_id": rating_type_id,
                "stars": stars,
            }
            for rating_type_id, stars in stars_by_type.items()
        ]
    )
    # RETURNING (rating_type_id, id) gives the durable contribution target_id for each
    # affected row (DO UPDATE returns the conflict row too), so a `rate` event can link
    # to the exact ratings row for future confirmation/moderation.
    stmt = stmt.on_conflict_do_update(
        index_elements=["fountain_id", "user_id", "rating_type_id"],
        set_={"stars": stmt.excluded.stars, "updated_at": func.now()},
    ).returning(Rating.rating_type_id, Rating.id)
    result = await session.execute(stmt)
    rating_ids = {row.rating_type_id: row.id for row in result}
    await session.flush()
    return rating_ids


def _rating_contribution_specs(
    *,
    user_id: uuid.UUID,
    fountain_id: uuid.UUID,
    location: object,
    rating_ids: dict[int, uuid.UUID],
) -> list[ContributionSpec]:
    """Build `rate` (one per dimension) + a `first_rating_bonus` spec. Dedup keys make
    re-rates/bonus idempotent in the chokepoint — no first-detection query needed."""
    specs = [
        ContributionSpec(
            user_id=user_id,
            event_type="rate",
            dedup_key=dk_rate(user_id, fountain_id, rating_type_id),
            fountain_id=fountain_id,
            location=location,
            target_type="rating",
            target_id=rating_id,
            event_metadata={"rating_type_id": rating_type_id},
        )
        for rating_type_id, rating_id in rating_ids.items()
    ]
    if rating_ids:
        specs.append(
            ContributionSpec(
                user_id=user_id,
                event_type="first_rating_bonus",
                dedup_key=dk_first_rating(fountain_id),
                fountain_id=fountain_id,
                location=location,
            )
        )
    return specs


def _value_is_legal(value_kind: str, allowed_values: list[str] | None, value: str) -> bool:
    if value == "unknown":  # unknown is always a legal observation
        return True
    if value_kind == "boolean":
        return value in ("yes", "no")
    return bool(allowed_values) and value in allowed_values  # enum


async def _validate_attribute_observations(
    session: AsyncSession, observations: list
) -> dict[int, object]:
    """Validate attribute_type ids (fountain-scoped, active) + value legality. 422 on bad input."""
    ids = {o.attribute_type_id for o in observations}
    # smallint-range guard: out-of-range ids cannot exist (the column is smallint) and
    # would error the asyncpg bind — treat them as unknown -> 422 rather than a 500.
    queryable = {i for i in ids if -(2**15) <= i < 2**15}
    rows = (
        (
            await session.execute(
                select(
                    AttributeType.id, AttributeType.value_kind, AttributeType.allowed_values
                ).where(
                    AttributeType.id.in_(queryable),
                    AttributeType.place_type == "fountain",
                    AttributeType.is_active.is_(True),
                )
            )
        ).all()
        if queryable
        else []
    )
    by_id = {r.id: r for r in rows}
    unknown = ids - set(by_id)
    if unknown:
        logger.warning("rejected unknown/non-fountain attribute_type_id(s): %s", sorted(unknown))
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail=f"unknown attribute_type_id(s): {sorted(unknown)}",
        )
    for o in observations:
        spec = by_id[o.attribute_type_id]
        if not _value_is_legal(spec.value_kind, spec.allowed_values, o.value):
            logger.warning(
                "rejected illegal attribute value %r for attribute_type_id %s",
                o.value,
                o.attribute_type_id,
            )
            raise HTTPException(
                status.HTTP_422_UNPROCESSABLE_CONTENT,
                detail=f"illegal value for attribute_type_id {o.attribute_type_id}",
            )
    return by_id


async def _upsert_attribute_observations(
    session: AsyncSession, *, fountain_id: uuid.UUID, user_id: uuid.UUID, observations: list
) -> dict[int, uuid.UUID]:
    """Upsert the caller's observations (dedupe within request, last value wins). Returns
    {attribute_type_id: observation_id} as the durable contribution target_id."""
    value_by_type = {o.attribute_type_id: o.value for o in observations}
    stmt = pg_insert(AttributeObservation).values(
        [
            {
                "id": uuid.uuid4(),
                "fountain_id": fountain_id,
                "user_id": user_id,
                "attribute_type_id": attribute_type_id,
                "value": value,
            }
            for attribute_type_id, value in value_by_type.items()
        ]
    )
    stmt = stmt.on_conflict_do_update(
        index_elements=["fountain_id", "user_id", "attribute_type_id"],
        set_={"value": stmt.excluded.value, "updated_at": func.now()},
    ).returning(AttributeObservation.attribute_type_id, AttributeObservation.id)
    result = await session.execute(stmt)
    obs_ids = {row.attribute_type_id: row.id for row in result}
    await session.flush()
    return obs_ids


async def serialize_fountain_detail(
    session: AsyncSession,
    fountain: Fountain,
    user_id: uuid.UUID | None = None,
    condition_points_awarded: int | None = None,
) -> FountainDetail:
    # The caller's own stars per dimension, so the rating UI can pre-fill and show
    # "already rated" (#65). Only fetched when authenticated; anonymous -> all None.
    your_stars: dict[int, int] = {}
    if user_id is not None:
        your_stars = {
            rid: stars
            for rid, stars in (
                await session.execute(
                    select(Rating.rating_type_id, Rating.stars).where(
                        Rating.fountain_id == fountain.id, Rating.user_id == user_id
                    )
                )
            ).all()
        }
    # Per-viewer condition-points eligibility hint (#124): when the caller has awarded
    # condition points on this fountain within the rolling window, tell them when they'll
    # be eligible again. Only computed when authenticated; anonymous -> always None.
    condition_points_eligible = None
    if user_id is not None:
        condition_points_eligible = condition_points_eligible_at(
            await latest_awarded_condition_at(session, user_id, fountain.id),
            datetime.now(tz=UTC),
        )
    lat, lng = (
        await session.execute(
            select(latitude_of(Fountain.location), longitude_of(Fountain.location)).where(
                Fountain.id == fountain.id
            )
        )
    ).one()
    dim_rows = (
        await session.execute(
            select(
                RatingType.id,
                RatingType.name,
                func.avg(Rating.stars),
                func.count(func.distinct(Rating.user_id)),
            )
            .select_from(RatingType)
            .outerjoin(
                Rating,
                (Rating.rating_type_id == RatingType.id) & (Rating.fountain_id == fountain.id),
            )
            .where(RatingType.place_type == "fountain")  # don't leak future restroom dims
            .group_by(RatingType.id, RatingType.name, RatingType.sort_order)
            .order_by(RatingType.sort_order)
        )
    ).all()
    dimensions = [
        DimensionSummary(
            rating_type_id=rid,
            name=name,
            average_rating=float(avg) if avg is not None else None,
            vote_count=int(votes or 0),
            your_rating=your_stars.get(rid),
        )
        for (rid, name, avg, votes) in dim_rows
    ]
    # Attribute consensus: only attribute types observed at least once (have a consensus
    # row); the full registry is served by GET /attribute-types.
    attr_rows = (
        await session.execute(
            select(
                FountainAttributeConsensus.attribute_type_id,
                AttributeType.key,
                AttributeType.name,
                AttributeType.category,
                FountainAttributeConsensus.consensus_value,
                FountainAttributeConsensus.confidence,
                FountainAttributeConsensus.yes_count,
                FountainAttributeConsensus.no_count,
                FountainAttributeConsensus.unknown_count,
                FountainAttributeConsensus.value_counts,
                FountainAttributeConsensus.observation_count,
                FountainAttributeConsensus.latest_observation_value,
            )
            .join(AttributeType, AttributeType.id == FountainAttributeConsensus.attribute_type_id)
            .where(FountainAttributeConsensus.fountain_id == fountain.id)
            .order_by(AttributeType.sort_order)
        )
    ).all()
    attributes = [
        AttributeConsensusOut(
            attribute_type_id=r.attribute_type_id,
            key=r.key,
            name=r.name,
            category=r.category,
            consensus_value=r.consensus_value,
            confidence=r.confidence,
            yes_count=r.yes_count,
            no_count=r.no_count,
            unknown_count=r.unknown_count,
            value_counts=r.value_counts,
            observation_count=r.observation_count,
            latest_observation_value=r.latest_observation_value,
        )
        for r in attr_rows
    ]
    return FountainDetail(
        id=fountain.id,
        location=Coordinates(latitude=float(lat), longitude=float(lng)),
        is_working=fountain.is_working,
        comments=fountain.comments,
        average_rating=fountain.average_rating,
        rating_count=fountain.rating_count,
        ranking_score=fountain.ranking_score,
        created_at=fountain.created_at,
        last_rated_at=fountain.last_rated_at,
        current_status=fountain.current_status,
        last_verified_at=fountain.last_verified_at,
        placement_note=fountain.placement_note,
        dimensions=dimensions,
        attributes=attributes,
        condition_points_eligible_at=condition_points_eligible,
        condition_points_awarded=condition_points_awarded,
    )


@router.get("/fountains", response_model=list[FountainPin])
async def nearby_fountains(
    response: Response,
    lat: float = Query(ge=-90.0, le=90.0),
    lng: float = Query(ge=-180.0, le=180.0),
    radius_m: float | None = Query(default=None, gt=0.0),
    session: AsyncSession = Depends(get_session),
    settings: Settings = Depends(get_settings),
    filters: DiscoveryFilters = Depends(discovery_filters),
) -> list[FountainPin]:
    radius = min(radius_m or settings.nearby_default_radius_m, settings.nearby_max_radius_m)
    point = point_geography(lat, lng)
    distance = func.ST_Distance(Fountain.location, point)
    stmt = (
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
            distance,
        )
        .where(Fountain.is_hidden.is_(False))
        .where(func.ST_DWithin(Fountain.location, point, radius))
    )
    stmt = apply_discovery_filters(stmt, filters)  # all filters in WHERE...
    stmt = stmt.order_by(distance).limit(settings.max_results + 1)  # ...then order + cap probe
    rows = (await session.execute(stmt)).all()
    truncated = len(rows) > settings.max_results
    response.headers[TRUNCATED_HEADER] = "true" if truncated else "false"
    rows = rows[: settings.max_results]
    return [
        FountainPin(
            id=rid,
            location=Coordinates(latitude=float(rlat), longitude=float(rlng)),
            is_working=working,
            average_rating=avg,
            rating_count=count,
            ranking_score=score,
            current_status=cur_status,
            last_verified_at=last_verified,
            distance_m=float(dist),
        )
        for (rid, rlat, rlng, working, avg, count, score, cur_status, last_verified, dist) in rows
    ]


# Latitude span (degrees) at/above which an envelope cast to geography risks an antipodal
# pole-to-pole edge (PostGIS errors at exactly 180°; the 1° margin avoids float-boundary
# surprises). At/above this, the bbox uses a planar geometry intersection instead (#20).
_GEOGRAPHY_SAFE_LAT_SPAN_DEG = 179.0


@router.get("/fountains/bbox", response_model=list[FountainPin])
async def fountains_in_bbox(
    response: Response,
    min_lat: float = Query(ge=-90.0, le=90.0),
    min_lng: float = Query(ge=-180.0, le=180.0),
    max_lat: float = Query(ge=-90.0, le=90.0),
    max_lng: float = Query(ge=-180.0, le=180.0),
    session: AsyncSession = Depends(get_session),
    settings: Settings = Depends(get_settings),
    filters: DiscoveryFilters = Depends(discovery_filters),
) -> list[FountainPin]:
    # Known limitation: a viewport that crosses the antimeridian (e.g. min_lng=170,
    # max_lng=-170) is rejected here rather than split into two envelopes. Acceptable for
    # Phase 1 (no usage near ±180°); revisit if the map ever pans across the dateline.
    if min_lat > max_lat or min_lng > max_lng:
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail="min_lat/min_lng must be <= max_lat/max_lng",
        )
    # A geography polygon whose vertical edges run pole-to-pole (the envelope spans the
    # full latitude range) has antipodal endpoints, which PostGIS rejects with
    # "Antipodal (180 degrees long) edge detected!" -> 500 (#20). Empirically only the
    # LATITUDE span triggers this (a 200°-wide mid-latitude box is fine); the whole-world
    # viewport is the real-world case. For such near-global envelopes, intersect in planar
    # GEOMETRY space — no antipodal restriction, and exact for an axis-aligned box. Normal
    # viewports keep the geodesic GEOGRAPHY path so the GiST index on location is used.
    envelope = func.ST_MakeEnvelope(min_lng, min_lat, max_lng, max_lat, 4326)
    if max_lat - min_lat < _GEOGRAPHY_SAFE_LAT_SPAN_DEG:
        spatial_predicate = func.ST_Intersects(Fountain.location, cast(envelope, Geography))
    else:
        spatial_predicate = func.ST_Intersects(cast(Fountain.location, Geometry), envelope)
    stmt = (
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
        )
        .where(Fountain.is_hidden.is_(False))
        .where(spatial_predicate)
    )
    stmt = apply_discovery_filters(stmt, filters)  # all filters in WHERE before the cap
    stmt = stmt.limit(settings.max_results + 1)
    rows = (await session.execute(stmt)).all()
    truncated = len(rows) > settings.max_results
    response.headers[TRUNCATED_HEADER] = "true" if truncated else "false"
    rows = rows[: settings.max_results]
    return [
        FountainPin(
            id=rid,
            location=Coordinates(latitude=float(rlat), longitude=float(rlng)),
            is_working=working,
            average_rating=avg,
            rating_count=count,
            ranking_score=score,
            current_status=cur_status,
            last_verified_at=last_verified,
            distance_m=None,
        )
        for (rid, rlat, rlng, working, avg, count, score, cur_status, last_verified) in rows
    ]


@router.get("/fountains/by-attribute", response_model=AttributeFountainsOut)
async def fountains_by_attribute(
    response: Response,
    attribute: SeoAttribute = Query(
        description="SEO attribute key: bottle_filler | wheelchair_reachable."
    ),
    limit: int = Query(default=100, ge=1, le=500),
    offset: int = Query(default=0, ge=0),
    session: AsyncSession = Depends(get_session),
    settings: Settings = Depends(get_settings),
) -> AttributeFountainsOut:
    """A global crawlable attribute page (spec §4.5): the NON-HIDDEN fountains whose crowdsourced
    consensus matches ``attribute``, best-rated first (Bayesian ``ranking_score`` desc, unrated
    last). Reads the denormalized consensus (never recomputes it) — public + cacheable. Declared
    BEFORE ``/fountains/{fountain_id}`` so the literal path is not parsed as a UUID.

    ``total_count`` is the full non-hidden match total (the list is capped by ``limit``);
    ``indexable`` is the server-side thin-content verdict (``total_count >=
    seo_attribute_min_fountains``), so the web sets ``noindex`` without knowing ``K_attr``. Invalid
    ``attribute`` values 422 (Literal).
    """
    key, value = SEO_ATTRIBUTE_FILTERS[attribute]
    predicate = attribute_consensus_match(key, value)
    match_where = (Fountain.is_hidden.is_(False), predicate)

    total_count = (
        await session.execute(select(func.count()).select_from(Fountain).where(*match_where))
    ).scalar_one()

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
            )
            .where(*match_where)
            # Best-rated first: Bayesian ranking_score desc, unrated (NULL) last; then more-rated,
            # then id for a stable, deterministic page across offsets (mirrors the city endpoint).
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
        FountainPin(
            id=rid,
            location=Coordinates(latitude=float(rlat), longitude=float(rlng)),
            is_working=working,
            average_rating=avg,
            rating_count=count,
            ranking_score=score,
            current_status=cur_status,
            last_verified_at=last_verified,
        )
        for (rid, rlat, rlng, working, avg, count, score, cur_status, last_verified) in rows
    ]
    indexable = total_count >= settings.seo_attribute_min_fountains
    ttl = settings.seo_cache_max_age_seconds
    response.headers["Cache-Control"] = f"public, max-age={ttl}, s-maxage={ttl}"
    logger.info(
        "fountains by attribute served",
        extra={
            "attribute": attribute,
            "total_count": total_count,
            "rows": len(fountains),
            "indexable": indexable,
            "limit": limit,
            "offset": offset,
        },
    )
    return AttributeFountainsOut(
        attribute=attribute,
        fountains=fountains,
        total_count=total_count,
        indexable=indexable,
    )


@router.get("/fountains/sitemap", response_model=FountainSitemapOut)
async def fountains_sitemap(
    response: Response,
    limit: int = Query(default=50000, ge=1, le=50000),
    offset: int = Query(default=0, ge=0),
    session: AsyncSession = Depends(get_session),
    settings: Settings = Depends(get_settings),
) -> FountainSitemapOut:
    """The indexable fountain ids for the fountains sitemap chunk (spec §6/§7).

    Enumerates the fountains satisfying the single §7 indexing predicate — a city resolves, not
    hidden, and (rated OR a working, non-degraded/broken fountain) — ordered by id for a stable,
    deterministic page across offsets. Reads the precomputed membership (never a live ST_Covers)
    plus the public status columns; unauthenticated + cacheable. ``total_count`` is the full
    indexable total so the sitemap builder can log (never silently) when a chunk nears the 50k-URL
    limit and must be split. Declared BEFORE ``/fountains/{fountain_id}`` so the literal ``sitemap``
    path is not parsed as a UUID.
    """
    predicate = fountain_indexable_predicate()
    total_count = (
        await session.execute(select(func.count()).select_from(Fountain).where(predicate))
    ).scalar_one()
    ids = (
        (
            await session.execute(
                select(Fountain.id)
                .where(predicate)
                .order_by(Fountain.id.asc())
                .limit(limit)
                .offset(offset)
            )
        )
        .scalars()
        .all()
    )
    ttl = settings.seo_cache_max_age_seconds
    response.headers["Cache-Control"] = f"public, max-age={ttl}, s-maxage={ttl}"
    logger.info(
        "fountains sitemap served",
        extra={"total_count": total_count, "rows": len(ids), "limit": limit, "offset": offset},
    )
    return FountainSitemapOut(fountain_ids=list(ids), total_count=total_count)


@router.get("/fountains/{fountain_id}", response_model=FountainDetail)
async def fountain_detail(
    fountain_id: uuid.UUID,
    session: AsyncSession = Depends(get_session),
    user: User | None = Depends(get_optional_user),
) -> FountainDetail:
    fountain = (
        await session.execute(
            select(Fountain).where(Fountain.id == fountain_id, Fountain.is_hidden.is_(False))
        )
    ).scalar_one_or_none()
    if fountain is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="fountain not found")
    return await serialize_fountain_detail(session, fountain, user_id=user.id if user else None)


@router.get("/fountains/{fountain_id}/place", response_model=FountainPlaceOut)
async def fountain_place(
    fountain_id: uuid.UUID,
    response: Response,
    session: AsyncSession = Depends(get_session),
    settings: Settings = Depends(get_settings),
) -> FountainPlaceOut:
    """One fountain's PUBLIC place membership + the §7 indexing verdict (spec §5/§7).

    Public + unauthenticated + cacheable, computed only from non-hidden columns (never the
    viewer/admin detail path), so auth/admin state can never influence indexability or SEO copy.
    Resolves the fountain's precomputed country/city place from the membership columns (never a
    live ST_Covers). 404s a hidden or unknown fountain (matching the detail endpoint), so the web
    page can ``noindex`` + ``notFound()``. ``indexable`` is the single §7 predicate, evaluated in
    the same query that loads the row so it can never drift from the sitemap enumeration.
    """
    row = (
        await session.execute(
            select(Fountain, fountain_indexable_predicate().label("indexable")).where(
                Fountain.id == fountain_id, Fountain.is_hidden.is_(False)
            )
        )
    ).one_or_none()
    if row is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="fountain not found")
    fountain, indexable = row[0], bool(row[1])

    city = (
        (
            await session.execute(
                select(PlaceBoundary).where(PlaceBoundary.id == fountain.city_place_id)
            )
        ).scalar_one_or_none()
        if fountain.city_place_id is not None
        else None
    )
    country = (
        (
            await session.execute(
                select(PlaceBoundary).where(PlaceBoundary.id == fountain.country_place_id)
            )
        ).scalar_one_or_none()
        if fountain.country_place_id is not None
        else None
    )

    ttl = settings.seo_cache_max_age_seconds
    response.headers["Cache-Control"] = f"public, max-age={ttl}, s-maxage={ttl}"
    logger.info(
        "fountain place served",
        extra={
            "fountain_id": str(fountain.id),
            "city_place_id": str(fountain.city_place_id) if fountain.city_place_id else None,
            "country_place_id": (
                str(fountain.country_place_id) if fountain.country_place_id else None
            ),
            "indexable": indexable,
        },
    )
    return FountainPlaceOut(
        fountain_id=fountain.id,
        city=PlaceOut.model_validate(city) if city is not None else None,
        country=PlaceOut.model_validate(country) if country is not None else None,
        indexable=indexable,
    )


@router.post(
    "/fountains",
    response_model=FountainDetail,
    status_code=status.HTTP_201_CREATED,
    responses={
        status.HTTP_409_CONFLICT: {"model": DuplicateFountainConflict | DisplayNameRequiredConflict}
    },
)
async def add_fountain(
    payload: AddFountainRequest,
    session: AsyncSession = Depends(get_session),
    user: User = Depends(require_named_user),
    settings: Settings = Depends(get_settings),
) -> FountainDetail | JSONResponse:
    await _validate_rating_types(session, payload.ratings)
    # Validate add-time attribute observations BEFORE creating the fountain — a bad
    # observation 422s the whole add (the txn never commits).
    if payload.observations:
        await _validate_attribute_observations(session, payload.observations)

    # Serialize the proximity check + insert against concurrent adds (held until commit).
    await session.execute(select(func.pg_advisory_xact_lock(ADD_FOUNTAIN_LOCK_KEY)))

    point = point_geography(payload.location.latitude, payload.location.longitude)
    # Ignore hidden rows so a hidden bad-import never blocks a real user add.
    conflict = (
        await session.execute(
            select(Fountain.id)
            .where(Fountain.is_hidden.is_(False))
            .where(func.ST_DWithin(Fountain.location, point, settings.duplicate_threshold_m))
            .limit(1)
        )
    ).scalar_one_or_none()
    if conflict is not None:
        # Typed body so clients can route the user to confirm/rate the existing fountain
        # (the add->verify hook). Declared via responses= so it appears in the OpenAPI schema.
        return JSONResponse(
            status_code=status.HTTP_409_CONFLICT,
            content=DuplicateFountainConflict(fountain_id=conflict).model_dump(mode="json"),
        )

    fountain = Fountain(
        location=point,
        is_working=payload.is_working,
        comments=payload.comments,
        placement_note=payload.placement_note,
        added_by_user_id=user.id,
    )
    session.add(fountain)
    await session.flush()

    # Precomputed place membership (#127 Slice 1d): assign this fountain to its country + city
    # place and bump the denormalized fountain_count. Runs inside the add's advisory-lock scope
    # (held until commit), so the count recompute is race-safe against concurrent adds. The public
    # place pages read this precomputed assignment — never a live ST_Covers.
    await recompute_fountain_membership(session, fountain.id)

    # Emit contribution events. add_fountain + first_fountain are idempotent via dedup keys.
    specs = [
        ContributionSpec(
            user_id=user.id,
            event_type="add_fountain",
            dedup_key=dk_add_fountain(fountain.id),
            fountain_id=fountain.id,
            location=point,
            target_type="fountain",
            target_id=fountain.id,
        ),
        ContributionSpec(
            user_id=user.id,
            event_type="first_fountain_bonus",
            dedup_key=dk_first_fountain(user.id),
            fountain_id=fountain.id,
            location=point,
        ),
    ]
    # "First in area" requires the area to be genuinely unmapped — NO other non-hidden
    # fountain (including imported ones) within first_in_area_radius_m. The add advisory
    # lock (held until commit) serializes this precheck against concurrent adds.
    others_nearby = (
        await session.execute(
            select(func.count())
            .select_from(Fountain)
            .where(
                Fountain.id != fountain.id,
                Fountain.is_hidden.is_(False),
                func.ST_DWithin(Fountain.location, point, settings.first_in_area_radius_m),
            )
        )
    ).scalar_one()
    if others_nearby == 0:
        specs.append(
            ContributionSpec(
                user_id=user.id,
                event_type="first_in_area_bonus",
                dedup_key=dk_first_in_area(fountain.id),
                fountain_id=fountain.id,
                location=point,
            )
        )
    if payload.ratings:
        rating_ids = await _upsert_ratings(
            session, fountain_id=fountain.id, user_id=user.id, ratings=payload.ratings
        )
        await recompute_fountain_ranking(session, fountain.id)
        specs += _rating_contribution_specs(
            user_id=user.id, fountain_id=fountain.id, location=point, rating_ids=rating_ids
        )
    if payload.observations:
        obs_ids = await _upsert_attribute_observations(
            session, fountain_id=fountain.id, user_id=user.id, observations=payload.observations
        )
        for attribute_type_id in obs_ids:
            await recompute_attribute_consensus(session, fountain.id, attribute_type_id)
        specs += [
            ContributionSpec(
                user_id=user.id,
                event_type="observe_attribute",
                dedup_key=dk_observe_attr(user.id, fountain.id, attribute_type_id),
                fountain_id=fountain.id,
                location=point,
                target_type="attribute_observation",
                target_id=observation_id,
                event_metadata={"attribute_type_id": attribute_type_id},
            )
            for attribute_type_id, observation_id in obs_ids.items()
        ]
    await record_contributions(session, specs)

    await session.commit()
    await session.refresh(fountain)
    return await serialize_fountain_detail(session, fountain, user_id=user.id)


@router.post(
    "/fountains/{fountain_id}/ratings",
    response_model=FountainDetail,
    responses={status.HTTP_409_CONFLICT: {"model": DisplayNameRequiredConflict}},
)
async def submit_ratings(
    fountain_id: uuid.UUID,
    payload: RateRequest,
    session: AsyncSession = Depends(get_session),
    user: User = Depends(require_named_user),
) -> FountainDetail:
    # Lock the parent fountain row for the txn so concurrent raters serialize their
    # aggregate recompute. The per-rating ON CONFLICT keeps the rating ROWS race-safe,
    # but two concurrent recomputes could each read a snapshot missing the other's
    # rating and persist stale rating_count/average_rating/ranking_score. FOR UPDATE
    # makes the upsert+recompute atomic per fountain (the second waits for the first
    # to commit, then recomputes over both rows).
    fountain = (
        await session.execute(
            select(Fountain)
            .where(Fountain.id == fountain_id, Fountain.is_hidden.is_(False))
            .with_for_update()
        )
    ).scalar_one_or_none()
    if fountain is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="fountain not found")

    await _validate_rating_types(session, payload.ratings)
    rating_ids = await _upsert_ratings(
        session, fountain_id=fountain.id, user_id=user.id, ratings=payload.ratings
    )
    await recompute_fountain_ranking(session, fountain.id)
    # Rebuild the location as a SQL expression (binding a loaded WKBElement would need
    # Shapely); mirrors how add_fountain passes the point_geography expression.
    lat, lng = (
        await session.execute(
            select(latitude_of(Fountain.location), longitude_of(Fountain.location)).where(
                Fountain.id == fountain.id
            )
        )
    ).one()
    await record_contributions(
        session,
        _rating_contribution_specs(
            user_id=user.id,
            fountain_id=fountain.id,
            location=point_geography(float(lat), float(lng)),
            rating_ids=rating_ids,
        ),
    )
    await session.commit()
    await session.refresh(fountain)
    return await serialize_fountain_detail(session, fountain, user_id=user.id)


@router.post(
    "/fountains/{fountain_id}/attributes",
    response_model=FountainDetail,
    responses={status.HTTP_409_CONFLICT: {"model": DisplayNameRequiredConflict}},
)
async def submit_attributes(
    fountain_id: uuid.UUID,
    payload: ObserveAttributesRequest,
    session: AsyncSession = Depends(get_session),
    user: User = Depends(require_named_user),
) -> FountainDetail:
    # Lock the fountain row for the txn so concurrent observers serialize their consensus
    # recompute (mirrors submit_ratings' FOR UPDATE discipline).
    fountain = (
        await session.execute(
            select(Fountain)
            .where(Fountain.id == fountain_id, Fountain.is_hidden.is_(False))
            .with_for_update()
        )
    ).scalar_one_or_none()
    if fountain is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="fountain not found")

    await _validate_attribute_observations(session, payload.observations)
    obs_ids = await _upsert_attribute_observations(
        session, fountain_id=fountain.id, user_id=user.id, observations=payload.observations
    )
    for attribute_type_id in obs_ids:
        await recompute_attribute_consensus(session, fountain.id, attribute_type_id)

    lat, lng = (
        await session.execute(
            select(latitude_of(Fountain.location), longitude_of(Fountain.location)).where(
                Fountain.id == fountain.id
            )
        )
    ).one()
    loc = point_geography(float(lat), float(lng))
    specs = [
        ContributionSpec(
            user_id=user.id,
            event_type="observe_attribute",
            dedup_key=dk_observe_attr(user.id, fountain.id, attribute_type_id),
            fountain_id=fountain.id,
            location=loc,
            target_type="attribute_observation",
            target_id=observation_id,
            event_metadata={"attribute_type_id": attribute_type_id},
        )
        for attribute_type_id, observation_id in obs_ids.items()
    ]
    await record_contributions(session, specs)
    await session.commit()
    await session.refresh(fountain)
    return await serialize_fountain_detail(session, fountain, user_id=user.id)


@router.post(
    "/fountains/{fountain_id}/conditions",
    response_model=FountainDetail,
    responses={status.HTTP_409_CONFLICT: {"model": DisplayNameRequiredConflict}},
)
async def submit_condition(
    fountain_id: uuid.UUID,
    payload: ConditionReportRequest,
    session: AsyncSession = Depends(get_session),
    user: User = Depends(require_named_user),
) -> FountainDetail:
    # One captured timestamp drives the row created_at, the status recompute window, and the
    # rolling-24h condition point-window gate (#124) — so they can never straddle a boundary.
    report_time = datetime.now(tz=UTC)
    fountain = (
        await session.execute(
            select(Fountain)
            .where(Fountain.id == fountain_id, Fountain.is_hidden.is_(False))
            .with_for_update()
        )
    ).scalar_one_or_none()
    if fountain is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="fountain not found")
    prev_status = fountain.current_status

    report = ConditionReport(
        fountain_id=fountain.id,
        user_id=user.id,
        status=payload.status,
        is_proximate=payload.is_proximate,
        created_at=report_time,
    )
    session.add(report)
    await session.flush()
    await recompute_fountain_status(session, fountain.id, now=report_time)

    lat, lng = (
        await session.execute(
            select(latitude_of(Fountain.location), longitude_of(Fountain.location)).where(
                Fountain.id == fountain.id
            )
        )
    ).one()
    is_verify = payload.status == "working"
    # Rolling-24h, coalesced point gate (#124). The Fountain FOR UPDATE lock above serialises
    # condition writes per fountain, so a single user cannot race two awards past this check.
    last_awarded_at = await latest_awarded_condition_at(session, user.id, fountain.id)
    eligible = condition_points_eligible_at(last_awarded_at, report_time) is None
    points_awarded = 0
    if eligible:
        event_type = "verify_working" if is_verify else "report_condition"
        spec = ContributionSpec(
            user_id=user.id,
            event_type=event_type,
            dedup_key=dk_condition_award(report.id),
            fountain_id=fountain.id,
            location=point_geography(float(lat), float(lng)),
            target_type="condition_report",
            target_id=report.id,
            event_metadata={"status": payload.status},
            created_at=report_time,
        )
        inserted = await record_contributions(session, [spec])
        points_awarded = points_for(event_type) if inserted else 0
    await session.commit()
    await session.refresh(fountain)
    logger.info(
        "condition reported fountain=%s user=%s report=%s status=%s current_status=%s->%s "
        "points_awarded=%d",
        fountain.id,
        user.id,
        report.id,
        payload.status,
        prev_status,
        fountain.current_status,
        points_awarded,
    )
    return await serialize_fountain_detail(
        session, fountain, user_id=user.id, condition_points_awarded=points_awarded
    )


@router.post(
    "/fountains/{fountain_id}/notes",
    response_model=NoteOut,
    responses={status.HTTP_409_CONFLICT: {"model": DisplayNameRequiredConflict}},
)
async def submit_note(
    fountain_id: uuid.UUID,
    payload: AddNoteRequest,
    session: AsyncSession = Depends(get_session),
    user: User = Depends(require_named_user),
) -> NoteOut:
    fountain = (
        await session.execute(
            select(Fountain)
            .where(Fountain.id == fountain_id, Fountain.is_hidden.is_(False))
            .with_for_update()
        )
    ).scalar_one_or_none()
    if fountain is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="fountain not found")

    # Upsert the caller's one note. Set ONLY body + updated_at — moderation fields are left
    # untouched so a hidden note stays hidden after an edit (no self-unhide bypass).
    stmt = (
        pg_insert(FountainNote)
        .values(id=uuid.uuid4(), fountain_id=fountain.id, user_id=user.id, body=payload.body)
        .on_conflict_do_update(
            index_elements=["fountain_id", "user_id"],
            set_={"body": payload.body, "updated_at": func.now()},
        )
        .returning(FountainNote.id, FountainNote.created_at, FountainNote.updated_at)
    )
    note = (await session.execute(stmt)).one()
    await session.flush()

    lat, lng = (
        await session.execute(
            select(latitude_of(Fountain.location), longitude_of(Fountain.location)).where(
                Fountain.id == fountain.id
            )
        )
    ).one()
    inserted = await record_contributions(
        session,
        [
            ContributionSpec(
                user_id=user.id,
                event_type="add_note",
                dedup_key=dk_note(user.id, fountain.id),
                fountain_id=fountain.id,
                location=point_geography(float(lat), float(lng)),
                target_type="note",
                target_id=note.id,
            )
        ],
    )
    await session.commit()
    logger.info(
        "note saved fountain=%s user=%s note=%s event=%s",
        fountain.id,
        user.id,
        note.id,
        "inserted" if inserted else "deduped",
    )
    return NoteOut(
        id=note.id,
        body=payload.body,
        author_display_name=public_display_name(
            user.display_name, user.logto_user_id, user.nickname
        ),
        created_at=note.created_at,
        updated_at=note.updated_at,
    )


@router.get("/fountains/{fountain_id}/notes", response_model=list[NoteOut])
async def list_notes(
    fountain_id: uuid.UUID,
    session: AsyncSession = Depends(get_session),
    settings: Settings = Depends(get_settings),
) -> list[NoteOut]:
    exists = (
        await session.execute(
            select(Fountain.id).where(Fountain.id == fountain_id, Fountain.is_hidden.is_(False))
        )
    ).scalar_one_or_none()
    if exists is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="fountain not found")
    rows = (
        await session.execute(
            select(
                FountainNote.id,
                FountainNote.body,
                User.display_name,
                User.logto_user_id,
                User.nickname,
                FountainNote.created_at,
                FountainNote.updated_at,
            )
            .join(User, User.id == FountainNote.user_id)
            .where(
                FountainNote.fountain_id == fountain_id,
                FountainNote.is_hidden.is_(False),
            )
            .order_by(FountainNote.created_at.desc(), FountainNote.id.desc())
            .limit(settings.max_results)
        )
    ).all()
    return [
        NoteOut(
            id=r.id,
            body=r.body,
            author_display_name=public_display_name(r.display_name, r.logto_user_id, r.nickname),
            created_at=r.created_at,
            updated_at=r.updated_at,
        )
        for r in rows
    ]


@router.post(
    "/fountains/{fountain_id}/notes/{note_id}/report",
    status_code=status.HTTP_204_NO_CONTENT,
)
async def report_note(
    fountain_id: uuid.UUID,
    note_id: uuid.UUID,
    payload: ReportContentRequest,
    user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> None:
    """Flag a note for moderation (#11). Any signed-in user may report (display name NOT
    required). Reporting a hidden note is allowed — moderators still want the signal. The
    shared chokepoint validates the category (422 outside the note set), dedupes (idempotent
    204), and rate-limits a genuinely new report (429)."""
    note = (
        await session.execute(
            select(FountainNote).where(
                FountainNote.id == note_id, FountainNote.fountain_id == fountain_id
            )
        )
    ).scalar_one_or_none()
    if note is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="note not found")
    await create_content_report(
        session,
        content_type="note",
        content_id=note.id,
        fountain_id=fountain_id,
        reporter_user_id=user.id,
        category=payload.category,
        note=payload.note,
    )
