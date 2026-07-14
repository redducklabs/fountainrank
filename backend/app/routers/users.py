import logging
from datetime import UTC, datetime
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.concurrency import run_in_threadpool
from sqlalchemy import delete, func, select, tuple_, update
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth import get_current_user
from app.badges import earned_badges
from app.config import Settings, get_settings
from app.db import get_session
from app.display import resolved_display_name
from app.geo import latitude_of, longitude_of
from app.logto_management import (
    LogtoManagementClient,
    LogtoManagementError,
    identity_error_detail,
)
from app.models import (
    AttributeObservation,
    ConditionReport,
    ContentReport,
    ContributionEvent,
    DeletedAccount,
    Fountain,
    FountainNote,
    FountainPhoto,
    Rating,
    StorageCleanup,
    UploadAttempt,
    User,
    UserContributionStats,
)
from app.rate_limit import RateLimited, WriteAttemptReserver, get_write_attempt_reserver
from app.schemas import (
    BadgeOut,
    ContributionEventOut,
    ContributionStatsOut,
    Coordinates,
    FountainPin,
    MeContributionsOut,
    MeResponse,
    MyFountainsOut,
    SyncProfileRequest,
    UpdateMeRequest,
)
from app.storage import get_storage
from app.userinfo import (
    SYNTHETIC_EMAIL_DOMAIN,
    UserinfoError,
    UserinfoFetcher,
    accept_avatar,
    accept_email,
    get_userinfo_fetcher,
    pick_display_name,
)

logger = logging.getLogger("app.users")

router = APIRouter(prefix="/api/v1", tags=["users"])

PROFILE_SYNC_RATE_LIMIT_RESPONSE = {
    "description": "Profile sync limit reached.",
    "headers": {
        "Retry-After": {
            "description": "Seconds until the rolling-window budget admits another attempt.",
            "schema": {"type": "integer"},
        }
    },
}


def me_response(user: User) -> MeResponse:
    """Self-view profile. The raw Logto subject must never reach the client, so:
    - display_name is the resolved name (nickname → IdP name), or "" when the account resolves to
      "Anonymous" (the subject is never sent; the client gate keys off needs_name);
    - email is "" when it is the synthetic subject-derived fallback
      (f"{sub}@users.noreply.fountainrank.com"); a real email passes through. The DB keeps its
      NOT-NULL synthetic value — only the wire is sanitized.
    """
    resolved = resolved_display_name(user.display_name, user.logto_user_id, user.nickname)
    email = "" if user.email.lower().endswith(SYNTHETIC_EMAIL_DOMAIN) else user.email
    return MeResponse(
        id=user.id,
        display_name=resolved or "",
        email=email,
        avatar_url=user.avatar_url,
        is_admin=user.is_admin,
        created_at=user.created_at,
        needs_name=resolved is None,
    )


@router.get("/me", response_model=MeResponse)
async def get_me(current_user: Annotated[User, Depends(get_current_user)]) -> MeResponse:
    # Auth failures are raised by get_current_user (401). Unexpected errors propagate
    # to the centralized exception handler in main.py (logged 500) — not swallowed here.
    return me_response(current_user)


@router.patch("/me", response_model=MeResponse)
async def update_me(
    body: UpdateMeRequest,
    current_user: Annotated[User, Depends(get_current_user)],
    session: Annotated[AsyncSession, Depends(get_session)],
) -> MeResponse:
    # The user-set display name is stored in `nickname` (the IdP `display_name` stays intact as the
    # fallback). Reject a value equal to the subject — it would re-mask to "Anonymous".
    if body.display_name == current_user.logto_user_id:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, detail="invalid display name")
    current_user.nickname = body.display_name
    await session.commit()
    logger.info("display name set", extra={"user_id": str(current_user.id)})  # never the value
    return me_response(current_user)


async def _delete_photo_objects_for_account(
    *,
    photo_keys: list[str],
    settings: Settings,
) -> bool:
    if not photo_keys:
        return True
    storage = get_storage(settings)
    if storage is None:
        logger.warning(
            "account deletion photo cleanup remains pending because storage is unavailable"
        )
        return False
    for key in photo_keys:
        try:
            await run_in_threadpool(storage.delete_object, key)
        except Exception:
            logger.exception(
                "account deletion photo cleanup remains pending because object deletion failed",
                extra={"object_key": key},
            )
            return False
    return True


async def _mark_logto_delete_done(session: AsyncSession, logto_user_id: str) -> None:
    await session.execute(
        update(DeletedAccount)
        .where(DeletedAccount.logto_user_id == logto_user_id)
        .values(
            identity_delete_status="done",
            identity_delete_attempts=DeletedAccount.identity_delete_attempts + 1,
            identity_delete_last_attempt_at=datetime.now(tz=UTC),
            identity_delete_error=None,
        )
    )
    await session.commit()


async def _mark_logto_delete_pending(
    session: AsyncSession, logto_user_id: str, error: LogtoManagementError
) -> None:
    await session.execute(
        update(DeletedAccount)
        .where(DeletedAccount.logto_user_id == logto_user_id)
        .values(
            identity_delete_status="pending",
            identity_delete_attempts=DeletedAccount.identity_delete_attempts + 1,
            identity_delete_last_attempt_at=datetime.now(tz=UTC),
            identity_delete_error=identity_error_detail(error),
        )
    )
    await session.commit()


async def _rollback_quietly(session: AsyncSession) -> None:
    """Return the session to a usable state after a failed post-commit cleanup step, so the
    next step still gets a chance to run. A rollback failure here is itself non-fatal — the
    local deletion is already committed — but it is logged, never swallowed."""
    try:
        await session.rollback()
    except Exception:
        logger.exception("rollback after a failed account-deletion cleanup step failed")


async def _finish_photo_cleanup(
    session: AsyncSession, settings: Settings, photo_keys: list[str]
) -> None:
    if not await _delete_photo_objects_for_account(photo_keys=photo_keys, settings=settings):
        return
    if not photo_keys:
        return
    await session.execute(
        update(StorageCleanup)
        .where(StorageCleanup.object_key.in_(photo_keys), StorageCleanup.status == "pending")
        .values(status="done")
    )
    await session.commit()


async def _finish_identity_cleanup(
    session: AsyncSession, settings: Settings, logto_user_id: str
) -> None:
    try:
        await LogtoManagementClient(settings).delete_user(logto_user_id)
    except LogtoManagementError as exc:
        logger.exception("account deletion identity cleanup remains pending")
        await _mark_logto_delete_pending(session, logto_user_id, exc)
    else:
        await _mark_logto_delete_done(session, logto_user_id)


@router.delete("/me", status_code=status.HTTP_204_NO_CONTENT)
async def delete_me(
    current_user: Annotated[User, Depends(get_current_user)],
    session: Annotated[AsyncSession, Depends(get_session)],
    settings: Annotated[Settings, Depends(get_settings)],
) -> None:
    """Delete the caller's FountainRank account and personal content.

    Ratings, attribute observations, condition reports, and user-added fountain rows are retained
    but detached from the account, so public ratings/details do not change. Notes and photos are
    removed because they are authored profile content.

    The local deletion commits first and is irreversible. The Logto identity and the stored photo
    objects are then cleaned up on a best-effort basis, so a cleanup failure never fails the
    request; whatever could not be cleaned up is retried by the account-deletion cleanup job.
    """
    user_id = current_user.id
    logto_user_id = current_user.logto_user_id

    photo_rows = (
        await session.execute(
            select(FountainPhoto.id, FountainPhoto.storage_key, FountainPhoto.thumbnail_key).where(
                FountainPhoto.user_id == user_id
            )
        )
    ).all()
    photo_ids = [row.id for row in photo_rows]
    photo_keys = [key for row in photo_rows for key in (row.storage_key, row.thumbnail_key)]
    note_ids = (
        (await session.execute(select(FountainNote.id).where(FountainNote.user_id == user_id)))
        .scalars()
        .all()
    )

    if photo_ids:
        await session.execute(
            delete(ContentReport).where(
                ContentReport.content_type == "photo", ContentReport.content_id.in_(photo_ids)
            )
        )
    if note_ids:
        await session.execute(
            delete(ContentReport).where(
                ContentReport.content_type == "note", ContentReport.content_id.in_(note_ids)
            )
        )

    # Reports filed by this user are account data. Moderator references to this user are cleared so
    # unrelated moderated content no longer carries an account/profile reference.
    await session.execute(delete(ContentReport).where(ContentReport.reporter_user_id == user_id))
    await session.execute(
        update(ContentReport)
        .where(ContentReport.resolved_by_user_id == user_id)
        .values(resolved_by_user_id=None)
    )
    await session.execute(
        update(FountainNote)
        .where(FountainNote.hidden_by_user_id == user_id)
        .values(hidden_by_user_id=None)
    )
    await session.execute(
        update(FountainPhoto)
        .where(FountainPhoto.hidden_by_user_id == user_id)
        .values(hidden_by_user_id=None)
    )
    await session.execute(
        update(AttributeObservation)
        .where(AttributeObservation.hidden_by_user_id == user_id)
        .values(hidden_by_user_id=None)
    )
    await session.execute(
        update(ConditionReport)
        .where(ConditionReport.hidden_by_user_id == user_id)
        .values(hidden_by_user_id=None)
    )

    await session.execute(delete(FountainNote).where(FountainNote.user_id == user_id))
    await session.execute(delete(FountainPhoto).where(FountainPhoto.user_id == user_id))
    await session.execute(delete(UploadAttempt).where(UploadAttempt.user_id == user_id))
    await session.execute(
        update(Fountain).where(Fountain.added_by_user_id == user_id).values(added_by_user_id=None)
    )
    await session.execute(
        update(Rating)
        .where(Rating.user_id == user_id)
        .values(user_id=None, deleted_actor_id=user_id)
    )
    await session.execute(
        update(AttributeObservation)
        .where(AttributeObservation.user_id == user_id)
        .values(user_id=None, deleted_actor_id=user_id)
    )
    await session.execute(
        update(ConditionReport)
        .where(ConditionReport.user_id == user_id)
        .values(user_id=None, deleted_actor_id=user_id)
    )
    await session.execute(
        delete(UserContributionStats).where(UserContributionStats.user_id == user_id)
    )
    await session.execute(delete(ContributionEvent).where(ContributionEvent.user_id == user_id))
    for key in photo_keys:
        session.add(StorageCleanup(object_key=key, reason="account_delete"))
    # A double-submitted delete would otherwise lose the tombstone PK race and 500 after the
    # first request already removed the account. The rest of this handler is a no-op replay.
    await session.execute(
        pg_insert(DeletedAccount)
        .values(logto_user_id=logto_user_id)
        .on_conflict_do_nothing(index_elements=["logto_user_id"])
    )
    await session.execute(delete(User).where(User.id == user_id))
    await session.commit()

    # Past this commit the local deletion is irreversible and durable: the tombstone already
    # blocks re-auth, and both ledgers record whatever still needs cleaning. So every remaining
    # step is BEST EFFORT and must never turn into a non-2xx — a 500 here would tell the user
    # "deletion did not complete" about an account that is gone and can never sign in again.
    # Failures stay `pending` for `app.account_deletion_cleanup` to retry.
    try:
        await _finish_photo_cleanup(session, settings, photo_keys)
    except Exception:
        logger.exception(
            "account deletion post-commit cleanup failed; ledger row remains pending",
            extra={"cleanup_step": "photo"},
        )
        await _rollback_quietly(session)
    try:
        await _finish_identity_cleanup(session, settings, logto_user_id)
    except Exception:
        logger.exception(
            "account deletion post-commit cleanup failed; ledger row remains pending",
            extra={"cleanup_step": "identity"},
        )
        await _rollback_quietly(session)

    logger.info(
        "account deleted",
        extra={
            "user_id": str(user_id),
            "photos_deleted": len(photo_ids),
            "notes_deleted": len(note_ids),
        },
    )


# Defensive guardrail for the unpaginated per-user aggregate (#170, spec §3.1): bound the
# response so a power user can't silently produce a slow account page before pagination lands.
ME_FOUNTAINS_MAX = 500

_ZERO_STATS = ContributionStatsOut(
    total_points=0,
    fountains_added=0,
    ratings_count=0,
    attributes_count=0,
    conditions_reported=0,
    verifications_count=0,
    notes_count=0,
)


@router.get("/me/contributions", response_model=MeContributionsOut)
async def get_my_contributions(
    current_user: Annotated[User, Depends(get_current_user)],
    session: Annotated[AsyncSession, Depends(get_session)],
) -> MeContributionsOut:
    # Auth-required, caller's own data only — never another user's history.
    stats_row = (
        await session.execute(
            select(UserContributionStats).where(UserContributionStats.user_id == current_user.id)
        )
    ).scalar_one_or_none()
    stats = ContributionStatsOut.model_validate(stats_row) if stats_row else _ZERO_STATS
    # AWARDED events only — reversed events (e.g. after a moderated hard-delete, #119) must
    # not surface as accepted contributions, consistent with the stats/badges/leaderboard reads.
    recent_rows = (
        (
            await session.execute(
                select(ContributionEvent)
                .where(
                    ContributionEvent.user_id == current_user.id,
                    ContributionEvent.status == "awarded",
                )
                .order_by(ContributionEvent.created_at.desc())
                .limit(20)
            )
        )
        .scalars()
        .all()
    )
    recent = [ContributionEventOut.model_validate(r) for r in recent_rows]
    return MeContributionsOut(stats=stats, recent=recent)


@router.get("/me/fountains", response_model=MyFountainsOut)
async def get_my_fountains(
    current_user: Annotated[User, Depends(get_current_user)],
    session: Annotated[AsyncSession, Depends(get_session)],
) -> MyFountainsOut:
    # Auth-required, caller's own data only. Deduped fountains the user has an AWARDED
    # contribution to (add/rate/note/condition), non-hidden, most-recent-contribution first.
    last_touch = (
        select(
            ContributionEvent.fountain_id.label("fid"),
            func.max(ContributionEvent.created_at).label("last_at"),
        )
        .where(
            ContributionEvent.user_id == current_user.id,
            ContributionEvent.status == "awarded",
            ContributionEvent.fountain_id.is_not(None),
        )
        .group_by(ContributionEvent.fountain_id)
        .subquery()
    )
    rows = (
        await session.execute(
            select(
                Fountain.id,
                latitude_of(Fountain.location),
                longitude_of(Fountain.location),
                Fountain.is_working,
                Fountain.average_rating,
                Fountain.rating_count,
                Fountain.ranking_score,
                Fountain.current_status,
                Fountain.last_verified_at,
            )
            .join(last_touch, last_touch.c.fid == Fountain.id)
            .where(Fountain.is_hidden.is_(False))
            # Recent-first; fountain.id breaks created_at ties deterministically. (No MAX(id):
            # contribution_events.id is a random uuid4, so it's not a recency signal.)
            .order_by(last_touch.c.last_at.desc(), Fountain.id.asc())
            .limit(ME_FOUNTAINS_MAX + 1)
        )
    ).all()
    capped = len(rows) > ME_FOUNTAINS_MAX
    if capped:
        rows = rows[:ME_FOUNTAINS_MAX]
        logger.warning(
            "my fountains capped",
            extra={"user_id": str(current_user.id), "cap": ME_FOUNTAINS_MAX},
        )
    fountains = [
        FountainPin(
            id=rid,
            location=Coordinates(latitude=float(rlat), longitude=float(rlng)),
            is_working=working,
            average_rating=avg,
            rating_count=count,
            ranking_score=score,
            current_status=cur_status,
            last_verified_at=last_verified,
        )
        for (rid, rlat, rlng, working, avg, count, score, cur_status, last_verified) in rows
    ]
    logger.info(
        "my fountains served",
        extra={"user_id": str(current_user.id), "count": len(fountains)},
    )
    return MyFountainsOut(fountains=fountains)


@router.get("/me/badges", response_model=list[BadgeOut])
async def get_my_badges(
    current_user: Annotated[User, Depends(get_current_user)],
    session: Annotated[AsyncSession, Depends(get_session)],
) -> list[BadgeOut]:
    # Auth-required, caller's own derived badges.
    stats_row = (
        await session.execute(
            select(UserContributionStats).where(UserContributionStats.user_id == current_user.id)
        )
    ).scalar_one_or_none()
    stats = stats_row or _ZERO_STATS
    # Deterministic 1-based rank over the total order (created_at, id).
    rank = (
        await session.execute(
            select(func.count())
            .select_from(User)
            .where(
                tuple_(User.created_at, User.id) < tuple_(current_user.created_at, current_user.id)
            )
        )
    ).scalar_one() + 1
    # Per-dimension rate counts from AWARDED rate events only (reversed never count).
    rating_type = ContributionEvent.event_metadata["rating_type_id"].astext.label("rating_type")
    dim_rows = (
        await session.execute(
            select(rating_type, func.count())
            .where(
                ContributionEvent.user_id == current_user.id,
                ContributionEvent.event_type == "rate",
                ContributionEvent.status == "awarded",
            )
            .group_by(rating_type)
        )
    ).all()
    dimension_counts = {int(k): n for (k, n) in dim_rows if k is not None}
    badges = earned_badges(stats=stats, created_rank=rank, dimension_rate_counts=dimension_counts)
    return [BadgeOut(key=b.key, name=b.name, description=b.description) for b in badges]


@router.post(
    "/me/sync",
    response_model=MeResponse,
    responses={status.HTTP_429_TOO_MANY_REQUESTS: PROFILE_SYNC_RATE_LIMIT_RESPONSE},
)
async def sync_me(
    body: SyncProfileRequest,
    current_user: Annotated[User, Depends(get_current_user)],
    session: Annotated[AsyncSession, Depends(get_session)],
    fetch_userinfo: Annotated[UserinfoFetcher, Depends(get_userinfo_fetcher)],
    reserve_write_attempt: Annotated[WriteAttemptReserver, Depends(get_write_attempt_reserver)],
) -> MeResponse:
    try:
        await reserve_write_attempt(current_user.id, "profile_sync", "profile_sync")
    except RateLimited as exc:
        raise HTTPException(
            status.HTTP_429_TOO_MANY_REQUESTS,
            detail=exc.reason,
            headers={"Retry-After": str(exc.retry_after)},
        ) from exc

    # Backend-authoritative: call Logto userinfo with the forwarded opaque token.
    try:
        claims = await fetch_userinfo(body.userinfo_token)
    except UserinfoError as exc:
        logger.warning("profile sync failed", extra={"reason": exc.reason})
        raise HTTPException(status.HTTP_502_BAD_GATEWAY, detail="userinfo unavailable") from exc
    # Security: the userinfo subject MUST match the authenticated resource-JWT subject
    # (no mutation before this check).
    if claims.sub != current_user.logto_user_id:
        logger.warning("profile sync rejected", extra={"reason": "sub_mismatch"})
        raise HTTPException(status.HTTP_403_FORBIDDEN, detail="subject mismatch")
    current_user.email = accept_email(claims, current=current_user.email)
    current_user.display_name = pick_display_name(
        claims, current=current_user.display_name, sub=current_user.logto_user_id
    )
    current_user.avatar_url = accept_avatar(claims, current=current_user.avatar_url)
    await session.commit()
    await session.refresh(current_user)
    logger.info("profile synced", extra={"sub": current_user.logto_user_id})
    return me_response(current_user)
