"""Geocode-proxy tests. Config + response-schema coverage lands here first (spec §8.4, §8.1);
the provider is added here (spec §8.2); the cache/throttle/factory are added here (spec §8.3,
§8.4, Task 4); the router/endpoint tests are added in a later task as this file grows."""

import logging

import httpx
import pytest

from app.config import Settings
from app.geocoding import (
    LOCATIONIQ_URL,
    CachedGeocodeProvider,
    GeocodeCache,
    GeocodeQuotaError,
    GeocodeThrottle,
    GeocodeThrottled,
    GeocodeUpstreamError,
    LocationIQProvider,
    get_geocode_provider,
)
from app.schemas import GeocodeResponse, GeocodeResult


def test_geocoding_defaults_disabled():
    s = Settings()
    assert s.geocoding_provider == "locationiq"
    assert s.geocoding_api_key is None
    assert s.geocoding_enabled is False


def test_geocoding_api_key_enables():
    s = Settings(geocoding_api_key="key-123")
    assert s.geocoding_enabled is True


def test_geocoding_cache_ttl_default():
    assert Settings().geocoding_cache_ttl_seconds == 300


def test_geocoding_throttle_defaults_are_sane():
    s = Settings()
    assert isinstance(s.geocoding_throttle_max_per_window, int)
    assert s.geocoding_throttle_max_per_window > 0
    assert isinstance(s.geocoding_throttle_window_seconds, int)
    assert s.geocoding_throttle_window_seconds > 0


def test_geocode_result_constructs_and_serializes_with_latlng():
    result = GeocodeResult(label="123 Main St", latitude=40.7128, longitude=-74.0060)
    assert result.model_dump() == {
        "label": "123 Main St",
        "latitude": 40.7128,
        "longitude": -74.0060,
    }


def test_geocode_response_wraps_results_list():
    resp = GeocodeResponse(results=[GeocodeResult(label="A", latitude=1.0, longitude=2.0)])
    assert resp.model_dump() == {"results": [{"label": "A", "latitude": 1.0, "longitude": 2.0}]}


def test_geocode_response_empty_results():
    assert GeocodeResponse(results=[]).model_dump() == {"results": []}


# --- LocationIQProvider (spec §8.2) ---


def _transport(handler):
    return httpx.MockTransport(handler)


_HITS = [
    {"display_name": "123 Main St, Springfield", "lat": "40.7128", "lon": "-74.0060"},
    {"display_name": "456 Oak Ave, Shelbyville", "lat": 34.05, "lon": -118.25},
]


async def test_locationiq_search_happy_path_maps_hits():
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(200, json=_HITS)

    provider = LocationIQProvider("test-key", transport=_transport(handler))
    results = await provider.search("main st", 5, None)

    assert results == [
        GeocodeResult(label="123 Main St, Springfield", latitude=40.7128, longitude=-74.0060),
        GeocodeResult(label="456 Oak Ave, Shelbyville", latitude=34.05, longitude=-118.25),
    ]
    for r in results:
        assert isinstance(r.latitude, float)
        assert isinstance(r.longitude, float)


async def test_locationiq_search_skips_malformed_entries():
    hits = [
        {"display_name": "Good One", "lat": "1.0", "lon": "2.0"},
        {"display_name": "Missing lat", "lon": "2.0"},
        {"display_name": "Missing lon", "lat": "1.0"},
        {"lat": "1.0", "lon": "2.0"},  # missing display_name
        {"display_name": "Bad lat", "lat": "not-a-number", "lon": "2.0"},
        {"display_name": "", "lat": "1.0", "lon": "2.0"},  # blank label
        "not-a-dict",
    ]

    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(200, json=hits)

    provider = LocationIQProvider("test-key", transport=_transport(handler))
    results = await provider.search("q", 5, None)

    assert results == [GeocodeResult(label="Good One", latitude=1.0, longitude=2.0)]


async def test_locationiq_search_query_and_bias_only_fill_query_params():
    captured: list[httpx.Request] = []

    def handler(request: httpx.Request) -> httpx.Response:
        captured.append(request)
        return httpx.Response(200, json=[])

    provider = LocationIQProvider("secret-key-abc", transport=_transport(handler))
    await provider.search("http://evil.example/../../etc/passwd", 7, (40.0, -73.0))

    assert len(captured) == 1
    request = captured[0]
    assert request.url.scheme == "https"
    assert request.url.host == "us1.locationiq.com"
    assert request.url.path == "/v1/autocomplete"
    params = request.url.params
    assert params["q"] == "http://evil.example/../../etc/passwd"
    assert params["limit"] == "7"
    assert params["key"] == "secret-key-abc"
    assert params["format"] == "json"
    assert params["lat"] == "40.0"
    assert params["lon"] == "-73.0"


async def test_locationiq_search_no_bias_omits_lat_lon_params():
    captured: list[httpx.Request] = []

    def handler(request: httpx.Request) -> httpx.Response:
        captured.append(request)
        return httpx.Response(200, json=[])

    provider = LocationIQProvider("k", transport=_transport(handler))
    await provider.search("q", 5, None)

    assert "lat" not in captured[0].url.params
    assert "lon" not in captured[0].url.params


async def test_locationiq_redirect_is_not_followed():
    call_count = 0

    def handler(request: httpx.Request) -> httpx.Response:
        nonlocal call_count
        call_count += 1
        return httpx.Response(302, headers={"location": "https://attacker.example/steal?key=x"})

    provider = LocationIQProvider("test-key", transport=_transport(handler))
    with pytest.raises(GeocodeUpstreamError):
        await provider.search("q", 5, None)

    # follow_redirects=False: the transport is hit exactly once — the redirect is never chased.
    assert call_count == 1


async def test_locationiq_oversized_body_raises_upstream_error():
    big = [{"display_name": "x" * 70000, "lat": "1.0", "lon": "2.0"}]

    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(200, json=big)

    provider = LocationIQProvider("test-key", transport=_transport(handler))
    with pytest.raises(GeocodeUpstreamError):
        await provider.search("q", 5, None)


async def test_locationiq_429_raises_quota_error():
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(429, json={"error": "Rate Limited Requests"})

    provider = LocationIQProvider("test-key", transport=_transport(handler))
    with pytest.raises(GeocodeQuotaError):
        await provider.search("q", 5, None)


async def test_locationiq_non_200_raises_upstream_error():
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(500, json={"error": "boom"})

    provider = LocationIQProvider("test-key", transport=_transport(handler))
    with pytest.raises(GeocodeUpstreamError):
        await provider.search("q", 5, None)


async def test_locationiq_malformed_json_raises_upstream_error():
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(200, content=b"not json")

    provider = LocationIQProvider("test-key", transport=_transport(handler))
    with pytest.raises(GeocodeUpstreamError):
        await provider.search("q", 5, None)


async def test_locationiq_network_error_raises_upstream_error():
    def handler(request: httpx.Request) -> httpx.Response:
        raise httpx.ConnectError("down")

    provider = LocationIQProvider("test-key", transport=_transport(handler))
    with pytest.raises(GeocodeUpstreamError):
        await provider.search("q", 5, None)


async def test_locationiq_errors_never_leak_the_api_key():
    """GeocodeUpstreamError/GeocodeQuotaError carry only a short machine `reason` code —
    the API key must never appear in an exception message that could be logged."""
    secret = "super-secret-key-should-never-leak"

    def status_handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(500, json={"error": "boom"})

    provider = LocationIQProvider(secret, transport=_transport(status_handler))
    with pytest.raises(GeocodeUpstreamError) as excinfo:
        await provider.search("q", 5, None)
    assert secret not in str(excinfo.value)
    assert secret not in excinfo.value.reason

    def quota_handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(429, json={"error": "limited"})

    provider2 = LocationIQProvider(secret, transport=_transport(quota_handler))
    with pytest.raises(GeocodeQuotaError) as quota_excinfo:
        await provider2.search("q", 5, None)
    assert secret not in str(quota_excinfo.value)
    assert secret not in quota_excinfo.value.reason


def test_locationiq_url_constant_is_https_and_fixed():
    assert LOCATIONIQ_URL == "https://us1.locationiq.com/v1/autocomplete"


# --- GeocodeCache: bounded TTL/LRU cache (spec §8.3) ---


class _FakeClock:
    """A manually-advanced fake clock (a `Callable[[], float]`) so cache/throttle tests
    are deterministic — never a real sleep/wall-clock call."""

    def __init__(self, start: float = 0.0):
        self._t = start

    def __call__(self) -> float:
        return self._t

    def advance(self, seconds: float) -> None:
        self._t += seconds


_RESULT = [GeocodeResult(label="123 Main St", latitude=1.0, longitude=2.0)]


def test_cache_miss_then_hit_within_ttl_returns_cached_value():
    clock = _FakeClock()
    cache = GeocodeCache(60, 10, now=clock)

    assert cache.get("main st", 5, None) is None
    cache.set("main st", 5, None, _RESULT)
    clock.advance(59)
    assert cache.get("main st", 5, None) == _RESULT


def test_cache_entry_expires_after_ttl():
    clock = _FakeClock()
    cache = GeocodeCache(60, 10, now=clock)
    cache.set("main st", 5, None, _RESULT)

    clock.advance(60)  # exactly at TTL: must be treated as expired, not one tick early

    assert cache.get("main st", 5, None) is None


def test_cache_key_normalizes_whitespace_and_case():
    clock = _FakeClock()
    cache = GeocodeCache(60, 10, now=clock)
    cache.set("  Main St  ", 5, None, _RESULT)

    assert cache.get("main st", 5, None) == _RESULT
    assert cache.get("MAIN ST", 5, None) == _RESULT
    assert cache.get("Main St", 5, None) == _RESULT


def test_cache_key_includes_limit():
    clock = _FakeClock()
    cache = GeocodeCache(60, 10, now=clock)
    cache.set("main st", 5, None, _RESULT)

    assert cache.get("main st", 7, None) is None
    assert cache.get("main st", 5, None) == _RESULT


def test_cache_key_rounds_bias_to_a_coarse_shared_grid():
    clock = _FakeClock()
    cache = GeocodeCache(60, 10, now=clock)
    cache.set("main st", 5, (40.7128, -74.0060), _RESULT)

    # A viewport a few hundred meters away rounds into the same coarse grid cell.
    assert cache.get("main st", 5, (40.7130, -74.0062)) == _RESULT
    # A viewport far enough away lands in a different cell -> miss.
    assert cache.get("main st", 5, (41.5, -74.0060)) is None


def test_cache_bounded_lru_evicts_oldest_on_overflow():
    clock = _FakeClock()
    cache = GeocodeCache(60, 2, now=clock)
    cache.set("first", 5, None, _RESULT)
    cache.set("second", 5, None, _RESULT)
    cache.set("third", 5, None, _RESULT)  # capacity 2 -> evicts "first"

    assert cache.get("first", 5, None) is None
    assert cache.get("second", 5, None) == _RESULT
    assert cache.get("third", 5, None) == _RESULT


def test_cache_exposes_no_raw_key_or_query_accessor():
    """Privacy (spec §8.3, §9): the cache key embeds the normalized query (PII), so
    there must be no `.keys()`/`.items()`/`.values()`-style diagnostic leak path, and
    the default repr must not surface stored query text."""
    cache = GeocodeCache(60, 10)
    assert not hasattr(cache, "keys")
    assert not hasattr(cache, "items")
    assert not hasattr(cache, "values")

    cache.set("a very identifying secret address 221b baker st", 5, None, _RESULT)
    assert "baker st" not in repr(cache)
    assert "baker st" not in str(cache)


# --- GeocodeThrottle: coarse per-pod token bucket (spec §8.3) ---


def test_throttle_allows_up_to_capacity_then_blocks():
    clock = _FakeClock()
    throttle = GeocodeThrottle(3, 60, now=clock)

    assert throttle.allow() is True
    assert throttle.allow() is True
    assert throttle.allow() is True
    assert throttle.allow() is False  # 4th call within the window is blocked


def test_throttle_resets_after_window_elapses():
    clock = _FakeClock()
    throttle = GeocodeThrottle(2, 60, now=clock)

    assert throttle.allow() is True
    assert throttle.allow() is True
    assert throttle.allow() is False

    clock.advance(60)

    assert throttle.allow() is True
    assert throttle.allow() is True
    assert throttle.allow() is False


# --- CachedGeocodeProvider: cache + throttle wrapping (spec §8.3) ---


class _CountingProvider:
    def __init__(self, results: list[GeocodeResult] | None = None):
        self.calls: list[tuple[str, int, tuple[float, float] | None]] = []
        self._results = results if results is not None else _RESULT

    async def search(
        self, q: str, limit: int, bias: tuple[float, float] | None
    ) -> list[GeocodeResult]:
        self.calls.append((q, limit, bias))
        return self._results


async def test_cached_provider_collapses_identical_lookups_into_one_upstream_call():
    clock = _FakeClock()
    inner = _CountingProvider()
    provider = CachedGeocodeProvider(
        inner,
        cache=GeocodeCache(60, 10, now=clock),
        throttle=GeocodeThrottle(10, 60, now=clock),
    )

    first = await provider.search("main st", 5, None)
    second = await provider.search("main st", 5, None)

    assert first == second == inner._results
    assert len(inner.calls) == 1


async def test_cached_provider_recalls_upstream_after_ttl_expiry():
    clock = _FakeClock()
    inner = _CountingProvider()
    provider = CachedGeocodeProvider(
        inner,
        cache=GeocodeCache(60, 10, now=clock),
        throttle=GeocodeThrottle(10, 60, now=clock),
    )

    await provider.search("main st", 5, None)
    clock.advance(60)
    await provider.search("main st", 5, None)

    assert len(inner.calls) == 2


async def test_cached_provider_raises_throttled_when_bucket_exhausted():
    clock = _FakeClock()
    inner = _CountingProvider()
    provider = CachedGeocodeProvider(
        inner,
        cache=GeocodeCache(60, 10, now=clock),
        throttle=GeocodeThrottle(1, 60, now=clock),
    )

    await provider.search("first query", 5, None)
    with pytest.raises(GeocodeThrottled):
        await provider.search("second query", 5, None)

    assert len(inner.calls) == 1


async def test_cached_provider_cache_hit_does_not_consume_throttle_budget():
    clock = _FakeClock()
    inner = _CountingProvider()
    provider = CachedGeocodeProvider(
        inner,
        cache=GeocodeCache(60, 10, now=clock),
        throttle=GeocodeThrottle(1, 60, now=clock),
    )

    await provider.search("main st", 5, None)  # consumes the only token, populates cache
    result = await provider.search("main st", 5, None)  # cache hit: must not touch throttle

    assert result == inner._results
    assert len(inner.calls) == 1


# --- get_geocode_provider factory (spec §8.4) ---


def test_get_geocode_provider_disabled_without_api_key_logs_nothing(caplog):
    settings = Settings(geocoding_api_key=None)

    with caplog.at_level(logging.WARNING):
        provider = get_geocode_provider(settings)

    assert provider is None
    # The ordinary unconfigured-local-dev state is not a misconfiguration -> no warning.
    assert caplog.records == []


def test_get_geocode_provider_disabled_for_unknown_provider_logs_redacted_warning(caplog):
    secret = "top-secret-locationiq-key-should-never-leak"
    settings = Settings(geocoding_api_key=secret, geocoding_provider="maptiler-typo")

    with caplog.at_level(logging.WARNING):
        provider = get_geocode_provider(settings)

    assert provider is None
    assert len(caplog.records) == 1
    record = caplog.records[0]
    assert record.levelname == "WARNING"
    assert record.provider == "maptiler-typo"
    # Redacted: the provider NAME is logged, the API key never is.
    assert secret not in record.getMessage()
    assert secret not in str(record.__dict__)


def test_get_geocode_provider_enabled_with_known_provider_returns_wrapped_provider():
    settings = Settings(geocoding_api_key="key-123", geocoding_provider="locationiq")

    provider = get_geocode_provider(settings)

    assert provider is not None
    assert isinstance(provider, CachedGeocodeProvider)


def test_get_geocode_provider_reuses_singleton_across_calls():
    settings = Settings(geocoding_api_key="key-123", geocoding_provider="locationiq")

    first = get_geocode_provider(settings)
    second = get_geocode_provider(settings)

    assert first is second
