import logging
import uuid

from fastapi import Depends, Header, HTTPException, status
from sqlalchemy import select
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import Settings, get_settings
from app.db import get_session
from app.display import resolved_display_name
from app.logto_auth import AuthError, JwksCache, validate_bearer_token
from app.models import DeletedAccount, User

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
    deleted = (
        await session.execute(
            select(DeletedAccount).where(DeletedAccount.logto_user_id == logto_user_id)
        )
    ).scalar_one_or_none()
    if deleted is not None:
        logger.warning("auth rejected for deleted account")
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, detail="account deleted")

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


async def _reconcile_admin(session: AsyncSession, user: User, sub: str, settings: Settings) -> User:
    """Authoritative, request-time admin reconciliation: User.is_admin tracks
    `sub in settings.admin_subjects` (exact, case-sensitive). Write-if-changed only —
    steady state issues no write. Grant and demotion both take effect on the next
    authenticated request. The user row is already provisioned; this independent update
    is committed here so /me and admin gates read a fresh value."""
    desired = sub in settings.admin_subjects
    if user.is_admin != desired:
        previous = user.is_admin
        user.is_admin = desired
        await session.commit()
        await session.refresh(user)
        logger.info(
            "admin status changed",
            extra={"sub": sub, "previous": previous, "current": desired},
        )
    return user


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
        user = await get_or_create_user(
            session, logto_user_id=sub, email=email, display_name=display_name
        )
        return await _reconcile_admin(session, user, sub, settings)

    if settings.dev_auth_enabled and x_dev_user:
        user = await get_or_create_user(
            session,
            logto_user_id=x_dev_user,
            email=x_dev_email or f"{x_dev_user}@dev.local",
            display_name=x_dev_name or x_dev_user,
        )
        return await _reconcile_admin(session, user, x_dev_user, settings)

    raise HTTPException(status.HTTP_401_UNAUTHORIZED, detail="authentication required")


async def require_admin(user: User = Depends(get_current_user)) -> User:
    if not user.is_admin:
        logger.warning(
            "non-admin attempted admin access",
            extra={"sub": user.logto_user_id, "user_id": str(user.id)},
        )
        raise HTTPException(status.HTTP_403_FORBIDDEN, detail="admin required")
    return user


async def require_named_user(user: User = Depends(get_current_user)) -> User:
    """Gate contribution-write endpoints: a user whose name resolves to "Anonymous" (no nickname
    and display_name == subject) must set a display name first (kill Anonymous). Reads, GET/PATCH
    /me, and admin endpoints are intentionally NOT gated."""
    return ensure_named_user(user)


def ensure_named_user(user: User) -> User:
    """Pure contribution name guard, usable after an endpoint's early rate reservation."""
    if resolved_display_name(user.display_name, user.logto_user_id, user.nickname) is None:
        logger.warning("contribution blocked: no display name", extra={"user_id": str(user.id)})
        raise HTTPException(status.HTTP_409_CONFLICT, detail="display_name_required")
    return user


async def get_optional_user(
    authorization: str | None = Header(default=None),
    x_dev_user: str | None = Header(default=None, alias="X-Dev-User"),
    x_dev_email: str | None = Header(default=None, alias="X-Dev-Email"),
    x_dev_name: str | None = Header(default=None, alias="X-Dev-Name"),
    session: AsyncSession = Depends(get_session),
    settings: Settings = Depends(get_settings),
    jwks_cache: JwksCache = Depends(get_jwks_cache),
) -> User | None:
    """Resolve the user when credentials are present, else None.

    For public endpoints that enrich the response for a signed-in user (e.g. the
    caller's own rating on a fountain). When NO credentials are present we return
    None instead of 401 so anonymous browsing still works; a present-but-INVALID
    bearer is still a hard 401 (delegated to get_current_user) — never silently
    downgraded to anonymous, so an auth failure can't be masked."""
    if authorization is None and not (settings.dev_auth_enabled and x_dev_user):
        return None
    return await get_current_user(
        authorization=authorization,
        x_dev_user=x_dev_user,
        x_dev_email=x_dev_email,
        x_dev_name=x_dev_name,
        session=session,
        settings=settings,
        jwks_cache=jwks_cache,
    )
