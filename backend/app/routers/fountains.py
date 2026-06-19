import uuid

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import func, select
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth import get_current_user
from app.config import Settings, get_settings
from app.db import get_session
from app.geo import latitude_of, longitude_of, point_geography
from app.models import Fountain, Rating, RatingType, User
from app.ranking import recompute_fountain_ranking
from app.schemas import (
    AddFountainRequest,
    Coordinates,
    DimensionSummary,
    FountainDetail,
    FountainPin,
    RateRequest,
    RatingInput,
)

router = APIRouter(prefix="/api/v1", tags=["fountains"])


async def _validate_rating_types(session: AsyncSession, ratings: list[RatingInput]) -> None:
    if not ratings:
        return
    ids = {r.rating_type_id for r in ratings}
    known = set(
        (await session.execute(select(RatingType.id).where(RatingType.id.in_(ids)))).scalars().all()
    )
    unknown = ids - known
    if unknown:
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail=f"unknown rating_type_id(s): {sorted(unknown)}",
        )


async def _upsert_ratings(
    session: AsyncSession, *, fountain_id: uuid.UUID, user_id: uuid.UUID, ratings: list[RatingInput]
) -> None:
    # Atomic upsert via ON CONFLICT on the (fountain_id, user_id, rating_type_id) unique
    # constraint. A SELECT-then-INSERT would race two concurrent submissions for the same
    # user/fountain/dimension (both see no row, both INSERT) -> one hits IntegrityError ->
    # a 500. ON CONFLICT DO UPDATE makes the create-or-edit atomic. Dedupe within the
    # request (last value wins) so a single statement never touches the same conflict key
    # twice — Postgres rejects "ON CONFLICT ... cannot affect row a second time".
    stars_by_type = {r.rating_type_id: r.stars for r in ratings}
    if not stars_by_type:
        return
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
    stmt = stmt.on_conflict_do_update(
        index_elements=["fountain_id", "user_id", "rating_type_id"],
        set_={"stars": stmt.excluded.stars, "updated_at": func.now()},
    )
    await session.execute(stmt)
    await session.flush()


async def serialize_fountain_detail(session: AsyncSession, fountain: Fountain) -> FountainDetail:
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
            .group_by(RatingType.id, RatingType.name)
            .order_by(RatingType.id)
        )
    ).all()
    dimensions = [
        DimensionSummary(
            rating_type_id=rid,
            name=name,
            average_rating=float(avg) if avg is not None else None,
            vote_count=int(votes or 0),
        )
        for (rid, name, avg, votes) in dim_rows
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
        dimensions=dimensions,
    )


@router.get("/fountains", response_model=list[FountainPin])
async def nearby_fountains(
    lat: float = Query(ge=-90.0, le=90.0),
    lng: float = Query(ge=-180.0, le=180.0),
    radius_m: float | None = Query(default=None, gt=0.0),
    session: AsyncSession = Depends(get_session),
    settings: Settings = Depends(get_settings),
) -> list[FountainPin]:
    radius = min(radius_m or settings.nearby_default_radius_m, settings.nearby_max_radius_m)
    point = point_geography(lat, lng)
    distance = func.ST_Distance(Fountain.location, point)
    rows = (
        await session.execute(
            select(
                Fountain.id,
                latitude_of(Fountain.location),
                longitude_of(Fountain.location),
                Fountain.is_working,
                Fountain.average_rating,
                Fountain.rating_count,
                distance,
            )
            .where(func.ST_DWithin(Fountain.location, point, radius))
            .order_by(distance)
            .limit(settings.max_results)
        )
    ).all()
    return [
        FountainPin(
            id=rid,
            location=Coordinates(latitude=float(rlat), longitude=float(rlng)),
            is_working=working,
            average_rating=avg,
            rating_count=count,
            distance_m=float(dist),
        )
        for (rid, rlat, rlng, working, avg, count, dist) in rows
    ]


@router.post("/fountains", response_model=FountainDetail, status_code=status.HTTP_201_CREATED)
async def add_fountain(
    payload: AddFountainRequest,
    session: AsyncSession = Depends(get_session),
    user: User = Depends(get_current_user),
    settings: Settings = Depends(get_settings),
) -> FountainDetail:
    await _validate_rating_types(session, payload.ratings)

    point = point_geography(payload.location.latitude, payload.location.longitude)
    conflict = (
        await session.execute(
            select(Fountain.id)
            .where(func.ST_DWithin(Fountain.location, point, settings.duplicate_threshold_m))
            .limit(1)
        )
    ).scalar_one_or_none()
    if conflict is not None:
        raise HTTPException(
            status.HTTP_409_CONFLICT,
            detail=f"a fountain already exists within {settings.duplicate_threshold_m} m",
        )

    fountain = Fountain(
        location=point,
        is_working=payload.is_working,
        comments=payload.comments,
        added_by_user_id=user.id,
    )
    session.add(fountain)
    await session.flush()

    if payload.ratings:
        await _upsert_ratings(
            session, fountain_id=fountain.id, user_id=user.id, ratings=payload.ratings
        )
        await recompute_fountain_ranking(session, fountain.id)

    await session.commit()
    await session.refresh(fountain)
    return await serialize_fountain_detail(session, fountain)


@router.post("/fountains/{fountain_id}/ratings", response_model=FountainDetail)
async def submit_ratings(
    fountain_id: uuid.UUID,
    payload: RateRequest,
    session: AsyncSession = Depends(get_session),
    user: User = Depends(get_current_user),
) -> FountainDetail:
    fountain = (
        await session.execute(select(Fountain).where(Fountain.id == fountain_id))
    ).scalar_one_or_none()
    if fountain is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="fountain not found")

    await _validate_rating_types(session, payload.ratings)
    await _upsert_ratings(
        session, fountain_id=fountain.id, user_id=user.id, ratings=payload.ratings
    )
    await recompute_fountain_ranking(session, fountain.id)
    await session.commit()
    await session.refresh(fountain)
    return await serialize_fountain_detail(session, fountain)
