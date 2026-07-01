"""Normalize ``osmium export -u type_id -f geojson`` output to the importer's GeoJSON shape.

Stdlib-only so it runs standalone in CI (``python3 backend/app/imports/osmium_geojson.py
osmium.geojson import.geojson``) and is unit-testable as a module (no ``app`` imports).

The shipped parser (``app.imports.osm._parse_feature_id``) accepts Features whose ``id`` is
``"<type>/<osm_id>"`` with type in {node, way, relation} — the Overpass convention. ``osmium
export --add-unique-id=type_id`` instead emits a different scheme (per the osmium docs):

- node  -> ``n<node_id>``
- way exported as a LineString -> ``w<way_id>``
- **area** (closed way or multipolygon) -> ``a<area_id>``, where ``area_id = 2*way_id`` for
  way-areas (even) and ``area_id = 2*relation_id + 1`` for relation-areas (odd).

So a closed way can appear **twice** (as ``w<id>`` line *and* ``a<2*id>`` area), and area ids
encode the source type in their parity. This module decodes those ids, re-emits canonical
``<type>/<id>`` (the exact form the shipped parser accepts — parser stays unchanged), and dedupes
to **one** feature per OSM object with a deterministic geometry-priority rule so that a refresh
never depends on osmium's output order (non-determinism would move imported unrated rows and churn
provenance).
"""

from __future__ import annotations

import json
import sys

# Dedup priority when the same OSM object appears with multiple geometries. Polygon/MultiPolygon
# beats Point beats LineString/MultiLineString; anything else is lowest.
_GEOM_PRIORITY = {
    "Polygon": 3,
    "MultiPolygon": 3,
    "Point": 2,
    "LineString": 1,
    "MultiLineString": 1,
}


def _decode_osmium_id(raw: object) -> tuple[str, int] | None:
    """Decode an osmium ``-u type_id`` id (``n``/``w``/``a`` + area parity). None if malformed."""
    if not isinstance(raw, str) or len(raw) < 2:
        return None
    prefix, rest = raw[0], raw[1:]
    if not rest.isdigit():  # rejects negatives, signs, whitespace, empty
        return None
    val = int(rest)
    if prefix == "n":
        return ("node", val)
    if prefix == "w":
        return ("way", val)
    if prefix == "a":
        # area id parity: even -> way (id/2); odd -> relation ((id-1)/2).
        if val % 2 == 0:
            return ("way", val // 2)
        return ("relation", (val - 1) // 2)
    return None


def osmium_geojson_to_import_geojson(data: dict) -> tuple[dict, dict]:
    """Return (canonical FeatureCollection, stats). Deterministic, order-independent."""
    best: dict[tuple[str, int], tuple[int, str, dict]] = {}
    stats = {
        "nodes": 0,
        "ways": 0,
        "relations": 0,
        "areas": 0,
        "deduped": 0,
        "unparseable": 0,
        "kept": 0,
    }
    for feat in data.get("features", []):
        if not isinstance(feat, dict):
            stats["unparseable"] += 1
            continue
        raw = feat.get("id")
        decoded = _decode_osmium_id(raw)
        if decoded is None:
            stats["unparseable"] += 1
            continue
        osm_type, osm_id = decoded
        if isinstance(raw, str) and raw.startswith("a"):
            stats["areas"] += 1
        stats[{"node": "nodes", "way": "ways", "relation": "relations"}[osm_type]] += 1

        geom = feat.get("geometry") or {}
        prio = _GEOM_PRIORITY.get(geom.get("type"), 0)
        canonical = {
            "type": "Feature",
            "id": f"{osm_type}/{osm_id}",
            "properties": feat.get("properties") or {},
            "geometry": geom,
        }
        key = (osm_type, osm_id)
        prev = best.get(key)
        if prev is None:
            best[key] = (prio, str(raw), canonical)
            continue
        # Collision: same OSM object emitted more than once. Keep highest geometry priority;
        # tie-break by the lowest original osmium id string (total order -> order-independent).
        stats["deduped"] += 1
        prev_prio, prev_raw, _ = prev
        if prio > prev_prio or (prio == prev_prio and str(raw) < prev_raw):
            best[key] = (prio, str(raw), canonical)

    # Deterministic output order (by type then numeric id) so diffs/tests are stable.
    items = sorted(best.items(), key=lambda kv: (kv[0][0], kv[0][1]))
    feats = [canonical for _, (_, _, canonical) in items]
    stats["kept"] = len(feats)
    return {"type": "FeatureCollection", "features": feats}, stats


def main(argv: list[str] | None = None) -> int:
    args = sys.argv[1:] if argv is None else argv
    if len(args) != 2:
        print("usage: osmium_geojson.py <osmium_export.geojson> <out.geojson>", file=sys.stderr)
        return 2
    in_path, out_path = args
    with open(in_path, encoding="utf-8") as fh:
        data = json.load(fh)
    gj, stats = osmium_geojson_to_import_geojson(data)
    with open(out_path, "w", encoding="utf-8") as fh:
        json.dump(gj, fh)
    # Stats (incl. relation/area counts, per spec §3) -> stderr; feature count -> stdout as the
    # workflow's machine-readable result (mirrors overpass.py).
    print(f"stats: {json.dumps(stats)}", file=sys.stderr)
    print(len(gj["features"]))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
