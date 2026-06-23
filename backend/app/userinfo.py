"""Logto userinfo client + profile normalization.

The backend learns a user's real profile (email/name/avatar) by calling Logto's
userinfo endpoint with the OPAQUE access token forwarded by the web BFF (a resource
JWT is rejected at userinfo). The token is used only for this call and never logged.
"""

import json
from collections.abc import Awaitable, Callable
from urllib.parse import urlparse

import httpx
from fastapi import Depends
from pydantic import BaseModel, ConfigDict, ValidationError, field_validator

from app.config import Settings, get_settings

MAX_USERINFO_BYTES = 65536
_MAX_AVATAR_LEN = 2048
SYNTHETIC_EMAIL_DOMAIN = "@users.noreply.fountainrank.com"
APPLE_PRIVATE_RELAY_DOMAIN = "privaterelay.appleid.com"


class UserinfoError(Exception):
    """Userinfo could not be fetched/parsed. The endpoint maps this to HTTP 502.
    `reason` is a short machine code for logging — never contains token material."""

    def __init__(self, reason: str):
        self.reason = reason
        super().__init__(reason)


class UserinfoClaims(BaseModel):
    model_config = ConfigDict(extra="ignore")

    sub: str
    email: str | None = None
    email_verified: bool | None = None
    name: str | None = None
    username: str | None = None
    picture: str | None = None

    @field_validator("sub")
    @classmethod
    def _sub_non_blank(cls, v: str) -> str:
        v = v.strip()
        if not v:
            raise ValueError("blank sub")
        return v


async def fetch_userinfo(
    token: str,
    settings: Settings,
    *,
    transport: httpx.AsyncBaseTransport | None = None,
) -> UserinfoClaims:
    """GET Logto userinfo with the opaque bearer token, streaming the body and aborting past
    MAX_USERINFO_BYTES. Raises UserinfoError (->502) on any network/timeout/non-200/oversized/
    malformed/missing-or-blank-sub condition; the token is never included in the error."""
    try:
        async with httpx.AsyncClient(
            timeout=5.0, follow_redirects=False, transport=transport
        ) as client:
            async with client.stream(
                "GET",
                settings.logto_userinfo_uri,
                headers={"Authorization": f"Bearer {token}"},
            ) as resp:
                if resp.status_code != 200:
                    raise UserinfoError("userinfo_status")
                chunks: list[bytes] = []
                total = 0
                async for chunk in resp.aiter_bytes():
                    total += len(chunk)
                    if total > MAX_USERINFO_BYTES:
                        raise UserinfoError("userinfo_too_large")
                    chunks.append(chunk)
    except httpx.HTTPError as exc:
        raise UserinfoError("userinfo_unreachable") from exc
    try:
        data = json.loads(b"".join(chunks))
    except ValueError as exc:
        raise UserinfoError("userinfo_malformed") from exc
    try:
        return UserinfoClaims.model_validate(data)
    except ValidationError as exc:
        raise UserinfoError("userinfo_invalid") from exc


UserinfoFetcher = Callable[[str], Awaitable[UserinfoClaims]]


def get_userinfo_fetcher(settings: Settings = Depends(get_settings)) -> UserinfoFetcher:
    """FastAPI dependency; overridden in endpoint tests with a fake fetcher (no network)."""

    async def fetcher(token: str) -> UserinfoClaims:
        return await fetch_userinfo(token, settings)

    return fetcher


def accept_email(claims: UserinfoClaims, *, current: str) -> str:
    """Return the email to store: the userinfo email only if it is a valid, non-synthetic,
    non-unverified address; otherwise the existing value (never overwrite a real email
    with junk)."""
    email = (claims.email or "").strip()
    if not email:
        return current
    if claims.email_verified is False:
        return current
    if email.lower().endswith(SYNTHETIC_EMAIL_DOMAIN):
        return current
    if email.lower().endswith("@" + APPLE_PRIVATE_RELAY_DOMAIN):
        return current
    if any(ch.isspace() for ch in email):
        return current
    local, sep, domain = email.partition("@")
    if not sep or not local or not domain or "@" in domain:
        return current
    return email


def pick_display_name(claims: UserinfoClaims, *, current: str, sub: str) -> str:
    for candidate in (claims.name, claims.username, current, sub):
        if candidate and candidate.strip():
            return candidate.strip()
    return sub


def accept_avatar(claims: UserinfoClaims, *, current: str | None) -> str | None:
    pic = (claims.picture or "").strip()
    if not pic or len(pic) > _MAX_AVATAR_LEN or any(ch.isspace() for ch in pic):
        return current
    parsed = urlparse(pic)
    if parsed.scheme != "https" or not parsed.netloc:
        return current
    return pic
