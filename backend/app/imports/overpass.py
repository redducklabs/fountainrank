"""Convert an Overpass API ``[out:json]`` response into the importer's GeoJSON shape.

Stdlib-only so it can run standalone in CI (``python3 backend/app/imports/overpass.py
raw.json out.geojson``) and be unit-tested as a module. ``app.imports.osm`` expects GeoJSON
Features whose ``id`` is ``"type/osm_id"`` (e.g. ``"node/123"``) and a Point geometry; for
ways/relations we use the Overpass ``out center`` point.
"""

from __future__ import annotations

import json
import sys


def overpass_json_to_geojson(data: dict) -> dict:
    feats: list[dict] = []
    for e in data.get("elements", []):
        t, i = e.get("type"), e.get("id")
        if t is None or i is None:
            continue
        if t == "node":
            lon, lat = e.get("lon"), e.get("lat")
        else:
            c = e.get("center") or {}
            lon, lat = c.get("lon"), c.get("lat")
        if lon is None or lat is None:
            continue
        feats.append(
            {
                "type": "Feature",
                "id": f"{t}/{i}",
                "properties": e.get("tags") or {},
                "geometry": {"type": "Point", "coordinates": [lon, lat]},
            }
        )
    return {"type": "FeatureCollection", "features": feats}


def main(argv: list[str] | None = None) -> int:
    args = sys.argv[1:] if argv is None else argv
    if len(args) != 2:
        print("usage: overpass.py <raw_overpass.json> <out.geojson>", file=sys.stderr)
        return 2
    raw_path, out_path = args
    with open(raw_path, encoding="utf-8") as fh:
        data = json.load(fh)
    gj = overpass_json_to_geojson(data)
    with open(out_path, "w", encoding="utf-8") as fh:
        json.dump(gj, fh)
    print(len(gj["features"]))  # feature count -> the workflow's machine-readable result
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
