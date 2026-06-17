from fastapi import APIRouter, Depends
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.db import get_session

router = APIRouter()


@router.get("/healthz")
async def healthz() -> dict[str, str]:
    return {"status": "ok"}


@router.get("/readyz")
async def readyz(session: AsyncSession = Depends(get_session)) -> dict[str, str | float]:
    version = (await session.execute(text("SELECT PostGIS_version()"))).scalar_one()
    distance_m = (
        await session.execute(
            text(
                "SELECT ST_Distance("
                "ST_SetSRID(ST_MakePoint(-122.4194, 37.7749), 4326)::geography, "
                "ST_SetSRID(ST_MakePoint(-73.9857, 40.7484), 4326)::geography)"
            )
        )
    ).scalar_one()
    return {"status": "ok", "postgis_version": version, "sf_to_nyc_m": float(distance_m)}
