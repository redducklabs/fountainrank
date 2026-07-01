"""Region registry: load + validate ``.github/osm-import-regions.yml`` — the one-owner control.

Both import workflows call this **before any download** so unknown / retired / aggregate scopes
fail closed. The registry binds each scope's geographic extent:

- ``source: pbf``      -> ``key`` is a Geofabrik path; validated as the exact ``(key, scope_id,
  dataset)`` triple.
- ``source: overpass`` -> ``key`` is the canonical bbox ``"S,W,N,E"``; validated as
  ``(scope_id, dataset)`` **and** the dispatched bbox must equal the registry bbox numerically. The
  Overpass workflow derives a fail-closed ``scope_bounds`` rectangle from that registry bbox.

Pure validation functions are stdlib-only and unit-testable with plain dicts. YAML loading (PyYAML)
happens only in ``load_registry``/``main`` so the module can be invoked by file path from CI
(``python3 backend/app/imports/regions.py …``) — no ``app`` import, mirroring ``overpass.py``.
"""

from __future__ import annotations

import argparse
import sys

_IDENTITY_KEYS = {"key", "scope_id", "dataset", "source", "status"}


class RegionValidationError(ValueError):
    """Raised when a dispatched (source, scope_id, dataset[, key/bbox]) is not one active row."""


def _parse_bbox(raw: object) -> tuple[float, float, float, float]:
    parts = [p.strip() for p in str(raw).split(",")]
    if len(parts) != 4:
        raise RegionValidationError(f"bbox must be S,W,N,E (4 fields): {raw!r}")
    try:
        s, w, n, e = (float(p) for p in parts)
    except ValueError:
        raise RegionValidationError(f"bbox has a non-numeric field: {raw!r}") from None
    return s, w, n, e


def validate_region(
    rows: list[dict],
    *,
    source: str,
    scope_id: str,
    dataset: str,
    key: str | None = None,
    bbox: str | None = None,
) -> dict:
    """Return the single matching **active** registry row, or raise RegionValidationError."""
    if source not in ("pbf", "overpass"):
        raise RegionValidationError(f"unknown source: {source!r}")
    if source == "pbf" and key is None:
        raise RegionValidationError("pbf validation requires --key (the Geofabrik path)")
    if source == "overpass" and bbox is None:
        raise RegionValidationError("overpass validation requires --bbox")

    def identity_match(r: dict) -> bool:
        if r.get("source") != source:
            return False
        if r.get("scope_id") != scope_id or r.get("dataset") != dataset:
            return False
        if source == "pbf":
            return r.get("key") == key
        return True  # overpass identity is (scope_id, dataset); bbox is checked below

    matches = [r for r in rows if identity_match(r)]
    if not matches:
        detail = f" key={key!r}" if source == "pbf" else ""
        raise RegionValidationError(
            f"no registry row for source={source} scope_id={scope_id!r} "
            f"dataset={dataset!r}{detail} (unknown/aggregate scope rejected)"
        )
    active = [r for r in matches if r.get("status") == "active"]
    if not active:
        raise RegionValidationError(
            f"registry row for scope_id={scope_id!r} exists but is not active "
            f"(retired scope rejected)"
        )
    if len(active) > 1:
        raise RegionValidationError(
            f"ambiguous registry: {len(active)} active rows for scope_id={scope_id!r}"
        )
    row = active[0]
    if source == "overpass" and _parse_bbox(bbox) != _parse_bbox(row.get("key")):
        raise RegionValidationError(
            f"dispatched bbox {bbox!r} != registry bbox {row.get('key')!r} "
            f"for scope {scope_id!r} (bbox is bound to the scope)"
        )
    return row


def bbox_to_rectangle_wkt(bbox: str) -> str:
    """Build a CCW rectangle WKT POLYGON from an ``S,W,N,E`` bbox (fail-closed scope_bounds)."""
    s, w, n, e = _parse_bbox(bbox)
    return f"POLYGON(({w} {s}, {e} {s}, {e} {n}, {w} {n}, {w} {s}))"


def load_registry(path: str) -> list[dict]:
    import yaml  # deferred so the pure functions above stay stdlib-only + importable without PyYAML

    with open(path, encoding="utf-8") as fh:
        data = yaml.safe_load(fh)
    rows = (data or {}).get("regions")
    if not isinstance(rows, list):
        raise RegionValidationError("registry must have a top-level 'regions' list")
    return rows


def main(argv: list[str] | None = None) -> int:
    p = argparse.ArgumentParser(prog="regions")
    p.add_argument("--registry", default=".github/osm-import-regions.yml")
    p.add_argument("--source", required=True, choices=["pbf", "overpass"])
    p.add_argument("--scope-id", required=True)
    p.add_argument("--dataset", required=True)
    p.add_argument("--key")
    p.add_argument("--bbox")
    p.add_argument("--emit-scope-bounds-wkt")
    a = p.parse_args(argv)
    try:
        rows = load_registry(a.registry)
        row = validate_region(
            rows,
            source=a.source,
            scope_id=a.scope_id,
            dataset=a.dataset,
            key=a.key,
            bbox=a.bbox,
        )
        if a.emit_scope_bounds_wkt:
            if a.source != "overpass":
                raise RegionValidationError("--emit-scope-bounds-wkt is only valid for overpass")
            with open(a.emit_scope_bounds_wkt, "w", encoding="utf-8") as fh:
                fh.write(bbox_to_rectangle_wkt(row["key"]))
    except RegionValidationError as e:
        print(f"::error::region registry validation failed: {e}", file=sys.stderr)
        return 1
    except OSError as e:
        print(f"::error::cannot read registry {a.registry!r}: {e}", file=sys.stderr)
        return 1
    print(f"registry ok: source={a.source} scope_id={a.scope_id} dataset={a.dataset}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
