"""Pure Overture ``division_area`` extraction — no DB, deterministic, unit-testable.

Slice 1b of ``docs/plans/2026-07-02-crawlable-seo-pages.md`` (#127). Turns the DuckDB-fetched
Overture Divisions GeoJSON (spec §11.3) into validated :class:`BoundaryFeature` objects,
mirroring the pure/DB split of ``app.imports.osm`` (pure) vs ``app.imports.merge`` (DB).
Stdlib-only so it imports without ``app`` and stays trivially testable.

Contract (spec §11.4–§11.6): identity is the Overture GERS ``overture_id``; the city tier is a
``subtype`` (``admin_level`` is Overture-normalized — 0/1/2, NULL at ``locality`` — informational
only, not the city selector); ``osm_type``/``osm_id`` are **best-effort, nullable** provenance
decoded from ``sources[]`` (prefer relation > way > node); ``country_code`` is **lowercased** to
match the ``/drinking-fountains/[country]`` URL segment (Codex 1b watch-item). Geometry is passed
through untouched — the DB loader owns ``ST_MakeValid``/``ST_Multi`` coercion + the validity gate.
"""

from __future__ import annotations

import json
import re
import unicodedata
from dataclasses import dataclass

# Overture OSM provenance: ``sources[].record_id`` is the pinned ``<n|w|r><id>@<version>`` shape
# (spec §11.4). We match it exactly and drop the ``@version``. A record_id that is not this shape
# (version-less, or the slash form "relation/123") is NOT the pinned Overture form, so it yields
# no provenance — nullable best-effort, never treated as authoritative from non-Overture data.
_OSM_RECORD_RE = re.compile(r"^([nwr])(\d+)@\d+$")
_OSM_TYPE = {"n": "node", "w": "way", "r": "relation"}
# Prefer the boundary relation over a way over a name node (spec §11.4).
_OSM_PRIORITY = {"relation": 3, "way": 2, "node": 1}
_OSM_DATASET = "OpenStreetMap"

# Slug: fold to ASCII, lowercase, collapse every non-alphanumeric run to a single hyphen.
_SLUG_NONALNUM = re.compile(r"[^a-z0-9]+")


@dataclass(frozen=True)
class BoundaryFeature:
    overture_id: str
    subtype: str
    place_class: str  # Overture ``class`` (a Python keyword); DB column is ``class``.
    admin_level: int | None
    osm_type: str | None
    osm_id: int | None
    name: str
    country_code: str  # ISO 3166-1 alpha-2, lowercased.
    slug: str
    geometry: dict  # GeoJSON geometry, passed through for DB-side ST_Multi/ST_MakeValid.


@dataclass(frozen=True)
class BoundaryParseResult:
    features: list[BoundaryFeature]
    # (overture_id or "?", reason) — mirrors ParseResult.skipped in app.imports.osm.
    skipped: list[tuple[str, str]]


def slugify(name: str) -> str:
    """URL-safe slug: NFKD ASCII-fold, lowercase, non-alphanumeric runs -> single hyphen.

    Returns ``""`` for a name with no sluggable characters (the caller skips those — a place
    with no usable slug can't own a URL segment).
    """
    if not isinstance(name, str):
        name = str(name)
    decomposed = unicodedata.normalize("NFKD", name)
    ascii_folded = "".join(ch for ch in decomposed if not unicodedata.combining(ch))
    ascii_folded = ascii_folded.encode("ascii", "ignore").decode("ascii")
    return _SLUG_NONALNUM.sub("-", ascii_folded.lower()).strip("-")


def decode_osm_source(sources: object) -> tuple[str | None, int | None]:
    """Best-effort ``(osm_type, osm_id)`` from Overture ``sources[]`` — nullable (spec §11.4).

    Scans every ``dataset='OpenStreetMap'`` entry, decodes its ``record_id``, and returns the
    highest-priority OSM object (relation > way > node). ``(None, None)`` when there is no
    decodable OSM source (geoBoundaries-conflated features carry none). Accepts either a native
    list or a JSON-string-encoded list (GDAL/ogr2ogr can serialize the nested array as a string).
    """
    if isinstance(sources, str):
        try:
            sources = json.loads(sources)
        except (ValueError, TypeError):
            return (None, None)
    if not isinstance(sources, list):
        return (None, None)
    best: tuple[int, str, int] | None = None
    for src in sources:
        if not isinstance(src, dict) or src.get("dataset") != _OSM_DATASET:
            continue
        record_id = src.get("record_id")
        if not isinstance(record_id, str):
            continue
        match = _OSM_RECORD_RE.match(record_id)
        if match is None:
            continue
        osm_type = _OSM_TYPE[match.group(1)]
        priority = _OSM_PRIORITY[osm_type]
        if best is None or priority > best[0]:
            best = (priority, osm_type, int(match.group(2)))
    if best is None:
        return (None, None)
    return (best[1], best[2])


def _clean_str(value: object) -> str:
    return "" if value is None else str(value).strip()


def _admin_level(raw: object) -> int | None:
    # Overture-normalized level: int (0/1/2…) or NULL at the locality tier. Preserve 0 (falsy
    # but valid — the country level); coerce numeric strings; anything else -> None.
    if raw is None or isinstance(raw, bool):
        return None
    if isinstance(raw, int):
        return raw
    try:
        return int(str(raw).strip())
    except (ValueError, TypeError):
        return None


def parse_boundary_feature(feat: object) -> tuple[BoundaryFeature | None, tuple[str, str] | None]:
    """Parse ONE division_area GeoJSON Feature.

    Returns ``(feature, None)`` on success, or ``(None, (overture_id_or_"?", reason))`` when the
    feature is skipped. Split out of :func:`parse_boundary_geojson` so ``boundary_cli`` can stream
    features one line at a time (a GeoJSONSeq file — spec §11.3) instead of holding a whole
    FeatureCollection in memory, which OOM-kills the loader pod on country-scale loads (US ~35k
    features).
    """
    if not isinstance(feat, dict):
        return None, ("?", "not_a_feature")
    props = feat.get("properties") or {}

    # Identity: `overture_id` property, or a GDAL-promoted feature-level `id` fallback.
    raw_oid = props.get("overture_id")
    if raw_oid is None:
        raw_oid = feat.get("id")
    overture_id = _clean_str(raw_oid)
    if not overture_id:
        return None, ("?", "missing_overture_id")

    subtype = _clean_str(props.get("subtype"))
    if not subtype:
        return None, (overture_id, "missing_subtype")
    place_class = _clean_str(props.get("class"))
    if not place_class:
        return None, (overture_id, "missing_class")
    if place_class != "land":
        # Fail-closed at the write boundary: only land areas are boundaries. Every division
        # may ship a maritime twin (same division_id, DIFFERENT overture_id) — if one reached
        # place_boundaries it would persist as a bogus over-water "place" and pollute Slice-1d
        # membership/canonical selection. Slice 1c also filters WHERE class='land' upstream;
        # this is the defense-in-depth gate for a regressed query / manual file / mixed extract
        # (spec §11.2/§11.3; the models.py PlaceBoundary docstring promises land-only).
        return None, (overture_id, "non_land_class")
    name = _clean_str(props.get("name"))
    if not name:
        return None, (overture_id, "missing_name")

    raw_country = props.get("country")
    if raw_country is None:
        raw_country = props.get("country_code")
    country_code = _clean_str(raw_country).lower()
    if not country_code:
        return None, (overture_id, "missing_country")

    geometry = feat.get("geometry")
    if (
        not isinstance(geometry, dict)
        or not geometry.get("type")
        or not geometry.get("coordinates")
    ):
        return None, (overture_id, "missing_geometry")

    slug = slugify(name)
    if not slug:
        return None, (overture_id, "unsluggable_name")

    osm_type, osm_id = decode_osm_source(props.get("sources"))
    return (
        BoundaryFeature(
            overture_id=overture_id,
            subtype=subtype,
            place_class=place_class,
            admin_level=_admin_level(props.get("admin_level")),
            osm_type=osm_type,
            osm_id=osm_id,
            name=name,
            country_code=country_code,
            slug=slug,
            geometry=geometry,
        ),
        None,
    )


def parse_boundary_geojson(geojson: dict) -> BoundaryParseResult:
    """Extract validated :class:`BoundaryFeature` objects from a division_area FeatureCollection."""
    features: list[BoundaryFeature] = []
    skipped: list[tuple[str, str]] = []
    for feat in geojson.get("features", []):
        feature, skip = parse_boundary_feature(feat)
        if feature is not None:
            features.append(feature)
        else:
            skipped.append(skip)
    return BoundaryParseResult(features=features, skipped=skipped)
