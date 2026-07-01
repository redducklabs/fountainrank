"""Geocode provider abstraction + LocationIQ implementation (spec §8.2).

The provider host/base URL is a hardcoded, module-level HTTPS constant — never an
operator-configurable setting — so the user query and the (validated) viewport bias only
ever fill query-string params; they never influence the host, scheme, or path. This removes
the SSRF/misrouting footgun entirely: there is no `GEOCODING_BASE_URL` env knob.

The outbound call mirrors `app/userinfo.py`'s guards: HTTPS-only, `follow_redirects=False`
(a redirect is a provider/misconfig error, never chased), an explicit timeout, a streamed
body capped at a max-bytes limit, and typed errors. The API key is passed as the provider's
own query param; it is never placed in a log message or any other constructed string.
"""

import json
import logging
import time
from collections import OrderedDict
from collections.abc import Callable
from typing import Protocol

import httpx
from fastapi import Depends

from app.config import Settings, get_settings
from app.schemas import GeocodeResult

logger = logging.getLogger(__name__)

# Fixed, HTTPS-only provider endpoint. Not a setting (spec §8.2/§8.4) — swapping providers
# is a code change, never an env knob.
LOCATIONIQ_URL = "https://us1.locationiq.com/v1/autocomplete"
MAX_GEOCODE_RESPONSE_BYTES = 65536

# Cache/throttle tuning that is deliberately NOT operator-configurable (spec §8.3/§8.4):
# Task 2's settings cover the TTL and throttle rate; the geo-rounding grid and the
# cache's bounded size are code constants, not env knobs.
GEOCODE_BIAS_GRID_DEGREES = 0.1
GEOCODE_CACHE_MAX_ENTRIES = 512

# Providers `get_geocode_provider` (spec §8.4) knows how to build. Only LocationIQ is
# wired in this PR; an unrecognized value (typo or a not-yet-supported provider) is
# treated the same as "disabled" rather than crashing.
KNOWN_GEOCODE_PROVIDERS = {"locationiq"}


class GeocodeUpstreamError(Exception):
    """The provider call failed (transport/timeout/non-200/oversized/malformed). The
    endpoint maps this to HTTP 502. `reason` is a short machine code for logging — it
    never contains the API key or a constructed URL."""

    def __init__(self, reason: str):
        self.reason = reason
        super().__init__(reason)


class GeocodeQuotaError(GeocodeUpstreamError):
    """The provider returned 429 (its no-overage quota is exhausted, spec §8.3). The
    endpoint fails closed to 503 rather than retrying or surfacing a generic 502."""

    def __init__(self):
        super().__init__("geocode_quota_exhausted")


class GeocodeThrottled(Exception):
    """The coarse per-pod throttle (spec §8.3) rejected this call. This is a best-effort
    UX guard that smooths bursts and shields users from provider-side throttling — it is
    explicitly NOT a security or spend boundary (the provider's own no-overage quota is).
    The endpoint (Task 5) maps this to HTTP 429 with a short `Retry-After` and logs it at
    INFO (spec §9); `reason` is a short machine code, never sensitive."""

    def __init__(self):
        self.reason = "geocode_throttled"
        super().__init__(self.reason)


class GeocodeProvider(Protocol):
    async def search(
        self, q: str, limit: int, bias: tuple[float, float] | None
    ) -> list[GeocodeResult]:
        """`bias`, when present, is `(latitude, longitude)` — the house convention used
        throughout this module (never the PostGIS-style `(lon, lat)` order)."""
        ...


def _normalize_hits(data: object) -> list[GeocodeResult]:
    """Map raw provider hits to GeocodeResult, silently skipping malformed/incomplete
    entries (missing/blank display_name, missing/non-numeric lat or lon, spec §8.2)."""
    if not isinstance(data, list):
        return []
    results: list[GeocodeResult] = []
    for hit in data:
        if not isinstance(hit, dict):
            continue
        label = hit.get("display_name")
        if not isinstance(label, str) or not label.strip():
            continue
        try:
            latitude = float(hit["lat"])
            longitude = float(hit["lon"])
        except (KeyError, TypeError, ValueError):
            continue
        results.append(GeocodeResult(label=label, latitude=latitude, longitude=longitude))
    return results


class LocationIQProvider:
    """Calls LocationIQ's autocomplete endpoint (host fixed by LOCATIONIQ_URL above)."""

    def __init__(self, api_key: str, *, transport: httpx.AsyncBaseTransport | None = None):
        self._api_key = api_key
        self._transport = transport

    async def search(
        self, q: str, limit: int, bias: tuple[float, float] | None
    ) -> list[GeocodeResult]:
        # Only query-string params are ever filled from caller input — the host/scheme/path
        # above are a fixed constant, never touched here.
        params: dict[str, str | int | float] = {
            "key": self._api_key,
            "q": q,
            "limit": limit,
            "format": "json",
        }
        if bias is not None:
            lat, lon = bias
            params["lat"] = lat
            params["lon"] = lon
        try:
            async with httpx.AsyncClient(
                timeout=5.0, follow_redirects=False, transport=self._transport
            ) as client:
                async with client.stream("GET", LOCATIONIQ_URL, params=params) as resp:
                    if resp.status_code == 429:
                        raise GeocodeQuotaError()
                    if resp.status_code != 200:
                        raise GeocodeUpstreamError("geocode_status")
                    chunks: list[bytes] = []
                    total = 0
                    async for chunk in resp.aiter_bytes():
                        total += len(chunk)
                        if total > MAX_GEOCODE_RESPONSE_BYTES:
                            raise GeocodeUpstreamError("geocode_too_large")
                        chunks.append(chunk)
        except httpx.HTTPError as exc:
            raise GeocodeUpstreamError("geocode_unreachable") from exc
        try:
            data = json.loads(b"".join(chunks))
        except ValueError as exc:
            raise GeocodeUpstreamError("geocode_malformed") from exc
        return _normalize_hits(data)


# Cache key: (normalized_q, limit, rounded_bias). `rounded_bias` mirrors the module's
# (lat, lng) house convention (see GeocodeProvider.search above).
_CacheKey = tuple[str, int, tuple[float, float] | None]


class GeocodeCache:
    """Bounded TTL/LRU response cache keyed by `(normalized_q, limit, rounded_bias)`
    (spec §8.3): a short-TTL, in-process, per-pod cache to reduce upstream calls and
    shield users from provider throttling. It is process-local and never shared or
    persisted.

    **Privacy:** the key embeds the normalized query, which is user-typed location data
    (PII, spec §9) — so this cache deliberately exposes NO accessor that returns raw
    keys/queries (no `.keys()`/`.items()`-style diagnostic leak path); only `get`/`set`
    by the same `(q, limit, bias)` triple a caller already holds.

    `now` is an injected clock (`Callable[[], float]`) so tests are deterministic — the
    cache itself never makes a direct wall-clock call.
    """

    def __init__(
        self,
        ttl_seconds: float,
        max_entries: int,
        *,
        now: Callable[[], float] = time.monotonic,
        bias_grid_degrees: float = GEOCODE_BIAS_GRID_DEGREES,
    ):
        if ttl_seconds <= 0:
            raise ValueError("ttl_seconds must be positive")
        if max_entries <= 0:
            raise ValueError("max_entries must be positive")
        self._ttl = ttl_seconds
        self._max_entries = max_entries
        self._now = now
        self._bias_grid = bias_grid_degrees
        self._store: OrderedDict[_CacheKey, tuple[float, list[GeocodeResult]]] = OrderedDict()

    def _key(self, q: str, limit: int, bias: tuple[float, float] | None) -> _CacheKey:
        # Whitespace/case-insensitive so "Main St", " main st ", and "MAIN ST" collapse
        # to one entry (spec §8.3).
        normalized_q = " ".join(q.strip().lower().split())
        rounded_bias: tuple[float, float] | None = None
        if bias is not None:
            lat, lng = bias
            grid = self._bias_grid
            rounded_bias = (round(lat / grid) * grid, round(lng / grid) * grid)
        return (normalized_q, limit, rounded_bias)

    def get(
        self, q: str, limit: int, bias: tuple[float, float] | None
    ) -> list[GeocodeResult] | None:
        key = self._key(q, limit, bias)
        entry = self._store.get(key)
        if entry is None:
            return None
        expires_at, results = entry
        if self._now() >= expires_at:
            del self._store[key]
            return None
        self._store.move_to_end(key)  # LRU: refresh recency on a hit
        return results

    def set(
        self,
        q: str,
        limit: int,
        bias: tuple[float, float] | None,
        results: list[GeocodeResult],
    ) -> None:
        key = self._key(q, limit, bias)
        self._store[key] = (self._now() + self._ttl, results)
        self._store.move_to_end(key)
        while len(self._store) > self._max_entries:
            self._store.popitem(last=False)  # evict least-recently-used


class GeocodeThrottle:
    """Coarse per-pod token-bucket throttle (spec §8.3): a politeness/UX guard that
    smooths bursts and shields users from provider-side throttling. It is explicitly
    **not** a security or spend boundary — DOKS runs multiple backend replicas, each
    with its own bucket, so a cap of N here permits `N × replica_count` process-wide;
    the provider's own no-overage quota is the real spend guard (spec §8.3).

    Continuously refills at `capacity / window_seconds` tokens/sec, so a fully-drained
    bucket is back at capacity exactly `window_seconds` later. `now` is an injected
    clock so tests are deterministic — never a direct wall-clock call.
    """

    def __init__(
        self,
        capacity: int,
        window_seconds: float,
        *,
        now: Callable[[], float] = time.monotonic,
    ):
        if capacity <= 0:
            raise ValueError("capacity must be positive")
        if window_seconds <= 0:
            raise ValueError("window_seconds must be positive")
        self._capacity = float(capacity)
        self._refill_per_second = capacity / window_seconds
        self._now = now
        self._tokens = float(capacity)
        self._updated_at = now()

    def allow(self) -> bool:
        """Consume one token and return True, or return False when exhausted."""
        current = self._now()
        elapsed = max(0.0, current - self._updated_at)
        self._updated_at = current
        self._tokens = min(self._capacity, self._tokens + elapsed * self._refill_per_second)
        if self._tokens < 1.0:
            return False
        self._tokens -= 1.0
        return True


class CachedGeocodeProvider:
    """Wraps a `GeocodeProvider` with the process-local cache + coarse throttle (spec
    §8.3). A cache hit is served without touching the throttle or the inner provider —
    the throttle exists only to bound upstream calls, and a cache hit makes none."""

    def __init__(self, inner: GeocodeProvider, *, cache: GeocodeCache, throttle: GeocodeThrottle):
        self._inner = inner
        self._cache = cache
        self._throttle = throttle

    async def search(
        self, q: str, limit: int, bias: tuple[float, float] | None
    ) -> list[GeocodeResult]:
        cached = self._cache.get(q, limit, bias)
        if cached is not None:
            return cached
        if not self._throttle.allow():
            raise GeocodeThrottled()
        results = await self._inner.search(q, limit, bias)
        self._cache.set(q, limit, bias, results)
        return results


# Process-wide singleton (built once, reused across requests) so the cache/throttle
# state it holds actually persists — mirrors `get_jwks_cache`/`get_gmail_sender`.
_provider: GeocodeProvider | None = None


def get_geocode_provider(settings: Settings = Depends(get_settings)) -> GeocodeProvider | None:
    """FastAPI dependency (spec §8.4). Returns the process-wide cache+throttle-wrapped
    provider when geocoding is enabled (an API key is set) AND `geocoding_provider` is a
    known value; otherwise returns `None` — a "disabled" marker the endpoint (Task 5)
    checks to fail closed to `503 geocoding_disabled` without crashing.

    An unset key is the ordinary unconfigured-local-dev state and is not logged. An
    unknown/typo'd provider name IS a misconfiguration worth surfacing, so it logs a
    redacted WARNING (the provider name only — never the API key, spec §8.4/§9)."""
    if not settings.geocoding_enabled:
        return None
    if settings.geocoding_provider not in KNOWN_GEOCODE_PROVIDERS:
        logger.warning(
            "geocoding disabled: unknown provider",
            extra={"provider": settings.geocoding_provider},
        )
        return None
    global _provider
    if _provider is None:
        api_key = settings.geocoding_api_key
        if not api_key:
            # Unreachable in practice: geocoding_enabled (checked above) already
            # guarantees a non-empty key. Fail closed rather than construct a
            # provider with a blank key.
            return None
        _provider = CachedGeocodeProvider(
            LocationIQProvider(api_key),
            cache=GeocodeCache(settings.geocoding_cache_ttl_seconds, GEOCODE_CACHE_MAX_ENTRIES),
            throttle=GeocodeThrottle(
                settings.geocoding_throttle_max_per_window,
                settings.geocoding_throttle_window_seconds,
            ),
        )
    return _provider
