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
from typing import Protocol

import httpx

from app.schemas import GeocodeResult

# Fixed, HTTPS-only provider endpoint. Not a setting (spec §8.2/§8.4) — swapping providers
# is a code change, never an env knob.
LOCATIONIQ_URL = "https://us1.locationiq.com/v1/autocomplete"
MAX_GEOCODE_RESPONSE_BYTES = 65536


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


class GeocodeProvider(Protocol):
    async def search(
        self, q: str, limit: int, bias: tuple[float, float] | None
    ) -> list[GeocodeResult]: ...


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
