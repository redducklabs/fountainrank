from fastapi import Depends, Header, HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import Settings, get_settings
from app.db import get_session
from app.models import User


async def get_or_create_user(
    session: AsyncSession, *, logto_user_id: str, email: str, display_name: str
) -> User:
    """Find the local User for a Logto subject, provisioning one on first sight.
    Phase 2's real JWT path reuses this unchanged."""
    existing = (
        await session.execute(select(User).where(User.logto_user_id == logto_user_id))
    ).scalar_one_or_none()
    if existing is not None:
        return existing
    user = User(logto_user_id=logto_user_id, email=email, display_name=display_name)
    session.add(user)
    await session.flush()
    return user


async def get_current_user(
    x_dev_user: str | None = Header(default=None, alias="X-Dev-User"),
    x_dev_email: str | None = Header(default=None, alias="X-Dev-Email"),
    x_dev_name: str | None = Header(default=None, alias="X-Dev-Name"),
    session: AsyncSession = Depends(get_session),
    settings: Settings = Depends(get_settings),
) -> User:
    """Phase 1 dev-auth seam. Phase 2 swaps the identity extraction below for
    Logto JWT validation (verify iss/aud via JWKS, take `sub`); the
    get_or_create_user tail is identical. Disabled by default so production never
    exposes an unauthenticated write path before Phase 2."""
    if not settings.dev_auth_enabled:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, detail="authentication required")
    if not x_dev_user:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, detail="missing X-Dev-User header")
    return await get_or_create_user(
        session,
        logto_user_id=x_dev_user,
        email=x_dev_email or f"{x_dev_user}@dev.local",
        display_name=x_dev_name or x_dev_user,
    )
