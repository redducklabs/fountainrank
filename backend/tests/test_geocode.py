"""Geocode-proxy tests. Config + response-schema coverage lands here first (spec §8.4, §8.1);
the provider is added here (spec §8.2); the cache/throttle/factory are added here (spec §8.3,
§8.4, Task 4); the router/endpoint tests are added in a later task as this file grows."""

import logging

import httpx
import pytest

from app.config import Settings, get_settings
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
from app.main import app
from app.schemas import BoundingBox, GeocodeResponse, GeocodeResult


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
        "bounding_box": None,
    }


def test_geocode_result_constructs_and_serializes_with_bounding_box():
    result = GeocodeResult(
        label="123 Main St",
        latitude=40.7128,
        longitude=-74.0060,
        bounding_box=BoundingBox(south=40.71, west=-74.01, north=40.72, east=-74.00),
    )
    assert result.model_dump() == {
        "label": "123 Main St",
        "latitude": 40.7128,
        "longitude": -74.0060,
        "bounding_box": {"south": 40.71, "west": -74.01, "north": 40.72, "east": -74.00},
    }


def test_geocode_response_wraps_results_list():
    resp = GeocodeResponse(results=[GeocodeResult(label="A", latitude=1.0, longitude=2.0)])
    assert resp.model_dump() == {
        "results": [{"label": "A", "latitude": 1.0, "longitude": 2.0, "bounding_box": None}]
    }


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


# --- bounding_box validation (spec 2026-07-01 §2): the provider is untrusted input, so
# only a fully valid, positive-area box is ever exposed; a bad bbox must never drop the
# result itself. ---


async def test_locationiq_search_valid_boundingbox_is_parsed():
    hit = {
        "display_name": "123 Main St, Springfield",
        "lat": "40.7128",
        "lon": "-74.0060",
        # LocationIQ order: [south, north, west, east], all strings.
        "boundingbox": ["40.7127", "40.7129", "-74.0061", "-74.0059"],
    }

    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(200, json=[hit])

    provider = LocationIQProvider("test-key", transport=_transport(handler))
    results = await provider.search("main st", 5, None)

    assert len(results) == 1
    bbox = results[0].bounding_box
    assert bbox is not None
    assert bbox.south == 40.7127
    assert bbox.west == -74.0061
    assert bbox.north == 40.7129
    assert bbox.east == -74.0059


@pytest.mark.parametrize(
    "boundingbox",
    [
        pytest.param(None, id="missing"),
        pytest.param(["40.71", "40.72", "-74.01"], id="too_short"),
        pytest.param(["40.71", "40.72", "-74.01", "-74.00", "1"], id="too_long"),
        pytest.param(["40.71", "40.72", "-74.01", "not-a-number"], id="non_numeric"),
        pytest.param(["40.71", "40.72", "-74.01", "nan"], id="non_finite_nan"),
        pytest.param(["40.71", "40.72", "-74.01", "inf"], id="non_finite_inf"),
        pytest.param(["-95", "40.72", "-74.01", "-74.00"], id="south_out_of_range"),
        pytest.param(["40.71", "95", "-74.01", "-74.00"], id="north_out_of_range"),
        pytest.param(["40.71", "40.72", "-200", "-74.00"], id="west_out_of_range"),
        pytest.param(["40.71", "40.72", "-74.01", "200"], id="east_out_of_range"),
        pytest.param(["40.72", "40.71", "-74.01", "-74.00"], id="inverted_south_north"),
        pytest.param(["40.71", "40.71", "-74.01", "-74.00"], id="zero_area_lat"),
        pytest.param(["40.71", "40.72", "-74.00", "-74.01"], id="inverted_west_east"),
        pytest.param(["40.71", "40.72", "-74.01", "-74.01"], id="zero_area_lng"),
    ],
)
async def test_locationiq_search_invalid_boundingbox_drops_bbox_but_keeps_result(boundingbox):
    hit = {
        "display_name": "123 Main St, Springfield",
        "lat": "40.7128",
        "lon": "-74.0060",
    }
    if boundingbox is not None:
        hit["boundingbox"] = boundingbox

    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(200, json=[hit])

    provider = LocationIQProvider("test-key", transport=_transport(handler))
    results = await provider.search("main st", 5, None)

    assert len(results) == 1
    assert results[0].label == "123 Main St, Springfield"
    assert results[0].bounding_box is None


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


# --- GET /api/v1/geocode endpoint (spec §8.1, §9, Task 5) ---


class _FakeProvider:
    def __init__(
        self,
        results: list[GeocodeResult] | None = None,
        raise_exc: Exception | None = None,
    ):
        self.calls: list[tuple[str, int, tuple[float, float] | None]] = []
        self._results = results if results is not None else []
        self._raise_exc = raise_exc

    async def search(
        self, q: str, limit: int, bias: tuple[float, float] | None
    ) -> list[GeocodeResult]:
        self.calls.append((q, limit, bias))
        if self._raise_exc is not None:
            raise self._raise_exc
        return self._results


@pytest.fixture
def fake_provider():
    fake = _FakeProvider(
        results=[GeocodeResult(label="123 Main St, Springfield", latitude=40.0, longitude=-74.0)]
    )
    app.dependency_overrides[get_geocode_provider] = lambda: fake
    yield fake
    app.dependency_overrides.pop(get_geocode_provider, None)


async def _get(params: dict):
    transport = httpx.ASGITransport(app=app)
    async with httpx.AsyncClient(transport=transport, base_url="http://test") as ac:
        return await ac.get("/api/v1/geocode", params=params)


async def test_geocode_happy_path_returns_200_with_results(fake_provider):
    resp = await _get({"q": "main st"})

    assert resp.status_code == 200
    assert resp.json() == {
        "results": [
            {
                "label": "123 Main St, Springfield",
                "latitude": 40.0,
                "longitude": -74.0,
                "bounding_box": None,
            }
        ]
    }
    assert fake_provider.calls == [("main st", 5, None)]


async def test_geocode_limit_zero_is_clamped_to_one(fake_provider):
    resp = await _get({"q": "main st", "limit": 0})

    assert resp.status_code == 200
    assert fake_provider.calls[0][1] == 1


async def test_geocode_limit_over_max_is_clamped_to_ten(fake_provider):
    resp = await _get({"q": "main st", "limit": 999})

    assert resp.status_code == 200
    assert fake_provider.calls[0][1] == 10


async def test_geocode_non_integer_limit_is_422(fake_provider):
    resp = await _get({"q": "main st", "limit": "abc"})

    assert resp.status_code == 422
    assert fake_provider.calls == []


async def test_geocode_query_missing_is_422(fake_provider):
    resp = await _get({})

    assert resp.status_code == 422
    assert fake_provider.calls == []


async def test_geocode_query_empty_is_422(fake_provider):
    resp = await _get({"q": ""})

    assert resp.status_code == 422


async def test_geocode_query_too_short_is_422(fake_provider):
    resp = await _get({"q": "ab"})

    assert resp.status_code == 422


async def test_geocode_query_too_long_is_422(fake_provider):
    resp = await _get({"q": "x" * 121})

    assert resp.status_code == 422


async def test_geocode_out_of_range_lat_alone_is_422(fake_provider):
    resp = await _get({"q": "main st", "lat": 999})

    assert resp.status_code == 422
    assert fake_provider.calls == []


async def test_geocode_out_of_range_lng_alone_is_422(fake_provider):
    resp = await _get({"q": "main st", "lng": -200})

    assert resp.status_code == 422
    assert fake_provider.calls == []


async def test_geocode_single_valid_coordinate_without_pair_ignores_bias(fake_provider):
    resp = await _get({"q": "main st", "lat": 40.0})

    assert resp.status_code == 200
    assert fake_provider.calls[-1][2] is None

    resp = await _get({"q": "main st", "lng": -74.0})

    assert resp.status_code == 200
    assert fake_provider.calls[-1][2] is None


async def test_geocode_both_valid_coordinates_apply_bias(fake_provider):
    resp = await _get({"q": "main st", "lat": 40.0, "lng": -74.0})

    assert resp.status_code == 200
    assert fake_provider.calls[-1][2] == (40.0, -74.0)


async def test_geocode_disabled_without_api_key_is_503():
    app.dependency_overrides[get_settings] = lambda: Settings(geocoding_api_key=None)
    try:
        resp = await _get({"q": "main st"})
        assert resp.status_code == 503
        assert resp.json()["detail"] == "geocoding_disabled"
    finally:
        app.dependency_overrides.pop(get_settings, None)


async def test_geocode_unknown_provider_is_503_not_500():
    app.dependency_overrides[get_settings] = lambda: Settings(
        geocoding_api_key="key-123", geocoding_provider="maptiler-typo"
    )
    try:
        resp = await _get({"q": "main st"})
        assert resp.status_code == 503
        assert resp.json()["detail"] == "geocoding_disabled"
    finally:
        app.dependency_overrides.pop(get_settings, None)


async def test_geocode_upstream_error_is_502_not_500(fake_provider):
    fake_provider._raise_exc = GeocodeUpstreamError("geocode_status")

    resp = await _get({"q": "main st"})

    assert resp.status_code == 502
    assert resp.json()["detail"] == "geocoding_upstream"


async def test_geocode_quota_error_fails_closed_to_503_unavailable(fake_provider):
    fake_provider._raise_exc = GeocodeQuotaError()

    resp = await _get({"q": "main st"})

    assert resp.status_code == 503
    assert resp.json()["detail"] == "geocoding_unavailable"


async def test_geocode_throttled_is_429_with_retry_after(fake_provider):
    fake_provider._raise_exc = GeocodeThrottled()

    resp = await _get({"q": "main st"})

    assert resp.status_code == 429
    assert "Retry-After" in resp.headers


async def test_geocode_no_log_leak_and_info_carries_length_and_count(fake_provider, caplog):
    secret = "top-secret-locationiq-key-should-never-leak"
    query = "1600 Pennsylvania Avenue NW"
    app.dependency_overrides[get_settings] = lambda: Settings(geocoding_api_key=secret)
    try:
        with caplog.at_level(logging.INFO):
            resp = await _get({"q": query})
    finally:
        app.dependency_overrides.pop(get_settings, None)

    assert resp.status_code == 200
    assert caplog.records
    for rec in caplog.records:
        assert query not in rec.getMessage()
        assert secret not in rec.getMessage()
        for value in rec.__dict__.values():
            assert query not in str(value)
            assert secret not in str(value)

    info_records = [r for r in caplog.records if hasattr(r, "result_count")]
    assert len(info_records) == 1
    record = info_records[0]
    assert record.query_length == len(query)
    assert record.result_count == 1
    assert record.cache in {"hit", "miss"}


async def test_geocode_second_identical_request_logs_cache_hit(caplog):
    """Exercises the real `_cache_status` "hit" branch (spec §9) end-to-end: a genuine
    `CachedGeocodeProvider` (not the no-`_cache` `_FakeProvider` every other endpoint
    test uses) wraps a fixed-result inner provider, so the second identical request is
    served from the cache and the endpoint's INFO log must report `cache: "hit"`."""
    clock = _FakeClock()
    inner = _CountingProvider()
    provider = CachedGeocodeProvider(
        inner,
        cache=GeocodeCache(60, 10, now=clock),
        throttle=GeocodeThrottle(10, 60, now=clock),
    )
    app.dependency_overrides[get_geocode_provider] = lambda: provider
    try:
        with caplog.at_level(logging.INFO):
            first = await _get({"q": "main st"})
            caplog.clear()
            second = await _get({"q": "main st"})
    finally:
        app.dependency_overrides.pop(get_geocode_provider, None)

    assert first.status_code == 200
    assert second.status_code == 200
    # Second request must be served from the cache, never reaching the inner provider.
    assert len(inner.calls) == 1

    info_records = [r for r in caplog.records if hasattr(r, "cache")]
    assert len(info_records) == 1
    assert info_records[0].cache == "hit"
