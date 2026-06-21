import json
from pathlib import Path

import pytest

from app.config import Settings
from app.imports.osm import OSM_TAG_ALLOWLIST, normalize_external_id, parse_osm_geojson

FIX = Path(__file__).parent / "fixtures"
CAPS = dict(max_key_len=64, max_value_len=255, max_tags_bytes=4096)


def _load(name):
    return json.loads((FIX / name).read_text())


def test_osm_settings_defaults():
    s = Settings()
    assert s.osm_move_small_max_m == 25.0
    assert s.osm_move_review_min_m == 100.0
    assert s.osm_tags_max_bytes == 4096


def test_normalize_external_id():
    assert normalize_external_id("node", 5) == "osm:node:5"


def test_parses_valid_drinking_water():
    r = parse_osm_geojson(_load("osm_basic.geojson"), **CAPS)
    ids = {c.source_external_id for c in r.candidates}
    assert ids == {"osm:node:1", "osm:node:2"}
    c = next(c for c in r.candidates if c.source_external_id == "osm:node:1")
    assert c.latitude == 37.7749 and c.longitude == -122.4194
    assert c.tags["wheelchair"] == "yes"
    assert c.geometry_kind == "point"


def test_messy_features_are_skipped_or_sanitized():
    r = parse_osm_geojson(_load("osm_messy.geojson"), **CAPS)
    skipped = dict(r.skipped)
    # disused: lifecycle -> skipped
    assert any("disused" in reason or "lifecycle" in reason for reason in skipped.values())
    # out-of-range coords -> skipped
    assert "osm:node:11" in skipped
    # amenity=fountain WITHOUT drinking_water=yes -> skipped (not potable signal)
    assert "osm:node:12" in skipped
    # polygon -> centroid candidate, allow-list strips secret_tag, keeps description
    way = next((c for c in r.candidates if c.source_external_id == "osm:way:13"), None)
    assert way is not None and way.geometry_kind == "centroid"
    assert "secret_tag" not in way.tags and way.tags.get("description") == "clean water"


def test_allowlist_is_frozen_and_minimal():
    assert "amenity" in OSM_TAG_ALLOWLIST and "secret_tag" not in OSM_TAG_ALLOWLIST


def _feature(ext_num, access):
    return {
        "type": "FeatureCollection",
        "features": [
            {
                "type": "Feature",
                "id": f"node/{ext_num}",
                "properties": {"amenity": "drinking_water", "access": access},
                "geometry": {"type": "Point", "coordinates": [1.0, 2.0]},
            }
        ],
    }


@pytest.mark.parametrize("access", ["private", "no", "customers", "permit"])
def test_non_public_access_is_skipped(access):
    r = parse_osm_geojson(_feature(1, access), **CAPS)
    assert r.candidates == []
    assert dict(r.skipped).get("osm:node:1") == "not_public"


def test_permissive_access_imported_at_medium_confidence():
    r = parse_osm_geojson(_feature(2, "permissive"), **CAPS)
    assert len(r.candidates) == 1 and r.candidates[0].confidence == "medium"


def test_public_access_imported_at_high_confidence():
    r = parse_osm_geojson(_feature(3, "yes"), **CAPS)
    assert len(r.candidates) == 1 and r.candidates[0].confidence == "high"
