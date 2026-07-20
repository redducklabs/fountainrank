import base64
import binascii
import json
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
    reverse_first_rating_bonus_for_actor,
)
from app.db import get_session
from app.display import public_display_name
from app.geo import point_geography
from app.locks import ADD_FOUNTAIN_LOCK_KEY, InteractiveWriteBusy, interactive_lock_timeout
from app.membership import recompute_fountain_membership, recompute_place_counts
from app.models import (
    ContentReport,
    ContributionEvent,
    Fountain,
    FountainNote,
    FountainPhoto,
    ModerationAction,
    Rating,
    RatingType,
    StorageCleanup,
    User,
    UserContributionStats,
)
from app.ranking import recompute_fountain_ranking
from app.routers.fountains import BUSY_RESPONSE, busy_exception, serialize_fountain_detail
from app.schemas import (
    AdminContributionEventOut,
    AdminContributorHistoryOut,
    AdminFountainDetail,
    AdminFountainPatch,
    AdminNoteOut,
    AdminNotePatch,
    AdminPhotoOut,
    AdminPhotoPatch,
    AdminRatingOut,
    AdminSanctionOut,
    AdminSanctionRequest,
    ContributionStatsOut,
    ModerationReasonRequest,
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

_SAFE_CONTRIBUTION_METADATA = frozenset({"rating_type_id", "attribute_type_id", "status"})


def _encode_contribution_cursor(created_at: datetime, event_id: uuid.UUID) -> str:
    payload = json.dumps([created_at.isoformat(), str(event_id)], separators=(",", ":")).encode()
    return base64.urlsafe_b64encode(payload).rstrip(b"=").decode()


def _decode_contribution_cursor(cursor: str) -> tuple[datetime, uuid.UUID]:
    try:
        padding = "=" * (-len(cursor) % 4)
        raw = base64.urlsafe_b64decode(cursor + padding)
        timestamp, event_id = json.loads(raw)
        created_at = datetime.fromisoformat(timestamp)
        if created_at.tzinfo is None:
            raise ValueError("cursor timestamp must have timezone")
        return created_at, uuid.UUID(event_id)
    except (ValueError, TypeError, json.JSONDecodeError, binascii.Error) as exc:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, detail="invalid cursor") from exc


def _admin_context(admin: User) -> dict[str, str]:
    return {"admin_sub": admin.logto_user_id, "admin_user_id": str(admin.id)}


@router.get("/contributors/{user_id}/contributions", response_model=AdminContributorHistoryOut)
async def admin_contributor_history(
    user_id: uuid.UUID,
    response: Response,
    limit: int = Query(default=50, ge=1, le=100),
    cursor: str | None = Query(default=None, min_length=1, max_length=500),
    session: AsyncSession = Depends(get_session),
    admin: User = Depends(require_admin),
) -> AdminContributorHistoryOut:
    """Newest-first contribution-event audit log for one user, including reversals."""
    response.headers["Cache-Control"] = "private, no-store"
    target = (await session.execute(select(User).where(User.id == user_id))).scalar_one_or_none()
    if target is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="user not found")

    stats = (
        await session.execute(
            select(UserContributionStats).where(UserContributionStats.user_id == user_id)
        )
    ).scalar_one_or_none()
    statement = select(ContributionEvent).where(ContributionEvent.user_id == user_id)
    if cursor is not None:
        cursor_at, cursor_id = _decode_contribution_cursor(cursor)
        # The compound predicate is evaluated by Postgres and exactly mirrors both DESC keys.
        statement = statement.where(
            or_(
                ContributionEvent.created_at < cursor_at,
                and_(
                    ContributionEvent.created_at == cursor_at,
                    ContributionEvent.id < cursor_id,
                ),
            )
        )
    db_events = (
        (
            await session.execute(
                statement.order_by(
                    ContributionEvent.created_at.desc(), ContributionEvent.id.desc()
                ).limit(limit + 1)
            )
        )
        .scalars()
        .all()
    )
    has_more = len(db_events) > limit
    page = db_events[:limit]
    events = [
        AdminContributionEventOut(
            id=event.id,
            event_type=event.event_type,
            points=event.points,
            status=event.status,
            fountain_id=event.fountain_id,
            target_type=event.target_type,
            target_id=event.target_id,
            metadata={
                key: value
                for key, value in (event.event_metadata or {}).items()
                if key in _SAFE_CONTRIBUTION_METADATA
                and (value is None or isinstance(value, (str, int, float, bool)))
            },
            created_at=event.created_at,
        )
        for event in page
    ]
    next_cursor = (
        _encode_contribution_cursor(page[-1].created_at, page[-1].id) if has_more and page else None
    )
    result = AdminContributorHistoryOut(
        user_id=target.id,
        display_name=public_display_name(
            target.display_name, target.logto_user_id, target.nickname
        ),
        stats=(
            ContributionStatsOut.model_validate(stats)
            if stats is not None
            else ContributionStatsOut(
                total_points=0,
                fountains_added=0,
                ratings_count=0,
                attributes_count=0,
                conditions_reported=0,
                verifications_count=0,
                notes_count=0,
            )
        ),
        events=events,
        next_cursor=next_cursor,
    )
    logger.info(
        "admin contributor history read",
        extra={
            **_admin_context(admin),
            "target_user_id": str(user_id),
            "cursor_present": cursor is not None,
            "limit": limit,
            "returned": len(events),
            "has_more": has_more,
        },
    )
    return result


def _record_moderation_action(
    session: AsyncSession,
    admin: User,
    *,
    action: str,
    content_type: str,
    content_id: uuid.UUID,
    fountain_id: uuid.UUID | None,
    reason: str | None = None,
    details: dict[str, object] | None = None,
) -> None:
    session.add(
        ModerationAction(
            admin_user_id=admin.id,
            admin_actor_id=admin.id,
            action=action,
            content_type=content_type,
            content_id=content_id,
            fountain_id=fountain_id,
            reason=reason,
            details=details,
        )
    )


@router.patch("/users/{user_id}/sanction", response_model=AdminSanctionOut)
async def set_user_sanction(
    user_id: uuid.UUID,
    payload: AdminSanctionRequest,
    admin: User = Depends(require_admin),
    session: AsyncSession = Depends(get_session),
) -> AdminSanctionOut:
    target = (
        await session.execute(select(User).where(User.id == user_id).with_for_update())
    ).scalar_one_or_none()
    if target is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="user not found")
    if target.id == admin.id or target.is_admin:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, detail="cannot_sanction_admin")

    expiry = payload.suspended_until
    if expiry is not None:
        if expiry.tzinfo is None:
            raise HTTPException(
                status.HTTP_422_UNPROCESSABLE_ENTITY, detail="suspended_until_timezone_required"
            )
        expiry = expiry.astimezone(UTC)
        if expiry <= datetime.now(UTC):
            raise HTTPException(
                status.HTTP_422_UNPROCESSABLE_ENTITY, detail="suspended_until_must_be_future"
            )

    unchanged = (
        target.account_status == payload.status
        and target.sanction_reason == (None if payload.status == "active" else payload.reason)
        and target.suspended_until == expiry
    )
    if unchanged:
        return AdminSanctionOut(
            user_id=target.id,
            status=target.account_status,
            suspended_until=target.suspended_until,
            reason=target.sanction_reason,
        )

    previous = target.account_status
    target.account_status = payload.status
    if payload.status == "active":
        target.suspended_until = None
        target.sanction_reason = None
        target.sanctioned_at = None
        target.sanctioned_by_user_id = None
        action = "unban"
    else:
        target.suspended_until = expiry
        target.sanction_reason = payload.reason
        target.sanctioned_at = datetime.now(UTC)
        target.sanctioned_by_user_id = admin.id
        action = "suspend" if payload.status == "suspended" else "ban"
    _record_moderation_action(
        session,
        admin,
        action=action,
        content_type="user",
        content_id=target.id,
        fountain_id=None,
        reason=payload.reason,
        details={
            "previous_status": previous,
            "new_status": payload.status,
            "suspended_until": expiry.isoformat() if expiry else None,
        },
    )
    await session.commit()
    await session.refresh(target)
    return AdminSanctionOut(
        user_id=target.id,
        status=target.account_status,
        suspended_until=target.suspended_until,
        reason=target.sanction_reason,
    )


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
    rating_rows = (
        await session.execute(
            select(Rating, RatingType.name, User)
            .join(RatingType, RatingType.id == Rating.rating_type_id)
            .outerjoin(User, User.id == Rating.user_id)
            .where(Rating.fountain_id == fountain.id)
            .order_by(Rating.updated_at.desc(), Rating.id.desc())
        )
    ).all()
    ratings = [
        AdminRatingOut(
            id=rating.id,
            rating_type_id=rating.rating_type_id,
            rating_type_name=rating_type_name,
            stars=rating.stars,
            contributor=(
                public_display_name(author.display_name, author.logto_user_id, author.nickname)
                if author is not None
                else "Deleted account"
            ),
            updated_at=rating.updated_at,
        )
        for rating, rating_type_name, author in rating_rows
    ]
    return AdminFountainDetail(
        **public_detail.model_dump(),
        is_hidden=fountain.is_hidden,
        notes=notes,
        ratings=ratings,
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


@router.patch(
    "/fountains/{fountain_id}",
    response_model=AdminFountainDetail,
    responses={status.HTTP_503_SERVICE_UNAVAILABLE: BUSY_RESPONSE},
)
async def admin_patch_fountain(
    fountain_id: uuid.UUID,
    payload: AdminFountainPatch,
    session: AsyncSession = Depends(get_session),
    admin: User = Depends(require_admin),
    settings: Settings = Depends(get_settings),
) -> AdminFountainDetail:
    changes: dict[str, dict[str, object | None]] = {}
    recompute_ranking = False
    resolved_reports = 0
    # Bound the whole write transaction so this admin mutation never queues indefinitely behind a
    # boundary load / membership refresh (spec 2026-07-17 §1). No separate reservation commit here,
    # so the context is entered before the first database statement; a wait past the bound → 503.
    try:
        async with interactive_lock_timeout(session, settings, context="admin_patch_fountain"):
            # Serialize this mutation's precomputed-membership recompute with concurrent adds /
            # imports / full refreshes (they all share the denormalized place counts) — the same
            # advisory lock POST /fountains and the OSM import take. Acquire it BEFORE the row lock
            # so lock order is consistent (advisory first, then row) and no deadlock is possible
            # (#127 Slice 1d).
            await session.execute(select(func.pg_advisory_xact_lock(ADD_FOUNTAIN_LOCK_KEY)))
            fountain = (
                await session.execute(
                    select(Fountain).where(Fountain.id == fountain_id).with_for_update()
                )
            ).scalar_one_or_none()
            if fountain is None:
                raise HTTPException(status.HTTP_404_NOT_FOUND, detail="fountain not found")

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
            if (
                "is_working" in payload.model_fields_set
                and fountain.is_working != payload.is_working
            ):
                changes["is_working"] = {
                    "before": fountain.is_working,
                    "after": payload.is_working,
                }
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
                # On a false->true hide, resolve this fountain's pending fountain-type reports (NOT
                # the note/photo reports under it — those are separate queue items) (#12, spec §4).
                if fountain.is_hidden:
                    resolved_reports = await _resolve_pending_reports(
                        session, "fountain", fountain.id, admin, "hidden"
                    )

            if recompute_ranking:
                await recompute_fountain_ranking(session, fountain.id)
            # A move (location) or a hide/unhide changes the precomputed membership and/or the
            # non-hidden fountain_count, so re-derive them for this fountain (and re-canonicalize
            # its slug group) before commit — the public place counts must not go stale (#127
            # Slice 1d).
            if "location" in changes or "is_hidden" in changes:
                await session.flush()
                await recompute_fountain_membership(session, fountain.id)
            if "is_hidden" in changes:
                _record_moderation_action(
                    session,
                    admin,
                    action="hide" if fountain.is_hidden else "unhide",
                    content_type="fountain",
                    content_id=fountain.id,
                    fountain_id=fountain.id,
                    reason=payload.moderation_reason,
                    details={"resolved_reports": resolved_reports},
                )
            await session.commit()
    except InteractiveWriteBusy as exc:
        raise busy_exception() from exc
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


@router.delete(
    "/fountains/{fountain_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    responses={status.HTTP_503_SERVICE_UNAVAILABLE: BUSY_RESPONSE},
)
async def admin_delete_fountain(
    fountain_id: uuid.UUID,
    reason: str | None = Query(default=None, max_length=500),
    session: AsyncSession = Depends(get_session),
    admin: User = Depends(require_admin),
    settings: Settings = Depends(get_settings),
) -> Response:
    # Bound the whole delete transaction so it never queues indefinitely behind a boundary load /
    # membership refresh (spec 2026-07-17 §1). No separate reservation commit, so the context is
    # entered before the first database statement; a wait past the bound → 503.
    try:
        async with interactive_lock_timeout(session, settings, context="admin_delete_fountain"):
            # Advisory lock (see admin_patch_fountain): serialize the place-count recompute with
            # concurrent adds / imports / full refreshes; acquire before the row lock so lock order
            # is consistent.
            await session.execute(select(func.pg_advisory_xact_lock(ADD_FOUNTAIN_LOCK_KEY)))
            fountain = (
                await session.execute(
                    select(Fountain).where(Fountain.id == fountain_id).with_for_update()
                )
            ).scalar_one_or_none()
            if fountain is None:
                raise HTTPException(status.HTTP_404_NOT_FOUND, detail="fountain not found")
            # Capture the deleted fountain's places so their fountain_count (and canonical winner)
            # can be corrected after the row is gone (#127 Slice 1d).
            old_place_ids = [
                fountain.country_place_id,
                fountain.region_place_id,
                fountain.city_place_id,
            ]
            # Enqueue durable storage_cleanup rows for every photo's Spaces objects BEFORE the
            # delete cascades the fountain_photos ROWS away (fk_fountain_photos_fountain is ON
            # DELETE CASCADE) — otherwise the objects are orphaned in the private bucket with no
            # ledger row for the sweep worker to find them by (design §3.3: no silent orphan).
            # Includes hidden photos; the actual Spaces deletes are NOT done inline here, only
            # enqueued for the sweep.
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
            # Reverse every contribution tied to this fountain BEFORE deleting it (#119
            # anti-gaming): removing the content must not let its points persist on the
            # leaderboard. Must run first because contribution_events.fountain_id is ON DELETE SET
            # NULL — once the fountain row is gone the events can no longer be found by fountain_id.
            reversed_events = await reverse_contributions(session, fountain_id)
            _record_moderation_action(
                session,
                admin,
                action="delete",
                content_type="fountain",
                content_id=fountain_id,
                fountain_id=fountain_id,
                reason=reason.strip() or None if reason is not None else None,
                details={"reversed_contribution_events": reversed_events},
            )
            await session.delete(fountain)
            await session.flush()  # the row must be gone before its old places are recounted
            await recompute_place_counts(session, old_place_ids)
            await session.commit()
    except InteractiveWriteBusy as exc:
        raise busy_exception() from exc
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
    if before_hidden != note.is_hidden:
        _record_moderation_action(
            session,
            admin,
            action="hide" if note.is_hidden else "unhide",
            content_type="note",
            content_id=note.id,
            fountain_id=note.fountain_id,
            reason=payload.moderation_reason,
            details={"resolved_reports": resolved_reports},
        )
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
    if before_hidden != photo.is_hidden:
        _record_moderation_action(
            session,
            admin,
            action="hide" if photo.is_hidden else "unhide",
            content_type="photo",
            content_id=photo.id,
            fountain_id=photo.fountain_id,
            reason=payload.moderation_reason,
            details={"resolved_reports": resolved_reports},
        )
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
    reason: str | None = Query(default=None, max_length=500),
    session: AsyncSession = Depends(get_session),
    admin: User = Depends(require_admin),
) -> Response:
    """Reject a photo's pending reports without touching the photo — it stays visible. The
    reports flip to `resolved`/`rejected`; the photo drops out of the queue."""
    fountain_id = (
        await session.execute(select(FountainPhoto.fountain_id).where(FountainPhoto.id == photo_id))
    ).scalar_one_or_none()
    if fountain_id is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="photo not found")

    resolved = await _resolve_pending_reports(session, "photo", photo_id, admin, "rejected")
    _record_moderation_action(
        session,
        admin,
        action="dismiss",
        content_type="photo",
        content_id=photo_id,
        fountain_id=fountain_id,
        reason=reason.strip() or None if reason is not None else None,
        details={"resolved_reports": resolved},
    )
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
    reason: str | None = Query(default=None, max_length=500),
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
    _record_moderation_action(
        session,
        admin,
        action="delete",
        content_type="photo",
        content_id=photo_id,
        fountain_id=photo.fountain_id,
        reason=reason.strip() or None if reason is not None else None,
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


@router.delete(
    "/ratings/{rating_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    responses={status.HTTP_503_SERVICE_UNAVAILABLE: BUSY_RESPONSE},
)
async def admin_delete_rating(
    rating_id: uuid.UUID,
    payload: ModerationReasonRequest,
    session: AsyncSession = Depends(get_session),
    admin: User = Depends(require_admin),
    settings: Settings = Depends(get_settings),
) -> Response:
    """Remove one rating and reverse only the contribution points it earned."""
    try:
        async with interactive_lock_timeout(session, settings, context="admin_delete_rating"):
            fountain_id = (
                await session.execute(select(Rating.fountain_id).where(Rating.id == rating_id))
            ).scalar_one_or_none()
            if fountain_id is None:
                raise HTTPException(status.HTTP_404_NOT_FOUND, detail="rating not found")

            # Keep the project's ranking-write lock order: fountain first, child row second.
            fountain = (
                await session.execute(
                    select(Fountain).where(Fountain.id == fountain_id).with_for_update()
                )
            ).scalar_one_or_none()
            if fountain is None:
                raise HTTPException(status.HTTP_404_NOT_FOUND, detail="rating not found")
            rating = (
                await session.execute(
                    select(Rating).where(Rating.id == rating_id).with_for_update()
                )
            ).scalar_one_or_none()
            if rating is None:
                raise HTTPException(status.HTTP_404_NOT_FOUND, detail="rating not found")

            actor_id = rating.user_id
            rating_type_id = rating.rating_type_id
            stars = rating.stars
            reversed_events = await reverse_contribution_for_target(session, "rating", rating_id)
            await session.delete(rating)
            await session.flush()

            reversed_bonus_events = 0
            if actor_id is not None:
                remaining_actor_ratings = (
                    await session.execute(
                        select(func.count(Rating.id)).where(
                            Rating.fountain_id == fountain_id,
                            Rating.user_id == actor_id,
                        )
                    )
                ).scalar_one()
                if remaining_actor_ratings == 0:
                    reversed_bonus_events = await reverse_first_rating_bonus_for_actor(
                        session, fountain_id, actor_id
                    )

            await recompute_fountain_ranking(session, fountain.id)
            _record_moderation_action(
                session,
                admin,
                action="rating_delete",
                content_type="rating",
                content_id=rating_id,
                fountain_id=fountain_id,
                reason=payload.reason,
                details={
                    "rating_type_id": rating_type_id,
                    "stars": stars,
                    "reversed_contribution_events": reversed_events,
                    "reversed_bonus_events": reversed_bonus_events,
                },
            )
            await session.commit()
    except InteractiveWriteBusy as exc:
        raise busy_exception() from exc

    logger.info(
        "admin rating mutation",
        extra={
            **_admin_context(admin),
            "action": "delete",
            "target_type": "rating",
            "target_id": str(rating_id),
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
                    User.id.label("contributor_user_id"),
                    User.account_status.label("contributor_account_status"),
                    User.suspended_until.label("contributor_suspended_until"),
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
                "contributor_user_id": r.contributor_user_id,
                "contributor_account_status": r.contributor_account_status,
                "contributor_suspended_until": r.contributor_suspended_until,
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
                    User.id.label("contributor_user_id"),
                    User.account_status.label("contributor_account_status"),
                    User.suspended_until.label("contributor_suspended_until"),
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
                "contributor_user_id": r.contributor_user_id,
                "contributor_account_status": r.contributor_account_status,
                "contributor_suspended_until": r.contributor_suspended_until,
                "excerpt": r.excerpt,
            }
    if fountain_ids := ids_by_type.get("fountain"):
        for r in (
            await session.execute(
                select(
                    Fountain.id,
                    Fountain.is_hidden,
                    Fountain.placement_note,
                    User.id.label("contributor_user_id"),
                    User.account_status.label("contributor_account_status"),
                    User.suspended_until.label("contributor_suspended_until"),
                    User.display_name,
                    User.logto_user_id,
                    User.nickname,
                )
                .outerjoin(User, User.id == Fountain.added_by_user_id)
                .where(Fountain.id.in_(fountain_ids))
            )
        ).all():
            details[("fountain", r.id)] = {
                "fountain_id": r.id,
                "is_hidden": r.is_hidden,
                "fountain_label": r.placement_note,
                "contributor": public_display_name(r.display_name, r.logto_user_id, r.nickname)
                if r.contributor_user_id
                else None,
                "contributor_user_id": r.contributor_user_id,
                "contributor_account_status": r.contributor_account_status,
                "contributor_suspended_until": r.contributor_suspended_until,
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
                contributor_user_id=detail.get("contributor_user_id"),
                contributor_account_status=detail.get("contributor_account_status"),
                contributor_suspended_until=detail.get("contributor_suspended_until"),
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
        await session.execute(select(model).where(model.id == payload.content_id))
    ).scalar_one_or_none()
    if target is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail=f"{payload.content_type} not found")

    resolved = await _resolve_pending_reports(
        session, payload.content_type, payload.content_id, admin, "rejected"
    )
    fountain_id = target.id if isinstance(target, Fountain) else target.fountain_id
    _record_moderation_action(
        session,
        admin,
        action="dismiss",
        content_type=payload.content_type,
        content_id=payload.content_id,
        fountain_id=fountain_id,
        reason=payload.reason,
        details={"resolved_reports": resolved},
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
