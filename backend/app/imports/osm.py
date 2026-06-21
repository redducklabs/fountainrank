"""Pure OSM GeoJSON parsing + filtering. No DB access — deterministic and unit-testable.

Turns a GeoJSON FeatureCollection into validated OsmCandidate objects, applying the
target-set rules (spec §2), an untrusted-tag allow-list with size caps (spec §6), and
coordinate validation. Non-point geometry is reduced to its centroid and recorded as
geometry_kind='centroid'.
"""

from __future__ import annotations

import json
import math
import unicodedata
from dataclasses import dataclass

OSM_TAG_ALLOWLIST: frozenset[str] = frozenset(
    {
        "amenity",
        "man_made",
        "drinking_water",
        "fee",
        "access",
        "bottle",
        "wheelchair",
        "indoor",
        "operator",
        "check_date",
        "opening_hours",
        "seasonal",
        "description",
    }
)
_LIFECYCLE_PREFIXES = (
    "disused:",
    "abandoned:",
    "construction:",
    "proposed:",
    "razed:",
    "removed:",
)
# access values that mean the public cannot freely use the feature (spec §2: exclude
# non-public). `permissive` IS publicly usable (by the owner's grace) -> imported at medium
# confidence. `yes`/`public`/unset -> public.
_NON_PUBLIC_ACCESS = frozenset({"private", "no", "customers", "permit"})


@dataclass(frozen=True)
class OsmCandidate:
    source_external_id: str
    osm_type: str
    osm_id: int
    latitude: float
    longitude: float
    tags: dict[str, str]
    confidence: str
    geometry_kind: str


@dataclass(frozen=True)
class ParseResult:
    candidates: list[OsmCandidate]
    skipped: list[tuple[str, str]]


def normalize_external_id(osm_type: str, osm_id: int) -> str:
    return f"osm:{osm_type}:{osm_id}"


def _parse_feature_id(raw_id: object) -> tuple[str | None, int | None]:
    # Accepts "node/123" (Overpass/osmtogeojson); returns (type, id).
    if isinstance(raw_id, str) and "/" in raw_id:
        kind, _, num = raw_id.partition("/")
        if kind in ("node", "way", "relation") and num.isdigit():
            return kind, int(num)
    return None, None


def _centroid(coords: list) -> tuple[float, float] | None:
    # Average the flattened ring/line vertices — adequate for a POI centroid.
    pts: list[tuple[float, float]] = []

    def walk(x: object) -> None:
        if isinstance(x, list) and len(x) == 2 and all(isinstance(v, (int, float)) for v in x):
            pts.append((float(x[0]), float(x[1])))
        elif isinstance(x, list):
            for y in x:
                walk(y)

    walk(coords)
    if not pts:
        return None
    return (sum(p[0] for p in pts) / len(pts), sum(p[1] for p in pts) / len(pts))


def _geometry_lonlat(geom: dict) -> tuple[float, float, str] | None:
    gtype = geom.get("type")
    coords = geom.get("coordinates")
    if gtype == "Point" and isinstance(coords, list) and len(coords) >= 2:
        return float(coords[0]), float(coords[1]), "point"
    if gtype in ("Polygon", "MultiPolygon", "LineString", "MultiLineString") and coords:
        c = _centroid(coords)
        if c:
            return c[0], c[1], "centroid"
    return None


def _valid_lonlat(lon: float, lat: float) -> bool:
    return (
        math.isfinite(lon)
        and math.isfinite(lat)
        and -180.0 <= lon <= 180.0
        and -90.0 <= lat <= 90.0
    )


def _sanitize_value(v: object, max_value_len: int) -> str | None:
    if not isinstance(v, str):
        v = str(v)
    # Strip control characters; normalize; cap length.
    cleaned = "".join(ch for ch in v if unicodedata.category(ch)[0] != "C")
    cleaned = unicodedata.normalize("NFC", cleaned).strip()
    if not cleaned:
        return None
    return cleaned[:max_value_len]


def _build_tags(
    props: dict, *, max_key_len: int, max_value_len: int, max_tags_bytes: int
) -> dict[str, str]:
    tags: dict[str, str] = {}
    for k, v in props.items():
        if not isinstance(k, str) or len(k) > max_key_len or k not in OSM_TAG_ALLOWLIST:
            continue
        sv = _sanitize_value(v, max_value_len)
        if sv is not None:
            tags[k] = sv
    # Cap total serialized size; drop largest values until under the byte cap.
    while tags and len(json.dumps(tags, ensure_ascii=False).encode("utf-8")) > max_tags_bytes:
        biggest = max(tags, key=lambda k: len(tags[k]))
        del tags[biggest]
    return tags


def _is_potable_candidate(props: dict) -> bool:
    if props.get("amenity") == "drinking_water":
        return True
    if props.get("man_made") == "water_tap" and props.get("drinking_water") == "yes":
        return True
    if props.get("amenity") == "fountain" and props.get("drinking_water") == "yes":
        return True
    return False


def _is_public_candidate(props: dict) -> bool:
    return props.get("access") not in _NON_PUBLIC_ACCESS


def _confidence(props: dict) -> str:
    if props.get("access") == "permissive":
        return "medium"  # publicly usable but not a public right -> lower confidence
    if props.get("amenity") == "drinking_water" and props.get("drinking_water") != "no":
        return "high"
    if props.get("drinking_water") == "yes":
        return "high"
    return "medium"


def parse_osm_geojson(
    geojson: dict, *, max_key_len: int, max_value_len: int, max_tags_bytes: int
) -> ParseResult:
    candidates: list[OsmCandidate] = []
    skipped: list[tuple[str, str]] = []
    for feat in geojson.get("features", []):
        props = feat.get("properties") or {}
        osm_type, osm_id = _parse_feature_id(feat.get("id"))
        ext = normalize_external_id(osm_type, osm_id) if osm_type else str(feat.get("id"))
        if osm_type is None:
            skipped.append((ext, "unparseable_feature_id"))
            continue
        if any(any(k.startswith(p) for p in _LIFECYCLE_PREFIXES) for k in props):
            skipped.append((ext, "lifecycle_inactive"))
            continue
        if not _is_potable_candidate(props):
            skipped.append((ext, "not_potable_signal"))
            continue
        if not _is_public_candidate(props):
            skipped.append((ext, "not_public"))
            continue
        geom = _geometry_lonlat(feat.get("geometry") or {})
        if geom is None:
            skipped.append((ext, "no_usable_geometry"))
            continue
        lon, lat, kind = geom
        if not _valid_lonlat(lon, lat):
            skipped.append((ext, "invalid_coordinates"))
            continue
        candidates.append(
            OsmCandidate(
                source_external_id=ext,
                osm_type=osm_type,
                osm_id=osm_id,
                latitude=lat,
                longitude=lon,
                tags=_build_tags(
                    props,
                    max_key_len=max_key_len,
                    max_value_len=max_value_len,
                    max_tags_bytes=max_tags_bytes,
                ),
                confidence=_confidence(props),
                geometry_kind=kind,
            )
        )
    return ParseResult(candidates=candidates, skipped=skipped)
