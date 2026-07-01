"""Public geocode proxy endpoint (spec §8.1, §9): `GET /api/v1/geocode`. Unauthenticated —
browsing/reads are public in this app, and forcing sign-in to search would break that
principle; abuse is bounded by the provider's own no-overage quota (spec §8.3), not by an
auth wall. Never a silent 500: a disabled/misconfigured provider is `503 geocoding_disabled`,
a throttle trip is `429` (+ a short `Retry-After`), an upstream transport/parse failure is
`502 geocoding_upstream`, and a provider quota-exhaustion fails closed to
`503 geocoding_unavailable`.
"""

import logging
import time
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import StringConstraints

from app.geocoding import (
    GeocodeProvider,
    GeocodeQuotaError,
    GeocodeThrottled,
    GeocodeUpstreamError,
    get_geocode_provider,
)
from app.schemas import GeocodeResponse

router = APIRouter(prefix="/api/v1", tags=["geocode"])
logger = logging.getLogger("app.geocode")

# The coarse in-process throttle (spec §8.3) is a politeness/UX guard, not the spend
# boundary, so a short fixed backoff hint is enough -- clients should back off a beat,
# not retry immediately.
THROTTLE_RETRY_AFTER_SECONDS = "1"


def _cache_status(
    provider: GeocodeProvider, q: str, limit: int, bias: tuple[float, float] | None
) -> str:
    """Best-effort cache-hit peek for logging only (spec §9). Duck-types the private
    `_cache` attribute `CachedGeocodeProvider` exposes so per-request logging can report
    `cache: hit|miss` without widening the `GeocodeProvider` protocol or touching the
    throttle. A provider that doesn't expose one (e.g. a test fake) reports "miss" -- a
    safe default meaning "not confirmed cached", never a crash."""
    cache = getattr(provider, "_cache", None)
    if cache is None:
        return "miss"
    return "hit" if cache.get(q, limit, bias) is not None else "miss"


@router.get(
    "/geocode",
    response_model=GeocodeResponse,
    responses={
        status.HTTP_429_TOO_MANY_REQUESTS: {
            "description": "Throttled; retry after the interval in `Retry-After`."
        },
        status.HTTP_502_BAD_GATEWAY: {
            "description": "The upstream geocoding provider failed (network/parse)."
        },
        status.HTTP_503_SERVICE_UNAVAILABLE: {
            "description": (
                "Geocoding is disabled/unconfigured, or the provider's quota is exhausted."
            )
        },
    },
)
async def geocode(
    q: Annotated[str, StringConstraints(strip_whitespace=True, min_length=3, max_length=120)],
    limit: int = Query(5),
    lat: float | None = Query(None, ge=-90, le=90),
    lng: float | None = Query(None, ge=-180, le=180),
    provider: GeocodeProvider | None = Depends(get_geocode_provider),
) -> GeocodeResponse:
    if provider is None:
        # The ordinary unconfigured-local-dev state (no key) and an unknown/typo'd
        # provider name both surface as None here (spec §8.4) -- either way, fail closed
        # without crashing. get_geocode_provider already logs the misconfigured-provider
        # case; nothing further to log per-request for the routine disabled state.
        raise HTTPException(status.HTTP_503_SERVICE_UNAVAILABLE, detail="geocoding_disabled")

    # Never trust the client to bound provider cost (spec §8.1): clamp, don't reject.
    limit = max(1, min(10, limit))
    # Bias is applied only when BOTH coordinates are present and valid; an out-of-range
    # value alone already 422'd via the Query(ge=/le=) constraints above (spec §8.1).
    bias = (lat, lng) if lat is not None and lng is not None else None

    cache_status = _cache_status(provider, q, limit, bias)
    start = time.monotonic()
    try:
        results = await provider.search(q, limit, bias)
    except GeocodeThrottled as exc:
        # Best-effort UX guard, not a security/spend boundary (spec §8.3) -- logged at
        # INFO (not a warning/error) so throttling is diagnosable without alarm-fatigue.
        logger.info(
            "geocode throttled",
            extra={"reason": exc.reason, "query_length": len(q), "limit": limit},
        )
        raise HTTPException(
            status.HTTP_429_TOO_MANY_REQUESTS,
            detail="geocode_throttled",
            headers={"Retry-After": THROTTLE_RETRY_AFTER_SECONDS},
        ) from exc
    except GeocodeQuotaError as exc:
        # Provider's own no-overage quota exhausted (spec §8.3) -- fail closed rather
        # than retry-storm; never bill past the hard cap.
        logger.warning(
            "geocode quota exhausted",
            extra={"reason": exc.reason, "query_length": len(q), "limit": limit},
        )
        raise HTTPException(
            status.HTTP_503_SERVICE_UNAVAILABLE, detail="geocoding_unavailable"
        ) from exc
    except GeocodeUpstreamError as exc:
        # Transport/timeout/non-200/oversized/malformed (mirrors userinfo.py's
        # UserinfoError -> 502). `reason` is a short machine code, never the key/URL.
        logger.error(
            "geocode upstream failure",
            extra={"reason": exc.reason, "query_length": len(q), "limit": limit},
        )
        raise HTTPException(status.HTTP_502_BAD_GATEWAY, detail="geocoding_upstream") from exc

    latency_ms = round((time.monotonic() - start) * 1000, 2)
    # NEVER log `q` itself (a typed address/city is user-controlled location data, PII) --
    # only its length. The request id is already stamped onto every record by
    # RequestIdFilter (app.logging_config), so it needn't be added again here.
    logger.info(
        "geocode request",
        extra={
            "query_length": len(q),
            "result_count": len(results),
            "limit": limit,
            "bias_applied": bias is not None,
            "cache": cache_status,
            "latency_ms": latency_ms,
        },
    )
    return GeocodeResponse(results=results)
