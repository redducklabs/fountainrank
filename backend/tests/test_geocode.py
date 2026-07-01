"""Geocode-proxy tests. Config + response-schema coverage lands here first (spec §8.4, §8.1);
the router/provider/endpoint tests are added in later tasks as this file grows."""

from app.config import Settings
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
