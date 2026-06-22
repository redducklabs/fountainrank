import logging
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth import get_current_user
from app.db import get_session
from app.models import ContributionEvent, User, UserContributionStats
from app.schemas import (
    ContributionEventOut,
    ContributionStatsOut,
    MeContributionsOut,
    MeResponse,
    SyncProfileRequest,
)
from app.userinfo import (
    UserinfoError,
    UserinfoFetcher,
    accept_avatar,
    accept_email,
    get_userinfo_fetcher,
    pick_display_name,
)

logger = logging.getLogger("app.users")

router = APIRouter(prefix="/api/v1", tags=["users"])


@router.get("/me", response_model=MeResponse)
async def get_me(current_user: Annotated[User, Depends(get_current_user)]) -> User:
    # Auth failures are raised by get_current_user (401). Unexpected errors propagate
    # to the centralized exception handler in main.py (logged 500) — not swallowed here.
    return current_user


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
    recent_rows = (
        (
            await session.execute(
                select(ContributionEvent)
                .where(ContributionEvent.user_id == current_user.id)
                .order_by(ContributionEvent.created_at.desc())
                .limit(20)
            )
        )
        .scalars()
        .all()
    )
    recent = [ContributionEventOut.model_validate(r) for r in recent_rows]
    return MeContributionsOut(stats=stats, recent=recent)


@router.post("/me/sync", response_model=MeResponse)
async def sync_me(
    body: SyncProfileRequest,
    current_user: Annotated[User, Depends(get_current_user)],
    session: Annotated[AsyncSession, Depends(get_session)],
    fetch_userinfo: Annotated[UserinfoFetcher, Depends(get_userinfo_fetcher)],
) -> User:
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
    return current_user
