"""Geocode-proxy tests. Config + response-schema coverage lands here first (spec §8.4, §8.1);
the provider is added here (spec §8.2); the router/endpoint tests are added in a later task
as this file grows."""

import httpx
import pytest

from app.config import Settings
from app.geocoding import (
    LOCATIONIQ_URL,
    GeocodeQuotaError,
    GeocodeUpstreamError,
    LocationIQProvider,
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
