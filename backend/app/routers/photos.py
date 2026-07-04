"""Public photo reads (fountain-photos design §4): the per-fountain photo list plus the
two gated redirect endpoints that hand a client a time-limited presigned Spaces URL.

Both endpoints are PUBLIC (no auth) — photos are moderated content, not user-owned data —
but a hidden or unknown photo id must 404 (never reveal existence), and a misconfigured
storage backend on an otherwise-valid, visible photo must 503 rather than masquerade as
"not found" (an operational misconfig should never look like a data problem)."""

import logging
import uuid

from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.responses import RedirectResponse
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import Settings, get_settings
from app.db import get_session
from app.display import public_display_name
from app.models import Fountain, FountainPhoto, User
from app.schemas import PhotoOut
from app.storage import get_storage

router = APIRouter(prefix="/api/v1", tags=["photos"])
logger = logging.getLogger(__name__)


def photo_out(photo: FountainPhoto, *, uploaded_by: str | None) -> PhotoOut:
    return PhotoOut(
        id=photo.id,
        url=f"/api/v1/photos/{photo.id}",
        thumbnail_url=f"/api/v1/photos/{photo.id}/thumb",
        width=photo.width,
        height=photo.height,
        uploaded_by=uploaded_by,
        created_at=photo.created_at,
    )


@router.get("/fountains/{fountain_id}/photos", response_model=list[PhotoOut])
async def list_photos(
    fountain_id: uuid.UUID,
    session: AsyncSession = Depends(get_session),
) -> list[PhotoOut]:
    # Parent-scoped 404 (mirrors list_notes): a missing/hidden fountain 404s rather than
    # returning an empty list, so the client can distinguish "no photos" from "no fountain".
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
                FountainPhoto,
                User.display_name,
                User.logto_user_id,
                User.nickname,
            )
            .join(User, User.id == FountainPhoto.user_id)
            .where(
                FountainPhoto.fountain_id == fountain_id,
                FountainPhoto.is_hidden.is_(False),
            )
            .order_by(FountainPhoto.created_at.desc(), FountainPhoto.id.desc())
        )
    ).all()
    return [
        photo_out(
            photo,
            uploaded_by=public_display_name(display_name, logto_user_id, nickname),
        )
        for (photo, display_name, logto_user_id, nickname) in rows
    ]


async def _load_visible_photo(session: AsyncSession, photo_id: uuid.UUID) -> FountainPhoto:
    """Unknown id or `is_hidden` both 404 (never reveal a hidden photo's existence)."""
    photo = (
        await session.execute(select(FountainPhoto).where(FountainPhoto.id == photo_id))
    ).scalar_one_or_none()
    if photo is None or photo.is_hidden:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="photo not found")
    return photo


def _redirect_to_presigned(key: str, settings: Settings) -> RedirectResponse:
    storage = get_storage(settings)
    if storage is None:
        # An operational misconfig on an otherwise-valid, visible photo must not
        # masquerade as "not found" (observability standard) -> 503, logged loudly.
        logger.warning("photo read requested but storage is disabled/misconfigured")
        raise HTTPException(status.HTTP_503_SERVICE_UNAVAILABLE, detail="storage_unavailable")
    return RedirectResponse(
        storage.presign_get(key),
        status_code=status.HTTP_302_FOUND,
        headers={"Cache-Control": "private, max-age=60"},
    )


@router.get("/photos/{photo_id}")
async def get_photo(
    photo_id: uuid.UUID,
    session: AsyncSession = Depends(get_session),
    settings: Settings = Depends(get_settings),
) -> RedirectResponse:
    photo = await _load_visible_photo(session, photo_id)
    return _redirect_to_presigned(photo.storage_key, settings)


@router.get("/photos/{photo_id}/thumb")
async def get_photo_thumb(
    photo_id: uuid.UUID,
    session: AsyncSession = Depends(get_session),
    settings: Settings = Depends(get_settings),
) -> RedirectResponse:
    photo = await _load_visible_photo(session, photo_id)
    return _redirect_to_presigned(photo.thumbnail_key, settings)
