import logging
import uuid

from fastapi import Depends, Header, HTTPException, status
from sqlalchemy import select
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import Settings, get_settings
from app.db import get_session
from app.logto_auth import AuthError, JwksCache, validate_bearer_token
from app.models import User

logger = logging.getLogger("app.auth")

# Process-wide JWKS cache singleton (keys are fetched once and cached). Exposed as a
# dependency so tests can override it with a synthetic, network-free cache.
_jwks_cache: JwksCache | None = None


def get_jwks_cache(settings: Settings = Depends(get_settings)) -> JwksCache:
    global _jwks_cache
    if _jwks_cache is None:
        _jwks_cache = JwksCache(settings.logto_jwks_uri, settings.logto_jwks_cache_ttl_seconds)
    return _jwks_cache


async def get_or_create_user(
    session: AsyncSession, *, logto_user_id: str, email: str, display_name: str
) -> User:
    """Find the local User for a Logto subject, provisioning one on first sight.
    Phase 2's real JWT path reuses this unchanged.

    Race-safe: a plain SELECT-then-INSERT lets two concurrent first requests for the
    same subject both miss the row, both INSERT, and one lose on
    `uq_users_logto_user_id` -> IntegrityError -> 500. We INSERT ... ON CONFLICT DO
    NOTHING and re-select the winner instead, so concurrent provisioning converges on
    one row without erroring."""
    existing = (
        await session.execute(select(User).where(User.logto_user_id == logto_user_id))
    ).scalar_one_or_none()
    if existing is not None:
        return existing
    await session.execute(
        pg_insert(User)
        .values(
            id=uuid.uuid4(),
            logto_user_id=logto_user_id,
            email=email,
            display_name=display_name,
        )
        .on_conflict_do_nothing(index_elements=["logto_user_id"])
    )
    await session.flush()
    # Re-select: returns our freshly inserted row, or the row a concurrent request
    # committed first (read-committed makes the winner visible after our INSERT).
    return (
        await session.execute(select(User).where(User.logto_user_id == logto_user_id))
    ).scalar_one()


async def get_current_user(
    authorization: str | None = Header(default=None),
    x_dev_user: str | None = Header(default=None, alias="X-Dev-User"),
    x_dev_email: str | None = Header(default=None, alias="X-Dev-Email"),
    x_dev_name: str | None = Header(default=None, alias="X-Dev-Name"),
    session: AsyncSession = Depends(get_session),
    settings: Settings = Depends(get_settings),
    jwks_cache: JwksCache = Depends(get_jwks_cache),
) -> User:
    """Resolve the authenticated user.

    Real path: a Logto `Authorization: Bearer <jwt>` (validated via JWKS, iss/aud/exp).
    Dev path: the `X-Dev-User` seam, only when `dev_auth_enabled` is True AND no
    Authorization header is present. A present-but-invalid bearer is a hard 401 and
    never falls through to the dev path. Production runs with dev_auth_enabled=False,
    so only the real path can authenticate."""
    if authorization is not None:
        scheme, _, token = authorization.partition(" ")
        if scheme.lower() != "bearer" or not token.strip():
            logger.warning(
                "auth failed",
                extra={"reason": "malformed_authorization_header", "kid": None},
            )
            raise HTTPException(status.HTTP_401_UNAUTHORIZED, detail="invalid authorization header")
        try:
            claims = await validate_bearer_token(token.strip(), settings, jwks_cache)
        except AuthError as exc:
            # request_id is auto-stamped by RequestIdFilter; kid aids rotation/flood triage.
            # Never log the token, full JWT, or the unverified sub.
            logger.warning("auth failed", extra={"reason": exc.reason, "kid": exc.kid})
            raise HTTPException(status.HTTP_401_UNAUTHORIZED, detail="invalid token") from exc
        sub = claims["sub"]
        # Validated sub only (safe — signature/iss/aud/exp all verified). DEBUG so it does
        # not add a line to every authenticated request in prod (default INFO).
        logger.debug("authenticated request", extra={"sub": sub})
        email = claims.get("email") or f"{sub}@users.noreply.fountainrank.com"
        display_name = claims.get("name") or claims.get("username") or sub
        return await get_or_create_user(
            session, logto_user_id=sub, email=email, display_name=display_name
        )

    if settings.dev_auth_enabled and x_dev_user:
        return await get_or_create_user(
            session,
            logto_user_id=x_dev_user,
            email=x_dev_email or f"{x_dev_user}@dev.local",
            display_name=x_dev_name or x_dev_user,
        )

    raise HTTPException(status.HTTP_401_UNAUTHORIZED, detail="authentication required")
