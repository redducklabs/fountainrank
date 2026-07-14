from pathlib import Path

from alembic.config import Config
from alembic.script import ScriptDirectory
from alembic.script.revision import ResolutionError
from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel
from sqlalchemy import text
from sqlalchemy.exc import DBAPIError
from sqlalchemy.ext.asyncio import AsyncSession

from app.db import get_session

router = APIRouter()


class HealthResponse(BaseModel):
    status: str


class ReadyzResponse(BaseModel):
    status: str
    postgis_version: str
    sf_to_nyc_m: float
    schema_revision: str


def _alembic_script() -> ScriptDirectory:
    backend_dir = Path(__file__).resolve().parents[2]
    return ScriptDirectory.from_config(Config(str(backend_dir / "alembic.ini")))


def _revision_is_at_or_ahead(script: ScriptDirectory, *, db_revision: str, image_head: str) -> bool:
    if db_revision == image_head:
        return True
    try:
        ancestors = {rev.revision for rev in script.iterate_revisions(db_revision, "base")}
    except ResolutionError:
        return False
    return image_head in ancestors


async def _schema_revision_ready(session: AsyncSession) -> str:
    script = _alembic_script()
    image_head = script.get_current_head()
    try:
        db_revision = (
            await session.execute(text("SELECT version_num FROM alembic_version"))
        ).scalar_one_or_none()
    except DBAPIError as exc:
        raise HTTPException(
            status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="database schema is not migrated",
        ) from exc
    if not db_revision or not _revision_is_at_or_ahead(
        script, db_revision=db_revision, image_head=image_head
    ):
        raise HTTPException(
            status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="database schema is not migrated",
        )
    return db_revision


@router.get("/healthz")
async def healthz() -> HealthResponse:
    return HealthResponse(status="ok")


@router.get("/readyz")
async def readyz(session: AsyncSession = Depends(get_session)) -> ReadyzResponse:
    schema_revision = await _schema_revision_ready(session)
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
    return ReadyzResponse(
        status="ok",
        postgis_version=version,
        sf_to_nyc_m=float(distance_m),
        schema_revision=schema_revision,
    )
