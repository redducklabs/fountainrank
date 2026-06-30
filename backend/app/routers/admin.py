import logging
import uuid
from datetime import UTC, datetime

from fastapi import APIRouter, Depends, HTTPException, Response, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth import require_admin
from app.contributions import reverse_contributions
from app.db import get_session
from app.display import public_display_name
from app.geo import point_geography
from app.models import Fountain, FountainNote, User
from app.ranking import recompute_fountain_ranking
from app.routers.fountains import serialize_fountain_detail
from app.schemas import AdminFountainDetail, AdminFountainPatch, AdminNoteOut, AdminNotePatch

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
        author_display_name=public_display_name(author.display_name, author.logto_user_id),
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
    fountain = (
        await session.execute(select(Fountain).where(Fountain.id == fountain_id).with_for_update())
    ).scalar_one_or_none()
    if fountain is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="fountain not found")

    changes: dict[str, dict[str, object | None]] = {}
    recompute_ranking = False
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

    if recompute_ranking:
        await recompute_fountain_ranking(session, fountain.id)
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
        },
    )
    return await _serialize_admin_fountain(session, fountain, admin)


@router.delete("/fountains/{fountain_id}", status_code=status.HTTP_204_NO_CONTENT)
async def admin_delete_fountain(
    fountain_id: uuid.UUID,
    session: AsyncSession = Depends(get_session),
    admin: User = Depends(require_admin),
) -> Response:
    fountain = (
        await session.execute(select(Fountain).where(Fountain.id == fountain_id).with_for_update())
    ).scalar_one_or_none()
    if fountain is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="fountain not found")
    # Reverse every contribution tied to this fountain BEFORE deleting it (#119 anti-gaming):
    # removing the content must not let its points persist on the leaderboard. Must run first
    # because contribution_events.fountain_id is ON DELETE SET NULL — once the fountain row is
    # gone the events can no longer be found by fountain_id.
    reversed_events = await reverse_contributions(session, fountain_id)
    await session.delete(fountain)
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
    if payload.is_hidden:
        if not note.is_hidden:
            note.hidden_by_user_id = admin.id
            note.hidden_at = datetime.now(tz=UTC)
        note.is_hidden = True
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
            },
        },
    )
    return await _serialize_admin_note(note, author)
