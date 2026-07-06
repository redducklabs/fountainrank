"""Public photo reads (fountain-photos design §4): the per-fountain photo list plus the
two gated redirect endpoints that hand a client a time-limited presigned Spaces URL.

Both endpoints are PUBLIC (no auth) — photos are moderated content, not user-owned data —
but a hidden or unknown photo id must 404 (never reveal existence), and a misconfigured
storage backend on an otherwise-valid, visible photo must 503 rather than masquerade as
"not found" (an operational misconfig should never look like a data problem)."""

import logging
import uuid

from fastapi import APIRouter, Depends, HTTPException, Request, Response, status
from fastapi.concurrency import run_in_threadpool
from fastapi.responses import RedirectResponse
from sqlalchemy import delete, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth import get_current_user, get_optional_user, require_named_user
from app.config import Settings, get_settings
from app.contributions import (
    ContributionSpec,
    dk_photo_first,
    record_contributions,
    reverse_contribution_for_target,
)
from app.db import get_session
from app.display import public_display_name
from app.geo import latitude_of, longitude_of, point_geography
from app.images import UnsupportedImage, process_image
from app.models import ContentReport, Fountain, FountainPhoto, StorageCleanup, User
from app.multipart_read import TooLarge, read_capped_multipart_file
from app.rate_limit import RateLimited, finalize_upload, reserve_upload
from app.reports import create_content_report
from app.schemas import DisplayNameRequiredConflict, PhotoOut, ReportContentRequest
from app.storage import Storage, get_storage

router = APIRouter(prefix="/api/v1", tags=["photos"])
logger = logging.getLogger(__name__)

# Upload guards (fountain-photos design §6). The 10 MB file cap is enforced authoritatively
# by the streaming multipart reader; the raw-body Content-Length guard below is a cheap
# defense-in-depth reject (a body far larger than a valid upload is rejected before the
# reservation, so it never costs budget). The k8s ingress body cap is a further backstop.
MAX_UPLOAD_BYTES = 10 * 1024 * 1024
# Reject an obviously-oversized raw body early (headers + boundary overhead give real uploads
# some slack over the 10 MB file cap, so allow 2 MB of margin before the cheap 413).
MAX_RAW_BODY_BYTES = MAX_UPLOAD_BYTES + 2 * 1024 * 1024
# Per-fountain / per-user-per-fountain VISIBLE photo caps (design §6), re-checked under the
# fountain row lock in the insert txn.
MAX_PHOTOS_PER_FOUNTAIN = 20
MAX_PHOTOS_PER_USER_PER_FOUNTAIN = 5


def photo_out(
    photo: FountainPhoto, *, uploaded_by: str | None, viewer_user_id: uuid.UUID | None = None
) -> PhotoOut:
    return PhotoOut(
        id=photo.id,
        url=f"/api/v1/photos/{photo.id}",
        thumbnail_url=f"/api/v1/photos/{photo.id}/thumb",
        width=photo.width,
        height=photo.height,
        uploaded_by=uploaded_by,
        created_at=photo.created_at,
        is_own=viewer_user_id is not None and photo.user_id == viewer_user_id,
    )


@router.get("/fountains/{fountain_id}/photos", response_model=list[PhotoOut])
async def list_photos(
    fountain_id: uuid.UUID,
    response: Response,
    session: AsyncSession = Depends(get_session),
    viewer: User | None = Depends(get_optional_user),
) -> list[PhotoOut]:
    # The response is viewer-dependent (`is_own` varies per caller) even though the endpoint
    # stays PUBLIC (no auth required) — so it must never be shared-cached (a CDN/proxy caching
    # one viewer's `is_own=true` response and serving it to another viewer would be a real
    # ownership leak, not just a cosmetic bug).
    response.headers["Cache-Control"] = "private, no-store"

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
            viewer_user_id=viewer.id if viewer else None,
        )
        for (photo, display_name, logto_user_id, nickname) in rows
    ]


async def _load_visible_photo(session: AsyncSession, photo_id: uuid.UUID) -> FountainPhoto:
    """Unknown id, `is_hidden`, or a hidden PARENT fountain all 404 (never reveal a hidden
    photo's — or a hidden fountain's — existence via the direct read endpoints; moderation
    consistency with the parent-scoped list endpoint, which is already fountain-hidden-aware)."""
    photo = (
        await session.execute(
            select(FountainPhoto)
            .join(Fountain, Fountain.id == FountainPhoto.fountain_id)
            .where(
                FountainPhoto.id == photo_id,
                FountainPhoto.is_hidden.is_(False),
                Fountain.is_hidden.is_(False),
            )
        )
    ).scalar_one_or_none()
    if photo is None:
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


async def _cleanup_after_failure(
    session: AsyncSession,
    storage: Storage,
    reservation_id: uuid.UUID,
    uploaded_keys: list[str],
    *,
    fountain_id: uuid.UUID,
    user_id: uuid.UUID,
) -> None:
    """Failure/cleanup path for the upload endpoint (design §8.1 step 5).

    Guarantees the reservation is never left ``reserved`` (a failed attempt still costs
    budget) and that no just-uploaded Spaces object is silently orphaned. Any partially-
    applied insert txn from step 4 is rolled back first; the reservation is then finalized
    ``failed`` in a fresh short txn, and each uploaded object is best-effort deleted — a
    delete failure is escalated to a durable ``storage_cleanup`` row rather than lost.
    """
    # Discard any pending/aborted work from the insert txn so the session is clean for the
    # finalize below (the FOR UPDATE lock, if held, releases here too).
    await session.rollback()

    try:
        await finalize_upload(session, reservation_id, "failed")
        await session.commit()
    except Exception:
        await session.rollback()
        logger.exception(
            "failed to finalize upload reservation",
            extra={"reservation_id": str(reservation_id), "user_id": str(user_id)},
        )

    orphaned: list[str] = []
    for key in uploaded_keys:
        try:
            await run_in_threadpool(storage.delete_object, key)
        except Exception:
            logger.error(
                "failed to delete orphaned upload object; recording for durable cleanup",
                extra={"object_key": key, "fountain_id": str(fountain_id)},
            )
            orphaned.append(key)
    if orphaned:
        for key in orphaned:
            session.add(StorageCleanup(object_key=key, reason="upload_orphan"))
        try:
            await session.commit()
        except Exception:
            await session.rollback()
            logger.exception(
                "failed to record storage_cleanup rows for orphaned upload objects",
                extra={"fountain_id": str(fountain_id)},
            )


@router.post(
    "/fountains/{fountain_id}/photos",
    response_model=PhotoOut,
    status_code=status.HTTP_201_CREATED,
    responses={status.HTTP_409_CONFLICT: {"model": DisplayNameRequiredConflict}},
)
async def upload_photo(
    request: Request,
    fountain_id: uuid.UUID,
    user: User = Depends(require_named_user),
    session: AsyncSession = Depends(get_session),
    settings: Settings = Depends(get_settings),
) -> PhotoOut:
    """Upload a photo of a fountain (design §8.1). Reserve-before-work: the endpoint takes
    the raw ``Request`` (NOT an ``UploadFile`` body param) so the authoritative per-user
    reservation gate runs before the multipart body is read or any Pillow/S3 work happens."""
    # 1. Storage availability — fail closed (503) before reading anything.
    storage = get_storage(settings)
    if storage is None:
        logger.warning(
            "photo upload requested but storage is disabled/misconfigured",
            extra={"fountain_id": str(fountain_id), "user_id": str(user.id)},
        )
        raise HTTPException(status.HTTP_503_SERVICE_UNAVAILABLE, detail="photo_uploads_unavailable")

    # Cheap raw-body guard (defense-in-depth over the streaming file cap): an obviously
    # oversized body is rejected before the reservation, so it costs no budget.
    content_length = request.headers.get("content-length")
    if content_length is not None:
        try:
            declared = int(content_length)
        except ValueError:
            declared = None
        if declared is not None and declared > MAX_RAW_BODY_BYTES:
            logger.warning(
                "photo upload rejected: declared body exceeds raw cap",
                extra={
                    "fountain_id": str(fountain_id),
                    "user_id": str(user.id),
                    "content_length": declared,
                    "max_raw_body_bytes": MAX_RAW_BODY_BYTES,
                },
            )
            raise HTTPException(status.HTTP_413_CONTENT_TOO_LARGE, detail="photo_too_large")

    # 2. Cheap existence check (no lock): a missing/hidden fountain 404s before reserving.
    exists = (
        await session.execute(
            select(Fountain.id).where(Fountain.id == fountain_id, Fountain.is_hidden.is_(False))
        )
    ).scalar_one_or_none()
    if exists is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="fountain not found")

    # 3. Reservation — the authoritative rate/quota gate, before any body read or CPU/S3 work.
    try:
        reservation_id = await reserve_upload(session, user.id, settings)
        await session.commit()  # commit the reservation + release the per-user advisory lock
    except RateLimited as exc:
        await session.rollback()
        logger.info(
            "photo upload rate limited",
            extra={
                "fountain_id": str(fountain_id),
                "user_id": str(user.id),
                "reason": exc.reason,
            },
        )
        raise HTTPException(
            status.HTTP_429_TOO_MANY_REQUESTS,
            detail=exc.reason,
            headers={"Retry-After": str(exc.retry_after)},
        ) from exc

    pid = uuid.uuid4()
    storage_key = f"fountains/{fountain_id}/{pid}.jpg"
    thumbnail_key = f"fountains/{fountain_id}/{pid}_thumb.jpg"
    uploaded_keys: list[str] = []

    # Steps 4–6 under a single failure handler: on ANY error after the reservation exists,
    # the reservation is finalized `failed` and any uploaded objects are cleaned up.
    try:
        # 4. Read + validate (every failure here still finalizes the reservation `failed`).
        try:
            raw = await read_capped_multipart_file(request, MAX_UPLOAD_BYTES)
        except TooLarge as exc:
            raise HTTPException(
                status.HTTP_413_CONTENT_TOO_LARGE, detail="photo_too_large"
            ) from exc
        except ValueError as exc:
            raise HTTPException(
                status.HTTP_400_BAD_REQUEST, detail="invalid_multipart_body"
            ) from exc

        try:
            processed = await run_in_threadpool(process_image, raw)
        except UnsupportedImage as exc:
            raise HTTPException(
                status.HTTP_415_UNSUPPORTED_MEDIA_TYPE, detail="unsupported_image"
            ) from exc

        # 5. Upload both objects (full + thumb). Track keys so cleanup can delete on failure.
        await run_in_threadpool(storage.put_object, storage_key, processed.full, "image/jpeg")
        uploaded_keys.append(storage_key)
        await run_in_threadpool(storage.put_object, thumbnail_key, processed.thumb, "image/jpeg")
        uploaded_keys.append(thumbnail_key)

        # 6. Short txn: lock the fountain, re-check caps, insert, award, finalize, commit.
        fountain = (
            await session.execute(
                select(Fountain)
                .where(Fountain.id == fountain_id, Fountain.is_hidden.is_(False))
                .with_for_update()
            )
        ).scalar_one_or_none()
        if fountain is None:
            # The fountain was hidden/deleted between the cheap check and the lock.
            raise HTTPException(status.HTTP_404_NOT_FOUND, detail="fountain not found")

        fountain_visible = (
            await session.execute(
                select(func.count())
                .select_from(FountainPhoto)
                .where(
                    FountainPhoto.fountain_id == fountain_id,
                    FountainPhoto.is_hidden.is_(False),
                )
            )
        ).scalar_one()
        if fountain_visible >= MAX_PHOTOS_PER_FOUNTAIN:
            raise HTTPException(status.HTTP_409_CONFLICT, detail="photo_limit_fountain")

        user_visible = (
            await session.execute(
                select(func.count())
                .select_from(FountainPhoto)
                .where(
                    FountainPhoto.fountain_id == fountain_id,
                    FountainPhoto.user_id == user.id,
                    FountainPhoto.is_hidden.is_(False),
                )
            )
        ).scalar_one()
        if user_visible >= MAX_PHOTOS_PER_USER_PER_FOUNTAIN:
            raise HTTPException(status.HTTP_409_CONFLICT, detail="photo_limit_user")

        photo = FountainPhoto(
            id=pid,
            fountain_id=fountain_id,
            user_id=user.id,
            storage_key=storage_key,
            thumbnail_key=thumbnail_key,
            content_type="image/jpeg",
            width=processed.width,
            height=processed.height,
            byte_size=len(processed.full),
        )
        session.add(photo)
        await session.flush()
        # Refresh WHILE STILL IN THE TRANSACTION so `photo.created_at` (a server_default) is
        # populated before commit. Nothing DB-related may run after commit below: a failure
        # there would otherwise fall into the `except` and destroy an already-committed photo
        # (finalize it `failed`, delete its live Spaces objects, 502 a photo that exists).
        await session.refresh(photo)

        # First-photo-per-fountain point (design §7). Rebuild the location as a SQL
        # expression from lat/lng — binding the loaded WKBElement would require the optional
        # Shapely dependency (matches the add/rate/note endpoints' pattern in fountains.py).
        lat, lng = (
            await session.execute(
                select(latitude_of(Fountain.location), longitude_of(Fountain.location)).where(
                    Fountain.id == fountain_id
                )
            )
        ).one()
        await record_contributions(
            session,
            [
                ContributionSpec(
                    user_id=user.id,
                    event_type="photo_first",
                    dedup_key=dk_photo_first(fountain_id),
                    fountain_id=fountain_id,
                    location=point_geography(float(lat), float(lng)),
                    target_type="photo",
                    target_id=pid,
                )
            ],
        )
        await finalize_upload(session, reservation_id, "completed")
        await session.commit()
    except Exception as exc:
        await _cleanup_after_failure(
            session,
            storage,
            reservation_id,
            uploaded_keys,
            fountain_id=fountain_id,
            user_id=user.id,
        )
        if isinstance(exc, HTTPException):
            raise
        logger.exception(
            "photo upload failed unexpectedly",
            extra={"fountain_id": str(fountain_id), "user_id": str(user.id)},
        )
        raise HTTPException(
            status.HTTP_503_SERVICE_UNAVAILABLE, detail="photo_upload_failed"
        ) from exc

    logger.info(
        "photo uploaded",
        extra={
            "fountain_id": str(fountain_id),
            "user_id": str(user.id),
            "photo_id": str(pid),
            "byte_size": photo.byte_size,
            "width": photo.width,
            "height": photo.height,
        },
    )
    return photo_out(
        photo,
        uploaded_by=public_display_name(user.display_name, user.logto_user_id, user.nickname),
        viewer_user_id=user.id,
    )


async def _load_scoped_photo(
    session: AsyncSession, fountain_id: uuid.UUID, photo_id: uuid.UUID
) -> FountainPhoto:
    """Load a photo scoped to its parent fountain (mirrors `submit_note`/`list_notes`
    nested-fountain scoping in `fountains.py`): a photo whose `fountain_id` doesn't match
    the path 404s just like an unknown id — the nesting is authoritative, not cosmetic."""
    photo = (
        await session.execute(
            select(FountainPhoto).where(
                FountainPhoto.id == photo_id, FountainPhoto.fountain_id == fountain_id
            )
        )
    ).scalar_one_or_none()
    if photo is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="photo not found")
    return photo


@router.delete("/fountains/{fountain_id}/photos/{photo_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_own_photo(
    fountain_id: uuid.UUID,
    photo_id: uuid.UUID,
    user: User = Depends(require_named_user),
    session: AsyncSession = Depends(get_session),
    settings: Settings = Depends(get_settings),
) -> None:
    """Owner self-delete (fountain-photos design §8.2): the uploader may remove their own
    photo. Both storage objects are deleted before the row (best-effort with a durable
    `storage_cleanup` fallback on failure); the still-awarded contribution point is reversed
    BEFORE the row is deleted so the reversal can still find the event by `target_id`; this
    photo's `content_reports` are explicitly deleted in the same txn (content_id is a soft
    ref with no cascade — no `resolution` write, the report simply no longer applies to a
    photo that no longer exists)."""
    photo = await _load_scoped_photo(session, fountain_id, photo_id)
    if photo.user_id != user.id:
        logger.warning(
            "photo delete forbidden: not the owner",
            extra={
                "fountain_id": str(fountain_id),
                "photo_id": str(photo_id),
                "user_id": str(user.id),
            },
        )
        raise HTTPException(status.HTTP_403_FORBIDDEN, detail="not_photo_owner")

    storage = get_storage(settings)
    if storage is None:
        logger.warning(
            "photo delete requested but storage is disabled/misconfigured",
            extra={"fountain_id": str(fountain_id), "photo_id": str(photo_id)},
        )
        raise HTTPException(status.HTTP_503_SERVICE_UNAVAILABLE, detail="photo_delete_unavailable")

    failed_keys: list[str] = []
    for key in (photo.storage_key, photo.thumbnail_key):
        try:
            await run_in_threadpool(storage.delete_object, key)
        except Exception:
            logger.error(
                "failed to delete photo object; recording for durable cleanup",
                extra={
                    "object_key": key,
                    "fountain_id": str(fountain_id),
                    "photo_id": str(photo_id),
                },
            )
            failed_keys.append(key)

    if failed_keys:
        for key in failed_keys:
            session.add(StorageCleanup(object_key=key, reason="moderation_delete"))
        try:
            await session.commit()
        except Exception:
            await session.rollback()
            logger.exception(
                "failed to record storage_cleanup rows for photo delete failure",
                extra={"fountain_id": str(fountain_id), "photo_id": str(photo_id)},
            )
        raise HTTPException(status.HTTP_500_INTERNAL_SERVER_ERROR, detail="photo_delete_failed")

    # Reverse the still-awarded point BEFORE deleting the row: the reversal query finds the
    # `awarded` contribution_events row by `target_id`, which must still make sense as "this
    # photo's id" at the moment of the reversal (it doesn't require the row to still exist,
    # but doing it first keeps the sequence obviously correct and matches the brief).
    await reverse_contribution_for_target(session, "photo", photo_id)

    # content_id is a soft ref (no cascade), so this photo's reports must be explicitly
    # removed in the same txn — no `resolution` write needed; a report on a photo that no
    # longer exists simply ceases to exist too.
    await session.execute(
        delete(ContentReport).where(
            ContentReport.content_type == "photo", ContentReport.content_id == photo_id
        )
    )
    await session.execute(delete(FountainPhoto).where(FountainPhoto.id == photo_id))
    await session.commit()

    logger.info(
        "photo deleted by owner",
        extra={"fountain_id": str(fountain_id), "photo_id": str(photo_id), "user_id": str(user.id)},
    )


@router.post(
    "/fountains/{fountain_id}/photos/{photo_id}/report", status_code=status.HTTP_204_NO_CONTENT
)
async def report_photo(
    fountain_id: uuid.UUID,
    photo_id: uuid.UUID,
    payload: ReportContentRequest,
    user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> None:
    """Flag a photo for moderation (fountain-photos design §8.3, #11). Any signed-in user may
    report (a display name is NOT required — unlike contribution-earning actions). Target-
    existence 404 precedes the report handling; the shared chokepoint then validates the
    category (422), dedupes (a duplicate pending report is an idempotent 204 that consumes no
    rate budget, so a double-tap in a flaky client never poisons the async session), and rate-
    limits a genuinely new report (429)."""
    # Reports may target a hidden photo too (a moderator may still want more signal), so this
    # deliberately does NOT reuse `_load_visible_photo` — only the nested fountain scoping.
    photo = await _load_scoped_photo(session, fountain_id, photo_id)
    await create_content_report(
        session,
        content_type="photo",
        content_id=photo.id,
        fountain_id=fountain_id,
        reporter_user_id=user.id,
        category=payload.category,
        note=payload.note,
    )
