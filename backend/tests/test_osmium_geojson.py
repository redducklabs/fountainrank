import json
from pathlib import Path

from app.imports.osmium_geojson import (
    _decode_osmium_id,
    osmium_geojson_to_import_geojson,
)

FIX = Path(__file__).parent / "fixtures" / "osmium_export_sample.geojson"


def _load() -> dict:
    with open(FIX, encoding="utf-8") as fh:
        return json.load(fh)


def test_decode_ids_and_area_parity():
    assert _decode_osmium_id("n1001") == ("node", 1001)
    assert _decode_osmium_id("w2002") == ("way", 2002)
    # even area id -> way (id/2)
    assert _decode_osmium_id("a6006") == ("way", 3003)
    # odd area id -> relation ((id-1)/2)
    assert _decode_osmium_id("a8009") == ("relation", 4004)
    # malformed
    assert _decode_osmium_id("x9") is None
    assert _decode_osmium_id("n") is None
    assert _decode_osmium_id("w-5") is None
    assert _decode_osmium_id("") is None
    assert _decode_osmium_id(None) is None
    assert _decode_osmium_id(123) is None


def test_normalizes_types_and_dedupes():
    gj, stats = osmium_geojson_to_import_geojson(_load())
    by_id = {f["id"]: f for f in gj["features"]}
    # node/way/way-area/relation-area all present and canonicalized
    assert by_id["node/1001"]["geometry"]["type"] == "Point"
    assert by_id["way/2002"]["geometry"]["type"] == "LineString"
    assert by_id["way/3003"]["geometry"]["type"] == "Polygon"
    assert by_id["relation/4004"]["geometry"]["type"] == "MultiPolygon"
    # closed way emitted as BOTH w5005 (LineString) and a10010 (Polygon) -> one way/5005, Polygon
    assert "way/5005" in by_id
    assert by_id["way/5005"]["geometry"]["type"] == "Polygon"
    # malformed id and missing id are dropped, not crashed
    assert stats["unparseable"] == 2
    assert stats["deduped"] == 1
    assert stats["areas"] == 3  # a6006, a8009, a10010
    assert stats["relations"] == 1
    assert stats["kept"] == 5  # node/1001, way/2002, way/3003, relation/4004, way/5005


def test_output_is_order_independent():
    data = _load()
    gj_a, _ = osmium_geojson_to_import_geojson(data)
    data["features"].reverse()
    gj_b, _ = osmium_geojson_to_import_geojson(data)
    # Same features, same chosen geometries, regardless of input order (no refresh churn).
    sig_a = [(f["id"], f["geometry"]["type"]) for f in gj_a["features"]]
    sig_b = [(f["id"], f["geometry"]["type"]) for f in gj_b["features"]]
    assert sig_a == sig_b


def test_properties_preserved_for_parser():
    gj, _ = osmium_geojson_to_import_geojson(_load())
    by_id = {f["id"]: f for f in gj["features"]}
    assert by_id["node/1001"]["properties"]["amenity"] == "drinking_water"
    assert by_id["way/2002"]["properties"]["man_made"] == "water_tap"


def test_empty_collection():
    gj, stats = osmium_geojson_to_import_geojson({"type": "FeatureCollection", "features": []})
    assert gj == {"type": "FeatureCollection", "features": []}
    assert stats["kept"] == 0
