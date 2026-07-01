from pathlib import Path

import pytest

from app.imports.regions import (
    RegionValidationError,
    bbox_to_rectangle_wkt,
    load_registry,
    validate_region,
)

ROWS = [
    {
        "key": "32.5,-117.6,33.5,-116.0",
        "scope_id": "us/ca/san-diego",
        "dataset": "overpass:san-diego",
        "source": "overpass",
        "status": "retired",
    },
    {
        "key": "north-america/us/california",
        "scope_id": "geofabrik:us/california",
        "dataset": "geofabrik:us/california",
        "source": "pbf",
        "status": "active",
    },
    {
        "key": "40.4,-74.3,41.0,-73.7",
        "scope_id": "us/ny/nyc",
        "dataset": "overpass:nyc",
        "source": "overpass",
        "status": "active",
    },
]


def test_pbf_full_triple_ok():
    row = validate_region(
        ROWS,
        source="pbf",
        key="north-america/us/california",
        scope_id="geofabrik:us/california",
        dataset="geofabrik:us/california",
    )
    assert row["status"] == "active"


def test_pbf_wrong_key_raises():
    with pytest.raises(RegionValidationError, match="no registry row"):
        validate_region(
            ROWS,
            source="pbf",
            key="europe/germany",
            scope_id="geofabrik:us/california",
            dataset="geofabrik:us/california",
        )


def test_pbf_missing_key_raises():
    with pytest.raises(RegionValidationError, match="requires --key"):
        validate_region(
            ROWS,
            source="pbf",
            key=None,
            scope_id="geofabrik:us/california",
            dataset="geofabrik:us/california",
        )


def test_retired_row_rejected_distinctly():
    with pytest.raises(RegionValidationError, match="retired"):
        validate_region(
            ROWS,
            source="overpass",
            scope_id="us/ca/san-diego",
            dataset="overpass:san-diego",
            bbox="32.5,-117.6,33.5,-116.0",
        )


def test_unknown_scope_rejected():
    with pytest.raises(RegionValidationError, match="unknown/aggregate"):
        validate_region(
            ROWS,
            source="overpass",
            scope_id="us/ca/aggregate",
            dataset="overpass:x",
            bbox="1,2,3,4",
        )


def test_overpass_bbox_numeric_equality():
    # 40.4 == 40.40 numerically -> match despite different string form.
    row = validate_region(
        ROWS,
        source="overpass",
        scope_id="us/ny/nyc",
        dataset="overpass:nyc",
        bbox="40.40,-74.30,41.00,-73.70",
    )
    assert row["scope_id"] == "us/ny/nyc"


def test_overpass_bbox_mismatch_rejected():
    with pytest.raises(RegionValidationError, match="bbox"):
        validate_region(
            ROWS,
            source="overpass",
            scope_id="us/ny/nyc",
            dataset="overpass:nyc",
            bbox="0,0,1,1",
        )


def test_overpass_wrong_dataset_rejected():
    with pytest.raises(RegionValidationError, match="no registry row"):
        validate_region(
            ROWS,
            source="overpass",
            scope_id="us/ny/nyc",
            dataset="overpass:wrong",
            bbox="40.4,-74.3,41.0,-73.7",
        )


def test_ambiguous_registry_rejected():
    dup = [
        *ROWS,
        {
            "key": "north-america/us/california",
            "scope_id": "geofabrik:us/california",
            "dataset": "geofabrik:us/california",
            "source": "pbf",
            "status": "active",
        },
    ]
    with pytest.raises(RegionValidationError, match="ambiguous"):
        validate_region(
            dup,
            source="pbf",
            key="north-america/us/california",
            scope_id="geofabrik:us/california",
            dataset="geofabrik:us/california",
        )


def test_bbox_to_rectangle_wkt():
    # bbox is S,W,N,E -> CCW 1-part MultiPolygon rectangle (W S, E S, E N, W N, W S)
    wkt = bbox_to_rectangle_wkt("32.0,-117.0,33.0,-116.0")
    expected = "MULTIPOLYGON(((-117.0 32.0, -116.0 32.0, -116.0 33.0, -117.0 33.0, -117.0 32.0)))"
    assert wkt == expected


def test_real_registry_loads_and_has_no_duplicate_active_scope():
    path = Path(__file__).resolve().parents[2] / ".github" / "osm-import-regions.yml"
    rows = load_registry(str(path))
    assert isinstance(rows, list) and rows
    for r in rows:
        assert {"key", "scope_id", "dataset", "source", "status"} <= set(r)
        assert r["source"] in ("pbf", "overpass")
        assert r["status"] in ("active", "retired")
    active = [r["scope_id"] for r in rows if r["status"] == "active"]
    assert len(active) == len(set(active))  # one active owner per scope
