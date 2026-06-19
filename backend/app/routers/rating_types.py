from fastapi import APIRouter, Depends
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db import get_session
from app.models import RatingType
from app.schemas import RatingTypeOut

router = APIRouter(prefix="/api/v1", tags=["rating-types"])


@router.get("/rating-types", response_model=list[RatingTypeOut])
async def list_rating_types(session: AsyncSession = Depends(get_session)) -> list[RatingType]:
    result = await session.execute(select(RatingType).order_by(RatingType.sort_order))
    return list(result.scalars().all())
