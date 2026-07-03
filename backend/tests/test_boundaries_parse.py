"""Slice 1b — pure boundary-extraction logic (crawlable SEO pages, #127).

Unit tests for ``app.imports.boundaries`` — the stdlib-only extraction/slug/
provenance-decode layer (mirrors ``app.imports.osm``; no DB, deterministic).

Input contract = the Overture ``division_area`` shape emitted by the Slice-1c DuckDB
fetch (spec §11.3): each feature's ``properties`` carries ``overture_id``, ``subtype``,
``class``, ``admin_level``, ``name`` (from ``names.primary``), ``country`` (ISO alpha-2),
and ``sources`` (the OSM-provenance array). Identity is the GERS ``overture_id`` (spec
§11.4); ``osm_type``/``osm_id`` are best-effort provenance decoded from ``sources`` and
are nullable; ``country_code`` is lowercased to match the URL segment (Codex 1b watch-item).
"""

from __future__ import annotations

from app.imports.boundaries import (
    BoundaryFeature,
    decode_osm_source,
    parse_boundary_geojson,
    slugify,
)

# --- slugify -----------------------------------------------------------------


def test_slugify_basic():
    assert slugify("San Diego") == "san-diego"


def test_slugify_strips_diacritics():
    # Lëtzebuerg (Luxembourg, native) -> ASCII, lowercased.
    assert slugify("Lëtzebuerg") == "letzebuerg"
    assert slugify("Saint-Étienne") == "saint-etienne"


def test_slugify_collapses_and_trims_separators():
    assert slugify("  Multiple   Spaces  ") == "multiple-spaces"
    assert slugify("Washington, D.C.") == "washington-d-c"


def test_slugify_keeps_digits():
    assert slugify("Region 9") == "region-9"


def test_slugify_unsluggable_is_empty():
    assert slugify("!!!") == ""
    assert slugify("") == ""


# --- decode_osm_source -------------------------------------------------------

_OSM = "OpenStreetMap"


def test_decode_prefers_relation_over_way_over_node():
    # A real division carries a name node AND the boundary relation in sources[]; we want
    # the relation (spec §11.4 prefer relation > way > node).
    sources = [
        {"property": "/properties/names/primary", "dataset": _OSM, "record_id": "n11111@3"},
        {"property": "", "dataset": _OSM, "record_id": "w22222@4"},
        {"property": "", "dataset": _OSM, "record_id": "r2171347@8"},
    ]
    assert decode_osm_source(sources) == ("relation", 2171347)


def test_decode_prefers_way_over_node():
    sources = [
        {"dataset": _OSM, "record_id": "n11111@3"},
        {"dataset": _OSM, "record_id": "w22222@4"},
    ]
    assert decode_osm_source(sources) == ("way", 22222)


def test_decode_single_node():
    sources = [{"dataset": _OSM, "record_id": "n99@1"}]
    assert decode_osm_source(sources) == ("node", 99)


def test_decode_drops_version_suffix():
    assert decode_osm_source([{"dataset": _OSM, "record_id": "r42@17"}]) == ("relation", 42)


def test_decode_tolerates_missing_version():
    # @version is optional in the wild; never drop a valid record_id for lacking it.
    assert decode_osm_source([{"dataset": _OSM, "record_id": "r42"}]) == ("relation", 42)


def test_decode_no_osm_source_returns_none():
    # geoBoundaries-conflated feature: no OpenStreetMap record (spec §11.4 -> nullable).
    sources = [{"dataset": "geoBoundaries", "record_id": "whatever"}]
    assert decode_osm_source(sources) == (None, None)


def test_decode_empty_or_none_returns_none():
    assert decode_osm_source([]) == (None, None)
    assert decode_osm_source(None) == (None, None)


def test_decode_ignores_non_osm_dataset_even_with_valid_id():
    sources = [{"dataset": "Esri Community Maps", "record_id": "r123@1"}]
    assert decode_osm_source(sources) == (None, None)


def test_decode_ignores_malformed_record_id():
    # Slash-form ("relation/123") is NOT the pinned n/w/r prefix form (spec §11.4).
    sources = [{"dataset": _OSM, "record_id": "relation/123"}]
    assert decode_osm_source(sources) == (None, None)


def test_decode_accepts_json_string_sources():
    # ogr2ogr/GDAL can serialize the nested sources[] as a JSON string property.
    import json

    raw = json.dumps([{"dataset": _OSM, "record_id": "r777@2"}])
    assert decode_osm_source(raw) == ("relation", 777)


# --- parse_boundary_geojson --------------------------------------------------


def _feature(geometry, **props):
    base = {
        "overture_id": "ov-1",
        "subtype": "locality",
        "class": "land",
        "name": "San Diego",
        "country": "US",
        "sources": [{"dataset": _OSM, "record_id": "r253832@1"}],
    }
    base.update(props)
    return {"type": "Feature", "properties": base, "geometry": geometry}


_POLY = {"type": "Polygon", "coordinates": [[[0, 0], [1, 0], [1, 1], [0, 1], [0, 0]]]}
_MULTIPOLY = {
    "type": "MultiPolygon",
    "coordinates": [[[[0, 0], [1, 0], [1, 1], [0, 1], [0, 0]]]],
}


def test_parse_polygon_feature():
    res = parse_boundary_geojson({"type": "FeatureCollection", "features": [_feature(_POLY)]})
    assert res.skipped == []
    assert len(res.features) == 1
    f = res.features[0]
    assert isinstance(f, BoundaryFeature)
    assert f.overture_id == "ov-1"
    assert f.subtype == "locality"
    assert f.place_class == "land"
    assert f.name == "San Diego"
    assert f.country_code == "us"  # lowercased (Codex 1b watch-item)
    assert f.slug == "san-diego"
    assert f.osm_type == "relation" and f.osm_id == 253832
    assert f.geometry["type"] == "Polygon"  # geometry passed through for DB coercion


def test_parse_multipolygon_feature():
    res = parse_boundary_geojson({"type": "FeatureCollection", "features": [_feature(_MULTIPOLY)]})
    assert len(res.features) == 1
    assert res.features[0].geometry["type"] == "MultiPolygon"


def test_parse_feature_with_no_osm_source():
    feat = _feature(_POLY, sources=[{"dataset": "geoBoundaries", "record_id": "x"}])
    res = parse_boundary_geojson({"type": "FeatureCollection", "features": [feat]})
    f = res.features[0]
    assert f.osm_type is None and f.osm_id is None


def test_parse_multi_entry_sources_decodes_relation():
    feat = _feature(
        _MULTIPOLY,
        sources=[
            {"property": "/properties/names/primary", "dataset": _OSM, "record_id": "n5@1"},
            {"property": "", "dataset": _OSM, "record_id": "r253832@2"},
        ],
    )
    res = parse_boundary_geojson({"type": "FeatureCollection", "features": [feat]})
    assert res.features[0].osm_type == "relation"
    assert res.features[0].osm_id == 253832


def test_parse_admin_level_zero_is_preserved_not_dropped():
    # admin_level=0 (country) is falsy — must NOT be treated as missing.
    feat = _feature(_POLY, subtype="country", admin_level=0, name="United States")
    res = parse_boundary_geojson({"type": "FeatureCollection", "features": [feat]})
    assert res.features[0].admin_level == 0


def test_parse_admin_level_null_at_locality_is_none():
    feat = _feature(_POLY, admin_level=None)
    res = parse_boundary_geojson({"type": "FeatureCollection", "features": [feat]})
    assert res.features[0].admin_level is None


def test_parse_overture_id_falls_back_to_feature_id():
    # GDAL can promote a field named `id` to the feature top level; accept it there too.
    feat = _feature(_POLY)
    del feat["properties"]["overture_id"]
    feat["id"] = "ov-from-top"
    res = parse_boundary_geojson({"type": "FeatureCollection", "features": [feat]})
    assert res.features[0].overture_id == "ov-from-top"


def test_parse_country_code_falls_back_to_country_code_prop():
    feat = _feature(_POLY)
    del feat["properties"]["country"]
    feat["properties"]["country_code"] = "GB"
    res = parse_boundary_geojson({"type": "FeatureCollection", "features": [feat]})
    assert res.features[0].country_code == "gb"


def test_parse_skips_missing_required_fields():
    cases = {
        "overture_id": "missing_overture_id",
        "subtype": "missing_subtype",
        "class": "missing_class",
        "name": "missing_name",
        "country": "missing_country",
    }
    for field, reason in cases.items():
        feat = _feature(_POLY)
        del feat["properties"][field]
        if field == "overture_id":
            feat.pop("id", None)  # no top-level fallback
        if field == "country":
            feat["properties"].pop("country_code", None)
        res = parse_boundary_geojson({"type": "FeatureCollection", "features": [feat]})
        assert res.features == [], f"{field} should have been skipped"
        assert res.skipped and res.skipped[0][1] == reason


def test_parse_skips_missing_geometry():
    feat = _feature(None)
    res = parse_boundary_geojson({"type": "FeatureCollection", "features": [feat]})
    assert res.features == []
    assert res.skipped[0][1] == "missing_geometry"


def test_parse_skips_unsluggable_name():
    feat = _feature(_POLY, name="???")
    res = parse_boundary_geojson({"type": "FeatureCollection", "features": [feat]})
    assert res.features == []
    assert res.skipped[0][1] == "unsluggable_name"


def test_parse_slug_collision_across_features_is_allowed():
    # Two different divisions with the same name -> same slug, both parsed (canonical
    # selection resolves the collision in Slice 1d; the load stores both non-canonical).
    a = _feature(_POLY, overture_id="ov-a", name="Springfield")
    b = _feature(_MULTIPOLY, overture_id="ov-b", name="Springfield")
    res = parse_boundary_geojson({"type": "FeatureCollection", "features": [a, b]})
    assert len(res.features) == 2
    assert res.features[0].slug == res.features[1].slug == "springfield"
