from fastapi import APIRouter, Depends
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db import get_session
from app.models import AttributeType
from app.schemas import AttributeTypeOut

router = APIRouter(prefix="/api/v1", tags=["attribute-types"])


@router.get("/attribute-types", response_model=list[AttributeTypeOut])
async def list_attribute_types(
    session: AsyncSession = Depends(get_session),
) -> list[AttributeType]:
    # Fountain-scoped, active definitions only (place_type scoping, #44).
    result = await session.execute(
        select(AttributeType)
        .where(AttributeType.place_type == "fountain", AttributeType.is_active.is_(True))
        .order_by(AttributeType.sort_order)
    )
    return list(result.scalars().all())
