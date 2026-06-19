"""Logto JWT access-token validation.

Turns a bearer token string into verified claims: ES384 signature checked against
Logto's JWKS, with `iss`/`aud`/`exp` enforced. The algorithm is a hardcoded allowlist
(never the token header's `alg`) to defeat alg-confusion / `none` attacks. The JWKS is
cached with a TTL and a minimum refetch interval so unknown-`kid` floods cannot force
unbounded network fetches. See the Phase 2a design spec under docs/specs/.
"""

import asyncio
import time
from collections.abc import Awaitable, Callable

import httpx
import jwt

from app.config import Settings

_ALGORITHMS = ["ES384"]
_LEEWAY_SECONDS = 60


class AuthError(Exception):
    """A bearer token could not be validated. The resolver maps this to HTTP 401.

    `reason` is a short machine code for logging — never contains token material.
    `kid` is the (unverified) key id from the token header when known, for log
    correlation only (distinguishes unknown-kid / rotation misses from generic
    invalid-token traffic). The unverified `sub` is deliberately NOT carried — it is
    attacker-controlled and must not be logged as identity.
    """

    def __init__(self, reason: str, *, kid: str | None = None):
        self.reason = reason
        self.kid = kid
        super().__init__(reason)


class JwksCache:
    """Async, kid-keyed JWKS cache.

    Fast path serves a known key while the set is fresh (< ttl). A miss (unknown or
    stale kid) refetches under a lock, rate-limited by `min_refetch_interval` so a
    flood of bogus kids triggers at most one fetch per interval. `fetch` is injectable
    for tests (no network)."""

    def __init__(
        self,
        jwks_uri: str,
        ttl_seconds: int,
        *,
        fetch: Callable[[], Awaitable[dict]] | None = None,
        min_refetch_interval: float = 10.0,
    ):
        self._jwks_uri = jwks_uri
        self._ttl = ttl_seconds
        self._fetch_override = fetch
        self._min_refetch_interval = min_refetch_interval
        self._keys: dict[str, jwt.PyJWK] = {}
        self._fetched_at = 0.0
        # None = never attempted -> the first fetch is always allowed. NOT 0.0: monotonic()'s
        # origin is arbitrary, so `now - 0.0 < interval` could spuriously block the first fetch.
        self._last_attempt: float | None = None
        self._lock = asyncio.Lock()

    async def _fetch(self) -> dict:
        if self._fetch_override is not None:
            return await self._fetch_override()
        async with httpx.AsyncClient(timeout=5.0) as client:
            resp = await client.get(self._jwks_uri)
            resp.raise_for_status()
            return resp.json()

    def _fresh(self, now: float) -> bool:
        return (now - self._fetched_at) < self._ttl

    async def get_key(self, kid: str) -> jwt.PyJWK:
        now = time.monotonic()
        if kid in self._keys and self._fresh(now):
            return self._keys[kid]
        async with self._lock:
            now = time.monotonic()
            if kid in self._keys and self._fresh(now):
                return self._keys[kid]
            # Reaching here means the key is unknown OR the cache is stale -> a refetch is
            # required. Rate-limit network fetches so an unknown-kid flood or a JWKS outage
            # can't hammer Logto. If we cannot refetch yet, FAIL CLOSED — never serve a
            # stale/expired key (a rotated-out key must stop being accepted once TTL lapses).
            # The first fetch is always allowed (_last_attempt is None).
            may_refetch = (
                self._last_attempt is None
                or (now - self._last_attempt) >= self._min_refetch_interval
            )
            if not may_refetch:
                raise AuthError("jwks_unavailable")
            self._last_attempt = now
            try:
                raw = await self._fetch()
            except Exception as exc:  # network / HTTP / JSON decode error
                raise AuthError("jwks_fetch_failed") from exc
            try:
                key_set = jwt.PyJWKSet.from_dict(raw)
            except Exception as exc:  # malformed/unexpected JWKS body or unusable key
                raise AuthError("jwks_invalid") from exc
            self._keys = {k.key_id: k for k in key_set.keys if k.key_id}
            self._fetched_at = now
            if kid in self._keys:
                return self._keys[kid]
            raise AuthError("unknown_kid")


async def validate_bearer_token(token: str, settings: Settings, cache: JwksCache) -> dict:
    """Verify a Logto JWT access token and return its claims. Raises AuthError on any
    failure (mapped to 401 by the caller). `sub` is guaranteed present on success."""
    try:
        header = jwt.get_unverified_header(token)
    except jwt.PyJWTError as exc:
        raise AuthError("malformed_token") from exc
    kid = header.get("kid")
    if header.get("alg") not in _ALGORITHMS:
        raise AuthError("unexpected_alg", kid=kid)
    if not kid:
        raise AuthError("missing_kid")
    try:
        signing_key = await cache.get_key(kid)
    except AuthError as exc:
        if exc.kid is None:
            exc.kid = kid  # annotate cache-raised errors (unknown_kid / jwks_fetch_failed)
        raise
    try:
        return jwt.decode(
            token,
            signing_key.key,
            algorithms=_ALGORITHMS,
            audience=settings.logto_audience,
            issuer=settings.logto_issuer,
            leeway=_LEEWAY_SECONDS,
            options={"require": ["exp", "iss", "aud", "sub"]},
        )
    except jwt.PyJWTError as exc:
        raise AuthError(f"invalid_token:{type(exc).__name__}", kid=kid) from exc
