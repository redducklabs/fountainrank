"""Convert a Geofabrik ``.poly`` (Osmosis polygon-filter format) to a WKT ``MULTIPOLYGON``.

Stdlib-only, standalone-runnable (``python3 backend/app/imports/poly_to_wkt.py in.poly out.wkt``).
The output feeds ``--scope-bounds-wkt(-file)`` -> ``ST_GeogFromText``, so it must be a valid
geography: rings closed, exterior **counter-clockwise** / holes **clockwise** so PostGIS geography
does not interpret an inverted ring as a near-global polygon (a real ``ST_Covers`` trap).

Orientation uses a planar shoelace signed area — correct for regional, non-antimeridian extracts
(California and essentially every Geofabrik country/state extract; see the plan's Task 2). The
workflow's PostGIS ``ST_Area < half-Earth`` check is the fail-closed backstop for any inversion or
degeneracy this cannot catch.

``.poly`` format: line 1 is a name; then one or more sections, each a header line (a leading ``!``
marks a hole belonging to the most recent outer ring), ``lon lat`` coordinate lines, then ``END``;
a trailing ``END`` terminates the file.
"""

from __future__ import annotations

import sys

Ring = list[tuple[float, float]]


class PolyParseError(ValueError):
    """Raised when a ``.poly`` file cannot be parsed into valid rings."""


def parse_poly(text: str) -> list[dict]:
    """Parse ``.poly`` text into ``[{"outer": Ring, "holes": [Ring, ...]}, ...]``."""
    lines = [ln.strip() for ln in text.splitlines()]
    lines = [ln for ln in lines if ln]  # drop blank lines
    if not lines:
        raise PolyParseError("empty .poly file")

    idx = 1  # line 0 is the polygon file name — ignore
    polygons: list[dict] = []
    while idx < len(lines):
        header = lines[idx]
        idx += 1
        if header == "END":  # file terminator
            break
        is_hole = header.startswith("!")
        ring: Ring = []
        terminated = False
        while idx < len(lines):
            ln = lines[idx]
            idx += 1
            if ln == "END":
                terminated = True
                break
            parts = ln.split()
            if len(parts) < 2:
                raise PolyParseError(f"bad coordinate line: {ln!r}")
            try:
                lon, lat = float(parts[0]), float(parts[1])
            except ValueError:
                raise PolyParseError(f"non-numeric coordinate: {ln!r}") from None
            ring.append((lon, lat))
        if not terminated:
            raise PolyParseError("section not terminated by END")
        if len(ring) < 3:
            raise PolyParseError("ring has fewer than 3 points")
        if is_hole:
            if not polygons:
                raise PolyParseError("hole (!) before any outer ring")
            polygons[-1]["holes"].append(ring)
        else:
            polygons.append({"outer": ring, "holes": []})

    if not polygons:
        raise PolyParseError("no polygons parsed")
    return polygons


def _signed_area(ring: Ring) -> float:
    # Planar shoelace; positive => counter-clockwise. Robust to an already-closed ring.
    s = 0.0
    n = len(ring)
    for i in range(n):
        x1, y1 = ring[i]
        x2, y2 = ring[(i + 1) % n]
        s += x1 * y2 - x2 * y1
    return s / 2.0


def _oriented_closed(ring: Ring, *, ccw: bool) -> Ring:
    if (_signed_area(ring) > 0) != ccw:
        ring = list(reversed(ring))
    if ring[0] != ring[-1]:
        ring = [*ring, ring[0]]
    return ring


def _ring_wkt(ring: Ring) -> str:
    return "(" + ", ".join(f"{lon} {lat}" for lon, lat in ring) + ")"


def polygons_to_wkt(polygons: list[dict]) -> str:
    """Build a WKT ``MULTIPOLYGON`` with exterior rings CCW and holes CW, all closed."""
    poly_strs = []
    for poly in polygons:
        rings = [_oriented_closed(poly["outer"], ccw=True)]
        rings += [_oriented_closed(h, ccw=False) for h in poly["holes"]]
        poly_strs.append("(" + ", ".join(_ring_wkt(r) for r in rings) + ")")
    return "MULTIPOLYGON(" + ", ".join(poly_strs) + ")"


def poly_to_wkt(text: str) -> str:
    return polygons_to_wkt(parse_poly(text))


def main(argv: list[str] | None = None) -> int:
    args = sys.argv[1:] if argv is None else argv
    if len(args) != 2:
        print("usage: poly_to_wkt.py <in.poly> <out.wkt>", file=sys.stderr)
        return 2
    in_path, out_path = args
    with open(in_path, encoding="utf-8") as fh:
        text = fh.read()
    polygons = parse_poly(text)
    wkt = polygons_to_wkt(polygons)
    with open(out_path, "w", encoding="utf-8") as fh:
        fh.write(wkt)
    holes = sum(len(p["holes"]) for p in polygons)
    print(f"polygons={len(polygons)} holes={holes}", file=sys.stderr)
    print(len(polygons))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
