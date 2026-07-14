import logging
import uuid
from datetime import UTC, datetime

from fastapi import APIRouter, Depends, HTTPException, Query, Response, status
from fastapi.concurrency import run_in_threadpool
from sqlalchemy import and_, delete, distinct, exists, func, or_, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth import require_admin
from app.config import Settings, get_settings
from app.contributions import (
    reactivate_contribution_for_target,
    reverse_contribution_for_target,
    reverse_contributions,
)
from app.db import get_session
from app.display import public_display_name
from app.geo import point_geography
from app.locks import ADD_FOUNTAIN_LOCK_KEY
from app.membership import recompute_fountain_membership, recompute_place_counts
from app.models import ContentReport, Fountain, FountainNote, FountainPhoto, StorageCleanup, User
from app.ranking import recompute_fountain_ranking
from app.routers.fountains import serialize_fountain_detail
from app.schemas import (
    AdminFountainDetail,
    AdminFountainPatch,
    AdminNoteOut,
    AdminNotePatch,
    AdminPhotoOut,
    AdminPhotoPatch,
    PhotoReportsSummary,
    ReportDismissRequest,
    ReportedContentOut,
    ReportedPhotoOut,
    ReportsSummary,
)
from app.storage import get_storage

router = APIRouter(
    prefix="/api/v1/admin",
    tags=["admin"],
    dependencies=[Depends(require_admin)],
)
logger = logging.getLogger(__name__)


def _admin_context(admin: User) -> dict[str, str]:
    return {"admin_sub": admin.logto_user_id, "admin_user_id": str(admin.id)}


async def _serialize_admin_note(note: FountainNote, author: User) -> AdminNoteOut:
    return AdminNoteOut(
        id=note.id,
        body=note.body,
        author_display_name=public_display_name(
            author.display_name, author.logto_user_id, author.nickname
        ),
        is_hidden=note.is_hidden,
        created_at=note.created_at,
        updated_at=note.updated_at,
    )


async def _serialize_admin_fountain(
    session: AsyncSession, fountain: Fountain, admin: User
) -> AdminFountainDetail:
    # Pass the admin's user_id so dimensions[].your_rating is populated: admins read this
    # endpoint instead of the public detail, and the rating form must still pre-fill (#114).
    public_detail = await serialize_fountain_detail(session, fountain, user_id=admin.id)
    note_rows = (
        await session.execute(
            select(FountainNote, User)
            .join(User, User.id == FountainNote.user_id)
            .where(FountainNote.fountain_id == fountain.id)
            .order_by(FountainNote.created_at.desc(), FountainNote.id.desc())
        )
    ).all()
    notes = [await _serialize_admin_note(note, author) for note, author in note_rows]
    return AdminFountainDetail(
        **public_detail.model_dump(),
        is_hidden=fountain.is_hidden,
        notes=notes,
    )


@router.get("/fountains/{fountain_id}", response_model=AdminFountainDetail)
async def admin_fountain_detail(
    fountain_id: uuid.UUID,
    session: AsyncSession = Depends(get_session),
    admin: User = Depends(require_admin),
) -> AdminFountainDetail:
    fountain = (
        await session.execute(select(Fountain).where(Fountain.id == fountain_id))
    ).scalar_one_or_none()
    if fountain is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="fountain not found")
    return await _serialize_admin_fountain(session, fountain, admin)


@router.patch("/fountains/{fountain_id}", response_model=AdminFountainDetail)
async def admin_patch_fountain(
    fountain_id: uuid.UUID,
    payload: AdminFountainPatch,
    session: AsyncSession = Depends(get_session),
    admin: User = Depends(require_admin),
) -> AdminFountainDetail:
    # Serialize this mutation's precomputed-membership recompute with concurrent adds / imports /
    # full refreshes (they all share the denormalized place counts) — the same advisory lock
    # POST /fountains and the OSM import take. Acquire it BEFORE the row lock so lock order is
    # consistent (advisory first, then row) and no deadlock is possible (#127 Slice 1d).
    await session.execute(select(func.pg_advisory_xact_lock(ADD_FOUNTAIN_LOCK_KEY)))
    fountain = (
        await session.execute(select(Fountain).where(Fountain.id == fountain_id).with_for_update())
    ).scalar_one_or_none()
    if fountain is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="fountain not found")

    changes: dict[str, dict[str, object | None]] = {}
    recompute_ranking = False
    resolved_reports = 0
    if "location" in payload.model_fields_set:
        if payload.location is None:
            raise HTTPException(
                status.HTTP_422_UNPROCESSABLE_CONTENT,
                detail="location cannot be null",
            )
        before_detail = await serialize_fountain_detail(session, fountain)
        before = before_detail.location.model_dump()
        after = payload.location.model_dump()
        if before != after:
            fountain.location = point_geography(
                payload.location.latitude,
                payload.location.longitude,
            )
            changes["location"] = {"before": before, "after": after}
    if "is_working" in payload.model_fields_set:
        if payload.is_working is None:
            raise HTTPException(
                status.HTTP_422_UNPROCESSABLE_CONTENT,
                detail="is_working cannot be null",
            )
    if "is_working" in payload.model_fields_set and fountain.is_working != payload.is_working:
        changes["is_working"] = {"before": fountain.is_working, "after": payload.is_working}
        fountain.is_working = bool(payload.is_working)
        recompute_ranking = True
    if (
        "placement_note" in payload.model_fields_set
        and fountain.placement_note != payload.placement_note
    ):
        changes["placement_note"] = {
            "before": fountain.placement_note,
            "after": payload.placement_note,
        }
        fountain.placement_note = payload.placement_note
    if "comments" in payload.model_fields_set and fountain.comments != payload.comments:
        changes["comments"] = {"before": fountain.comments, "after": payload.comments}
        fountain.comments = payload.comments
    if "is_hidden" in payload.model_fields_set:
        if payload.is_hidden is None:
            raise HTTPException(
                status.HTTP_422_UNPROCESSABLE_CONTENT,
                detail="is_hidden cannot be null",
            )
    if "is_hidden" in payload.model_fields_set and fountain.is_hidden != payload.is_hidden:
        changes["is_hidden"] = {"before": fountain.is_hidden, "after": payload.is_hidden}
        fountain.is_hidden = bool(payload.is_hidden)
        # On a false->true hide, resolve this fountain's pending fountain-type reports (NOT the
        # note/photo reports under it — those are separate queue items) (#12, spec §4).
        if fountain.is_hidden:
            resolved_reports = await _resolve_pending_reports(
                session, "fountain", fountain.id, admin, "hidden"
            )

    if recompute_ranking:
        await recompute_fountain_ranking(session, fountain.id)
    # A move (location) or a hide/unhide changes the precomputed membership and/or the non-hidden
    # fountain_count, so re-derive them for this fountain (and re-canonicalize its slug group)
    # before commit — the public place counts must not go stale (#127 Slice 1d).
    if "location" in changes or "is_hidden" in changes:
        await session.flush()
        await recompute_fountain_membership(session, fountain.id)
    await session.commit()
    await session.refresh(fountain)

    action = "edit"
    if set(changes) == {"is_hidden"}:
        action = "hide" if fountain.is_hidden else "unhide"
    logger.info(
        "admin fountain mutation",
        extra={
            **_admin_context(admin),
            "action": action,
            "target_type": "fountain",
            "target_id": str(fountain.id),
            "changed_fields": changes,
            "resolved_reports": resolved_reports,
        },
    )
    return await _serialize_admin_fountain(session, fountain, admin)


@router.delete("/fountains/{fountain_id}", status_code=status.HTTP_204_NO_CONTENT)
async def admin_delete_fountain(
    fountain_id: uuid.UUID,
    session: AsyncSession = Depends(get_session),
    admin: User = Depends(require_admin),
) -> Response:
    # Advisory lock (see admin_patch_fountain): serialize the place-count recompute with concurrent
    # adds / imports / full refreshes; acquire before the row lock so lock order is consistent.
    await session.execute(select(func.pg_advisory_xact_lock(ADD_FOUNTAIN_LOCK_KEY)))
    fountain = (
        await session.execute(select(Fountain).where(Fountain.id == fountain_id).with_for_update())
    ).scalar_one_or_none()
    if fountain is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="fountain not found")
    # Capture the deleted fountain's places so their fountain_count (and canonical winner) can be
    # corrected after the row is gone (#127 Slice 1d).
    old_place_ids = [fountain.country_place_id, fountain.region_place_id, fountain.city_place_id]
    # Enqueue durable storage_cleanup rows for every photo's Spaces objects BEFORE the delete
    # cascades the fountain_photos ROWS away (fk_fountain_photos_fountain is ON DELETE CASCADE) —
    # otherwise the objects are orphaned in the private bucket with no ledger row for the sweep
    # worker to find them by (design §3.3: no silent orphan). Includes hidden photos; the actual
    # Spaces deletes are NOT done inline here, only enqueued for the sweep.
    photo_keys = (
        await session.execute(
            select(FountainPhoto.storage_key, FountainPhoto.thumbnail_key).where(
                FountainPhoto.fountain_id == fountain_id
            )
        )
    ).all()
    for storage_key, thumbnail_key in photo_keys:
        session.add(StorageCleanup(object_key=storage_key, reason="moderation_delete"))
        session.add(StorageCleanup(object_key=thumbnail_key, reason="moderation_delete"))
    # Reverse every contribution tied to this fountain BEFORE deleting it (#119 anti-gaming):
    # removing the content must not let its points persist on the leaderboard. Must run first
    # because contribution_events.fountain_id is ON DELETE SET NULL — once the fountain row is
    # gone the events can no longer be found by fountain_id.
    reversed_events = await reverse_contributions(session, fountain_id)
    await session.delete(fountain)
    await session.flush()  # the row must be gone before its old places are recounted
    await recompute_place_counts(session, old_place_ids)
    await session.commit()
    logger.info(
        "admin fountain mutation",
        extra={
            **_admin_context(admin),
            "action": "delete",
            "target_type": "fountain",
            "target_id": str(fountain_id),
            "changed_fields": {"reversed_contribution_events": reversed_events},
        },
    )
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.patch("/notes/{note_id}", response_model=AdminNoteOut)
async def admin_patch_note(
    note_id: uuid.UUID,
    payload: AdminNotePatch,
    session: AsyncSession = Depends(get_session),
    admin: User = Depends(require_admin),
) -> AdminNoteOut:
    row = (
        await session.execute(
            select(FountainNote, User)
            .join(User, User.id == FountainNote.user_id)
            .where(FountainNote.id == note_id)
            .with_for_update()
        )
    ).one_or_none()
    if row is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="note not found")
    note, author = row
    before_hidden = note.is_hidden
    resolved_reports = 0
    if payload.is_hidden:
        # Resolve this note's pending reports only on the false->true transition (an already-hidden
        # note's reports were resolved on the first hide) — mirrors admin_patch_photo (#12).
        if not note.is_hidden:
            note.hidden_by_user_id = admin.id
            note.hidden_at = datetime.now(tz=UTC)
            note.is_hidden = True
            resolved_reports = await _resolve_pending_reports(
                session, "note", note.id, admin, "hidden"
            )
    else:
        note.is_hidden = False
        note.hidden_by_user_id = None
        note.hidden_at = None
    await session.commit()
    await session.refresh(note)
    logger.info(
        "admin note mutation",
        extra={
            **_admin_context(admin),
            "action": "hide" if note.is_hidden else "unhide",
            "target_type": "note",
            "target_id": str(note.id),
            "changed_fields": {
                "is_hidden": {"before": before_hidden, "after": note.is_hidden},
                "body_length": len(note.body),
                "resolved_reports": resolved_reports,
            },
        },
    )
    return await _serialize_admin_note(note, author)


# --- photo moderation (fountain-photos design §8.4) --------------------------------
# The queue exposes the free-text report `note` (admin-only PII). It is truncated to
# MAX_NOTE_CHARS *in SQL* (so the untruncated text never leaves the DB), capped at the
# MAX_NOTES_PER_PHOTO newest per photo, and NEVER logged.
MAX_NOTE_CHARS = 200
MAX_NOTES_PER_PHOTO = 3


@router.get("/photo-reports", response_model=list[ReportedPhotoOut])
async def admin_photo_reports(
    limit: int = Query(default=50, ge=1, le=200),
    offset: int = Query(default=0, ge=0),
    session: AsyncSession = Depends(get_session),
    admin: User = Depends(require_admin),
) -> list[ReportedPhotoOut]:
    """Moderation queue: one row per photo that has ≥1 pending report, oldest-reported first,
    paginated. Two-part query bounds the admin-only PII notes: a grouped aggregate for the
    counts/categories/first-reported, then a windowed fetch of the 3 newest truncated notes for
    only the page's photos. Notes are truncated in SQL and never logged."""
    # (1) Grouped aggregate over PENDING photo reports, joined to the photo so a report
    # orphaned by an explicitly-deleted photo can never surface. `content_reports` is
    # polymorphic; this queue stays photo-only (content_type='photo'), so the grouped id is
    # ContentReport.content_id, labeled back to photo_id for ReportedPhotoOut (generalizing
    # the queue is #12). Oldest pending report first; page-bounded.
    grouped = (
        select(
            ContentReport.content_id.label("photo_id"),
            func.count().label("report_count"),
            func.array_agg(distinct(ContentReport.category)).label("categories"),
            func.min(ContentReport.created_at).label("first_reported_at"),
        )
        .join(FountainPhoto, FountainPhoto.id == ContentReport.content_id)
        .where(ContentReport.content_type == "photo", ContentReport.status == "pending")
        .group_by(ContentReport.content_id)
        # Deterministic tiebreak on content_id: two photos whose oldest pending report share an
        # exact timestamp would otherwise reorder across limit/offset pages (skip/dup risk at
        # a page boundary).
        .order_by(func.min(ContentReport.created_at).asc(), ContentReport.content_id)
        .limit(limit)
        .offset(offset)
    )
    group_rows = (await session.execute(grouped)).all()
    if not group_rows:
        return []
    page_ids = [row.photo_id for row in group_rows]

    # (2a) Photo + uploader details for the page's photos.
    detail_rows = (
        await session.execute(
            select(
                FountainPhoto.id,
                FountainPhoto.fountain_id,
                FountainPhoto.is_hidden,
                User.display_name,
                User.logto_user_id,
                User.nickname,
            )
            .join(User, User.id == FountainPhoto.user_id)
            .where(FountainPhoto.id.in_(page_ids))
        )
    ).all()
    details = {row.id: row for row in detail_rows}

    # (2b) The 3 newest NON-NULL notes per page photo, each truncated to 200 chars IN SQL via
    # left(note, 200) so the untruncated free text never leaves the DB. A windowed row_number
    # bounds it to 3 without a per-row LATERAL.
    rn = (
        func.row_number()
        .over(
            partition_by=ContentReport.content_id,
            order_by=ContentReport.created_at.desc(),
        )
        .label("rn")
    )
    ranked_notes = (
        select(
            ContentReport.content_id.label("photo_id"),
            func.left(ContentReport.note, MAX_NOTE_CHARS).label("note"),
            rn,
        )
        .where(
            ContentReport.content_type == "photo",
            ContentReport.status == "pending",
            ContentReport.content_id.in_(page_ids),
            ContentReport.note.isnot(None),
        )
        .subquery()
    )
    note_rows = (
        await session.execute(
            select(ranked_notes.c.photo_id, ranked_notes.c.note)
            .where(ranked_notes.c.rn <= MAX_NOTES_PER_PHOTO)
            .order_by(ranked_notes.c.photo_id, ranked_notes.c.rn)
        )
    ).all()
    notes_by_photo: dict[uuid.UUID, list[str]] = {}
    for row in note_rows:
        notes_by_photo.setdefault(row.photo_id, []).append(row.note)

    result: list[ReportedPhotoOut] = []
    for row in group_rows:
        detail = details.get(row.photo_id)
        if detail is None:
            continue
        result.append(
            ReportedPhotoOut(
                photo_id=row.photo_id,
                fountain_id=detail.fountain_id,
                url=f"/api/v1/photos/{row.photo_id}",
                thumbnail_url=f"/api/v1/photos/{row.photo_id}/thumb",
                is_hidden=detail.is_hidden,
                report_count=row.report_count,
                categories=list(row.categories),
                notes=notes_by_photo.get(row.photo_id, []),
                first_reported_at=row.first_reported_at,
                uploaded_by=public_display_name(
                    detail.display_name, detail.logto_user_id, detail.nickname
                ),
            )
        )
    # Deliberately logs only ids/counts — NEVER the notes (admin-only PII).
    logger.info(
        "admin photo queue read",
        extra={**_admin_context(admin), "returned": len(result), "limit": limit, "offset": offset},
    )
    return result


@router.get("/photo-reports/summary", response_model=PhotoReportsSummary)
async def admin_photo_reports_summary(
    session: AsyncSession = Depends(get_session),
    admin: User = Depends(require_admin),
) -> PhotoReportsSummary:
    """Badge count: the number of DISTINCT photos with ≥1 pending report."""
    count = (
        await session.execute(
            select(func.count(distinct(ContentReport.content_id))).where(
                ContentReport.content_type == "photo",
                ContentReport.status == "pending",
            )
        )
    ).scalar_one()
    return PhotoReportsSummary(pending_photo_count=count)


async def _resolve_pending_reports(
    session: AsyncSession,
    content_type: str,
    content_id: uuid.UUID,
    admin: User,
    resolution: str,
) -> int:
    """Resolve every still-pending report on a content item (photo/note/fountain) with the given
    resolution (`hidden` on a moderation hide, `rejected` on a dismiss). Returns the number
    resolved. Photo callers pass `content_type='photo'`; note/fountain hide + the generalized
    dismiss pass their own type (#12)."""
    result = await session.execute(
        update(ContentReport)
        .where(
            ContentReport.content_type == content_type,
            ContentReport.content_id == content_id,
            ContentReport.status == "pending",
        )
        .values(
            status="resolved",
            resolution=resolution,
            resolved_by_user_id=admin.id,
            resolved_at=datetime.now(tz=UTC),
        )
    )
    return result.rowcount or 0


@router.patch("/photos/{photo_id}", response_model=AdminPhotoOut)
async def admin_patch_photo(
    photo_id: uuid.UUID,
    payload: AdminPhotoPatch,
    session: AsyncSession = Depends(get_session),
    admin: User = Depends(require_admin),
) -> AdminPhotoOut:
    """Hide/unhide a photo (clones `admin_patch_note`). On HIDE: stamp `hidden_by/at`, resolve
    this photo's pending reports (`resolution='hidden'`), and reverse the first-photo point — the
    gated read then 404s (is_hidden=true, B11). On UNHIDE: clear the stamps and re-award the point;
    already-resolved reports stay resolved."""
    photo = (
        await session.execute(
            select(FountainPhoto).where(FountainPhoto.id == photo_id).with_for_update()
        )
    ).scalar_one_or_none()
    if photo is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="photo not found")

    before_hidden = photo.is_hidden
    resolved_reports = 0
    if payload.is_hidden:
        if not photo.is_hidden:
            photo.hidden_by_user_id = admin.id
            photo.hidden_at = datetime.now(tz=UTC)
            photo.is_hidden = True
            resolved_reports = await _resolve_pending_reports(
                session, "photo", photo_id, admin, "hidden"
            )
            await reverse_contribution_for_target(session, "photo", photo_id)
    else:
        if photo.is_hidden:
            photo.is_hidden = False
            photo.hidden_by_user_id = None
            photo.hidden_at = None
            await reactivate_contribution_for_target(session, "photo", photo_id)
    await session.commit()
    await session.refresh(photo)

    logger.info(
        "admin photo mutation",
        extra={
            **_admin_context(admin),
            "action": "hide" if photo.is_hidden else "unhide",
            "target_type": "photo",
            "target_id": str(photo.id),
            "changed_fields": {
                "is_hidden": {"before": before_hidden, "after": photo.is_hidden},
                "resolved_reports": resolved_reports,
            },
        },
    )
    return AdminPhotoOut(id=photo.id, is_hidden=photo.is_hidden, hidden_at=photo.hidden_at)


@router.post("/photos/{photo_id}/dismiss-reports", status_code=status.HTTP_204_NO_CONTENT)
async def admin_dismiss_photo_reports(
    photo_id: uuid.UUID,
    session: AsyncSession = Depends(get_session),
    admin: User = Depends(require_admin),
) -> Response:
    """Reject a photo's pending reports without touching the photo — it stays visible. The
    reports flip to `resolved`/`rejected`; the photo drops out of the queue."""
    exists = (
        await session.execute(select(FountainPhoto.id).where(FountainPhoto.id == photo_id))
    ).scalar_one_or_none()
    if exists is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="photo not found")

    resolved = await _resolve_pending_reports(session, "photo", photo_id, admin, "rejected")
    await session.commit()
    logger.info(
        "admin photo mutation",
        extra={
            **_admin_context(admin),
            "action": "dismiss_reports",
            "target_type": "photo",
            "target_id": str(photo_id),
            "changed_fields": {"resolved_reports": resolved},
        },
    )
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.delete("/photos/{photo_id}", status_code=status.HTTP_204_NO_CONTENT)
async def admin_delete_photo(
    photo_id: uuid.UUID,
    session: AsyncSession = Depends(get_session),
    admin: User = Depends(require_admin),
    settings: Settings = Depends(get_settings),
) -> Response:
    """Hard-delete a photo (mirrors the owner self-delete in `photos.py`): delete BOTH Spaces
    objects first — a delete failure is escalated to a durable `storage_cleanup` row and a 5xx
    (never a silent success) — then reverse the still-awarded point BEFORE deleting the row (so
    the reversal can still find the event by `target_id`), then explicitly delete this photo's
    `content_reports` (content_id is a soft ref with no cascade) and finally the row."""
    photo = (
        await session.execute(select(FountainPhoto).where(FountainPhoto.id == photo_id))
    ).scalar_one_or_none()
    if photo is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="photo not found")

    storage = get_storage(settings)
    if storage is None:
        logger.warning(
            "admin photo delete requested but storage is disabled/misconfigured",
            extra={**_admin_context(admin), "photo_id": str(photo_id)},
        )
        raise HTTPException(status.HTTP_503_SERVICE_UNAVAILABLE, detail="photo_delete_unavailable")

    storage_key, thumbnail_key = photo.storage_key, photo.thumbnail_key
    failed_keys: list[str] = []
    for key in (storage_key, thumbnail_key):
        try:
            await run_in_threadpool(storage.delete_object, key)
        except Exception:
            logger.error(
                "failed to delete photo object; recording for durable cleanup",
                extra={**_admin_context(admin), "object_key": key, "photo_id": str(photo_id)},
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
                "failed to record storage_cleanup rows for admin photo delete failure",
                extra={**_admin_context(admin), "photo_id": str(photo_id)},
            )
        raise HTTPException(status.HTTP_500_INTERNAL_SERVER_ERROR, detail="photo_delete_failed")

    # Reverse the still-awarded point BEFORE deleting the row (find the event by target_id).
    await reverse_contribution_for_target(session, "photo", photo_id)
    # content_id is a soft ref (no cascade), so this photo's reports must be explicitly removed
    # in the same txn as the row delete.
    await session.execute(
        delete(ContentReport).where(
            ContentReport.content_type == "photo", ContentReport.content_id == photo_id
        )
    )
    await session.execute(delete(FountainPhoto).where(FountainPhoto.id == photo_id))
    await session.commit()

    logger.info(
        "admin photo mutation",
        extra={
            **_admin_context(admin),
            "action": "delete",
            "target_type": "photo",
            "target_id": str(photo_id),
        },
    )
    return Response(status_code=status.HTTP_204_NO_CONTENT)


# --- unified moderation queue (#12) --------------------------------------------------
# The queue/summary/dismiss below are added ALONGSIDE the photo-only routes above (old mobile
# clients still call those). `content_reports` is polymorphic; a per-type EXISTS predicate
# excludes reports orphaned by a since-deleted target (the #11 invariants already preclude such
# orphans — this is defensive and, running before LIMIT/OFFSET, it also keeps the queue page and
# the badge count consistent by construction).

CONTENT_TYPES = ("photo", "note", "fountain")
_EXISTENCE_MODEL = {"photo": FountainPhoto, "note": FountainNote, "fountain": Fountain}


def _content_exists_clause():
    """A correlated per-type EXISTS: the reported content row still exists for its content_type."""
    return or_(
        and_(
            ContentReport.content_type == "photo",
            exists(select(FountainPhoto.id).where(FountainPhoto.id == ContentReport.content_id)),
        ),
        and_(
            ContentReport.content_type == "note",
            exists(select(FountainNote.id).where(FountainNote.id == ContentReport.content_id)),
        ),
        and_(
            ContentReport.content_type == "fountain",
            exists(select(Fountain.id).where(Fountain.id == ContentReport.content_id)),
        ),
    )


@router.get("/reports", response_model=list[ReportedContentOut])
async def admin_reports(
    limit: int = Query(default=50, ge=1, le=200),
    offset: int = Query(default=0, ge=0),
    content_type: str | None = Query(default=None),
    session: AsyncSession = Depends(get_session),
    admin: User = Depends(require_admin),
) -> list[ReportedContentOut]:
    """Unified moderation queue: one row per (content_type, content_id) with ≥1 pending report,
    across photo/note/fountain, oldest-reported first, paginated, optional content_type filter.
    Generalizes the photo-only ``admin_photo_reports`` (#12). Report notes are truncated in SQL
    and never logged."""
    if content_type is not None and content_type not in CONTENT_TYPES:
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_CONTENT, detail=f"invalid content_type: {content_type}"
        )

    where = [ContentReport.status == "pending", _content_exists_clause()]
    if content_type is not None:
        where.append(ContentReport.content_type == content_type)

    # (1) Grouped aggregate over pending, existing reports. Deterministic tiebreak on
    # (content_type, content_id) so pagination never skips/dups when two items' oldest report
    # share a timestamp.
    grouped = (
        select(
            ContentReport.content_type,
            ContentReport.content_id,
            func.count().label("report_count"),
            func.array_agg(distinct(ContentReport.category)).label("categories"),
            func.min(ContentReport.created_at).label("first_reported_at"),
        )
        .where(*where)
        .group_by(ContentReport.content_type, ContentReport.content_id)
        .order_by(
            func.min(ContentReport.created_at).asc(),
            ContentReport.content_type,
            ContentReport.content_id,
        )
        .limit(limit)
        .offset(offset)
    )
    group_rows = (await session.execute(grouped)).all()
    if not group_rows:
        return []
    page_ids = [row.content_id for row in group_rows]
    ids_by_type: dict[str, list[uuid.UUID]] = {}
    for row in group_rows:
        ids_by_type.setdefault(row.content_type, []).append(row.content_id)

    # (2) The 3 newest non-null report notes per page item, truncated to 200 chars IN SQL. Keyed
    # by (content_type, content_id). content_ids are globally-unique UUIDs, so the IN filter is
    # on content_id; the key still carries content_type for a defensive exact match.
    rn = (
        func.row_number()
        .over(
            partition_by=(ContentReport.content_type, ContentReport.content_id),
            order_by=ContentReport.created_at.desc(),
        )
        .label("rn")
    )
    ranked_notes = (
        select(
            ContentReport.content_type.label("content_type"),
            ContentReport.content_id.label("content_id"),
            func.left(ContentReport.note, MAX_NOTE_CHARS).label("note"),
            rn,
        )
        .where(
            ContentReport.status == "pending",
            ContentReport.note.isnot(None),
            ContentReport.content_id.in_(page_ids),
        )
        .subquery()
    )
    note_rows = (
        await session.execute(
            select(ranked_notes.c.content_type, ranked_notes.c.content_id, ranked_notes.c.note)
            .where(ranked_notes.c.rn <= MAX_NOTES_PER_PHOTO)
            .order_by(ranked_notes.c.content_type, ranked_notes.c.content_id, ranked_notes.c.rn)
        )
    ).all()
    notes_by_key: dict[tuple[str, uuid.UUID], list[str]] = {}
    for row in note_rows:
        notes_by_key.setdefault((row.content_type, row.content_id), []).append(row.note)

    # (3) Per-type detail fetch (one query per present type).
    details: dict[tuple[str, uuid.UUID], dict[str, object]] = {}
    if photo_ids := ids_by_type.get("photo"):
        for r in (
            await session.execute(
                select(
                    FountainPhoto.id,
                    FountainPhoto.fountain_id,
                    FountainPhoto.is_hidden,
                    User.display_name,
                    User.logto_user_id,
                    User.nickname,
                )
                .join(User, User.id == FountainPhoto.user_id)
                .where(FountainPhoto.id.in_(photo_ids))
            )
        ).all():
            details[("photo", r.id)] = {
                "fountain_id": r.fountain_id,
                "is_hidden": r.is_hidden,
                "contributor": public_display_name(r.display_name, r.logto_user_id, r.nickname),
                "thumbnail_url": f"/api/v1/photos/{r.id}/thumb",
                "url": f"/api/v1/photos/{r.id}",
            }
    if note_ids := ids_by_type.get("note"):
        for r in (
            await session.execute(
                select(
                    FountainNote.id,
                    FountainNote.fountain_id,
                    FountainNote.is_hidden,
                    func.left(FountainNote.body, MAX_NOTE_CHARS).label("excerpt"),
                    User.display_name,
                    User.logto_user_id,
                    User.nickname,
                )
                .join(User, User.id == FountainNote.user_id)
                .where(FountainNote.id.in_(note_ids))
            )
        ).all():
            details[("note", r.id)] = {
                "fountain_id": r.fountain_id,
                "is_hidden": r.is_hidden,
                "contributor": public_display_name(r.display_name, r.logto_user_id, r.nickname),
                "excerpt": r.excerpt,
            }
    if fountain_ids := ids_by_type.get("fountain"):
        for r in (
            await session.execute(
                select(Fountain.id, Fountain.is_hidden, Fountain.placement_note).where(
                    Fountain.id.in_(fountain_ids)
                )
            )
        ).all():
            details[("fountain", r.id)] = {
                "fountain_id": r.id,
                "is_hidden": r.is_hidden,
                "fountain_label": r.placement_note,
            }

    result: list[ReportedContentOut] = []
    for row in group_rows:
        key = (row.content_type, row.content_id)
        detail = details.get(key)
        if detail is None:
            # Belt-and-suspenders: the EXISTS predicate already excludes orphans, so this cannot
            # normally fire. Never silently drop — log it (no note text).
            logger.warning(
                "moderation queue: reported content row missing; skipping",
                extra={
                    **_admin_context(admin),
                    "content_type": row.content_type,
                    "content_id": str(row.content_id),
                },
            )
            continue
        result.append(
            ReportedContentOut(
                content_type=row.content_type,
                content_id=row.content_id,
                fountain_id=detail["fountain_id"],
                is_hidden=detail["is_hidden"],
                report_count=row.report_count,
                categories=list(row.categories),
                notes=notes_by_key.get(key, []),
                first_reported_at=row.first_reported_at,
                contributor=detail.get("contributor"),
                thumbnail_url=detail.get("thumbnail_url"),
                url=detail.get("url"),
                excerpt=detail.get("excerpt"),
                fountain_label=detail.get("fountain_label"),
            )
        )
    # Deliberately logs only counts — NEVER the notes (admin-only PII).
    logger.info(
        "admin unified queue read",
        extra={**_admin_context(admin), "returned": len(result), "limit": limit, "offset": offset},
    )
    return result


@router.get("/reports/summary", response_model=ReportsSummary)
async def admin_reports_summary(
    session: AsyncSession = Depends(get_session),
    admin: User = Depends(require_admin),
) -> ReportsSummary:
    """Badge count: distinct (content_type, content_id) items with ≥1 pending report, across all
    types, using the same EXISTS predicate as the queue so the badge and queue agree (#12)."""
    distinct_items = (
        select(ContentReport.content_type, ContentReport.content_id)
        .where(ContentReport.status == "pending", _content_exists_clause())
        .distinct()
        .subquery()
    )
    count = (await session.execute(select(func.count()).select_from(distinct_items))).scalar_one()
    return ReportsSummary(pending_count=count)


@router.post("/reports/dismiss", status_code=status.HTTP_204_NO_CONTENT)
async def admin_dismiss_reports(
    payload: ReportDismissRequest,
    session: AsyncSession = Depends(get_session),
    admin: User = Depends(require_admin),
) -> Response:
    """Generalized reject: resolve an item's pending reports as ``rejected`` without hiding or
    deleting it, for any content type. Validates the target still exists (404 if missing),
    matching ``admin_dismiss_photo_reports``. The new web/mobile boards use this for all types;
    the old photo dismiss endpoint stays for released clients (#12)."""
    model = _EXISTENCE_MODEL.get(payload.content_type)
    if model is None:
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail=f"invalid content_type: {payload.content_type}",
        )
    target = (
        await session.execute(select(model.id).where(model.id == payload.content_id))
    ).scalar_one_or_none()
    if target is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail=f"{payload.content_type} not found")

    resolved = await _resolve_pending_reports(
        session, payload.content_type, payload.content_id, admin, "rejected"
    )
    await session.commit()
    logger.info(
        "admin dismiss reports",
        extra={
            **_admin_context(admin),
            "action": "dismiss_reports",
            "target_type": payload.content_type,
            "target_id": str(payload.content_id),
            "changed_fields": {"resolved_reports": resolved},
        },
    )
    return Response(status_code=status.HTTP_204_NO_CONTENT)
