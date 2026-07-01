from pathlib import Path

import pytest
from sqlalchemy import text

from app.imports.poly_to_wkt import (
    PolyParseError,
    _oriented_closed,
    _signed_area,
    parse_poly,
    poly_to_wkt,
)

FIX = Path(__file__).parent / "fixtures" / "california_sample.poly"


def _text() -> str:
    return FIX.read_text(encoding="utf-8")


def test_parse_structure():
    polys = parse_poly(_text())
    assert len(polys) == 2
    assert len(polys[0]["holes"]) == 1
    assert len(polys[1]["holes"]) == 0


def test_orientation_normalized():
    polys = parse_poly(_text())
    # fixture polygon1 outer is authored clockwise; hole1 is authored counter-clockwise.
    outer = _oriented_closed(polys[0]["outer"], ccw=True)
    hole = _oriented_closed(polys[0]["holes"][0], ccw=False)
    assert _signed_area(outer) > 0  # exterior normalized to CCW
    assert _signed_area(hole) < 0  # hole normalized to CW
    assert outer[0] == outer[-1]  # closed
    assert hole[0] == hole[-1]


def test_wkt_shape():
    wkt = poly_to_wkt(_text())
    assert wkt.startswith("MULTIPOLYGON(((")
    # two outer polygons -> two top-level polygon groups
    assert wkt.count(")), ((") == 1


def test_unclosed_ring_is_closed():
    polys = parse_poly("name\nsec\n0 0\n1 0\n1 1\nEND\nEND\n")
    ring = _oriented_closed(polys[0]["outer"], ccw=True)
    assert ring[0] == ring[-1]


def test_malformed_raises():
    with pytest.raises(PolyParseError):
        parse_poly("")  # empty
    with pytest.raises(PolyParseError):
        parse_poly("name\nsec\n0 0\n1 0\n1 1\n")  # section not terminated by END
    with pytest.raises(PolyParseError):
        parse_poly("name\nsec\nfoo bar\nEND\nEND\n")  # non-numeric coordinate
    with pytest.raises(PolyParseError):
        parse_poly("name\n!hole\n0 0\n1 0\n1 1\nEND\nEND\n")  # hole before any outer
    with pytest.raises(PolyParseError):
        parse_poly("name\nsec\n0 0\n1 0\nEND\nEND\n")  # ring < 3 points


@pytest.mark.asyncio
async def test_postgis_geography_covers(session):
    # Exercises the EXACT ST_GeogFromText / ST_Covers behavior the merge uses (merge.py:307-333),
    # against the CI postgis service — not just the workflow's dispatch-time check.
    wkt = poly_to_wkt(_text())

    valid = (
        await session.execute(
            text(
                "SELECT ST_IsValid(g::geometry) AND ST_Area(g) > 0 AND ST_Area(g) < 2.55e14 "
                "FROM (SELECT ST_GeogFromText(:wkt) AS g) s"
            ),
            {"wkt": wkt},
        )
    ).scalar_one()
    assert valid is True

    async def covers(lon: float, lat: float) -> bool:
        return (
            await session.execute(
                text("SELECT ST_Covers(ST_GeogFromText(:wkt), ST_GeogFromText(:pt))"),
                {"wkt": wkt, "pt": f"POINT({lon} {lat})"},
            )
        ).scalar_one()

    assert await covers(-119.9, 38.1) is True  # inside polygon1, outside the hole
    assert await covers(-119.7, 38.3) is False  # inside the hole -> excluded
    assert await covers(-121.5, 40.5) is True  # inside polygon2
    assert await covers(-100.0, 10.0) is False  # far outside
