from app.imports.overpass import overpass_json_to_geojson


def test_node_converts_to_point_feature():
    data = {
        "elements": [
            {
                "type": "node",
                "id": 1,
                "lat": 37.77,
                "lon": -122.41,
                "tags": {"amenity": "drinking_water"},
            },
        ]
    }
    gj = overpass_json_to_geojson(data)
    assert gj["type"] == "FeatureCollection"
    f = gj["features"][0]
    assert f["id"] == "node/1"
    assert f["geometry"] == {"type": "Point", "coordinates": [-122.41, 37.77]}
    assert f["properties"]["amenity"] == "drinking_water"


def test_way_uses_center_and_missing_coords_skipped():
    data = {
        "elements": [
            {
                "type": "way",
                "id": 2,
                "center": {"lat": 1.0, "lon": 2.0},
                "tags": {"amenity": "drinking_water"},
            },
            {
                "type": "node",
                "id": 3,
                "tags": {"amenity": "drinking_water"},
            },  # no coords -> skipped
        ]
    }
    gj = overpass_json_to_geojson(data)
    ids = {f["id"] for f in gj["features"]}
    assert ids == {"way/2"}
    assert gj["features"][0]["geometry"]["coordinates"] == [2.0, 1.0]


def test_empty_elements_yield_empty_collection():
    gj = overpass_json_to_geojson({"elements": []})
    assert gj == {"type": "FeatureCollection", "features": []}
