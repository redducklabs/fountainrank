"""DB loader for Overture ``division_area`` boundaries — idempotent, auditable.

Slice 1b of ``docs/plans/2026-07-02-crawlable-seo-pages.md`` (#127). The DB half of the
pure/DB split (``app.imports.boundaries`` is the pure half), mirroring ``app.imports.merge``.

Given parsed :class:`~app.imports.boundaries.BoundaryFeature` objects, upserts them into
``place_boundaries`` keyed on the Overture GERS ``overture_id`` (spec §11.4). Geometry is coerced
into the ``MULTIPOLYGON`` geography column: ``ST_MakeValid`` fixes rings first,
``ST_CollectionExtract(…, 3)`` keeps only polygonal parts, and ``ST_Multi`` promotes a bare
``Polygon`` (Overture mixes ``Polygon``/``MultiPolygon`` — spec §11.6). A geometry that does not
survive as a non-empty
MultiPolygon is **flagged and skipped**, never inserted (spec §11.2 keeps this guard even though
the Slice-0 spike measured 0% invalid). The ``slug`` is **sticky**: set on first insert and never
overwritten on update, so a renamed boundary keeps its URL (spec §4.3). The loader never sets
``is_canonical`` — canonical selection is Slice 1d. One transaction per call; the caller commits.
"""

from __future__ import annotations

import json
import logging
from dataclasses import dataclass

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.imports.boundaries import BoundaryFeature

log = logging.getLogger(__name__)

# Coerce to a clean, non-empty MultiPolygon geography or reject. `coerced` is MATERIALIZED so the
# ST_MakeValid pipeline runs once per feature (it is referenced by both the WHERE and the SELECT).
# The `existing` probe reads the pre-upsert snapshot, so `existed` classifies insert vs update;
# `wrote` is 0 only when the validity gate filtered the row out (invalid geometry).
_UPSERT_SQL = text(
    """
    WITH coerced AS MATERIALIZED (
        SELECT ST_Multi(ST_CollectionExtract(ST_MakeValid(ST_GeomFromGeoJSON(:geojson)), 3)) AS g
    ),
    existing AS (
        SELECT id FROM place_boundaries WHERE overture_id = :overture_id
    ),
    ins AS (
        INSERT INTO place_boundaries
            (id, overture_id, subtype, "class", admin_level, osm_type, osm_id,
             name, country_code, slug, is_canonical, boundary, created_at, updated_at)
        SELECT gen_random_uuid(), :overture_id, :subtype, :place_class, :admin_level,
               :osm_type, :osm_id, :name, :country_code, :slug, false,
               coerced.g::geography, now(), now()
        FROM coerced
        WHERE ST_IsValid(coerced.g)
          AND NOT ST_IsEmpty(coerced.g)
          AND GeometryType(coerced.g) = 'MULTIPOLYGON'
        ON CONFLICT (overture_id) DO UPDATE SET
            subtype = EXCLUDED.subtype,
            "class" = EXCLUDED."class",
            admin_level = EXCLUDED.admin_level,
            osm_type = EXCLUDED.osm_type,
            osm_id = EXCLUDED.osm_id,
            name = EXCLUDED.name,
            country_code = EXCLUDED.country_code,
            -- slug is intentionally NOT updated: it is sticky (spec §4.3).
            boundary = EXCLUDED.boundary,
            updated_at = now()
        RETURNING overture_id
    )
    SELECT
        (SELECT count(*) FROM existing) AS existed,
        (SELECT count(*) FROM ins) AS wrote
    """
)

# Dry-run parity: compute the same validity gate + existence, but write nothing.
_DRYRUN_SQL = text(
    """
    WITH coerced AS MATERIALIZED (
        SELECT ST_Multi(ST_CollectionExtract(ST_MakeValid(ST_GeomFromGeoJSON(:geojson)), 3)) AS g
    ),
    existing AS (
        SELECT id FROM place_boundaries WHERE overture_id = :overture_id
    )
    SELECT
        (SELECT count(*) FROM existing) AS existed,
        (
            ST_IsValid(coerced.g)
            AND NOT ST_IsEmpty(coerced.g)
            AND GeometryType(coerced.g) = 'MULTIPOLYGON'
        ) AS valid
    FROM coerced
    """
)


@dataclass
class BoundaryLoadSummary:
    feature_count: int = 0
    inserted_count: int = 0
    updated_count: int = 0
    skipped_invalid_count: int = 0
    dry_run: bool = False


def _params(feature: BoundaryFeature) -> dict:
    return {
        "geojson": json.dumps(feature.geometry),
        "overture_id": feature.overture_id,
        "subtype": feature.subtype,
        "place_class": feature.place_class,
        "admin_level": feature.admin_level,
        "osm_type": feature.osm_type,
        "osm_id": feature.osm_id,
        "name": feature.name,
        # Lowercased at the insert boundary so canonical (country_code, slug) uniqueness is never
        # split by case — the parser already lowercases, but load_boundaries is a directly-callable
        # internal API, so the guarantee is enforced here too (Codex 1b watch-item).
        "country_code": feature.country_code.lower(),
        "slug": feature.slug,
    }


async def apply_boundary_feature(
    session: AsyncSession,
    feature: BoundaryFeature,
    *,
    dry_run: bool,
    summary: BoundaryLoadSummary,
) -> None:
    """Upsert (or dry-run validate) ONE feature, updating ``summary`` in place. Does NOT commit —
    the caller owns the transaction boundary: :func:`load_boundaries` runs the whole list in one
    txn (its caller commits), while ``boundary_cli`` commits per streamed batch to bound memory +
    transaction size on country-scale loads (spec §11.3).
    """
    summary.feature_count += 1
    params = _params(feature)
    stmt = _DRYRUN_SQL if dry_run else _UPSERT_SQL
    row = (await session.execute(stmt, params)).one()

    invalid = row.wrote == 0 if not dry_run else not row.valid
    if invalid:
        summary.skipped_invalid_count += 1
        # A silent geometry drop would read as "loaded" — log it so it is diagnosable.
        log.warning(
            "boundary_invalid_geometry",
            extra={
                "overture_id": feature.overture_id,
                "subtype": feature.subtype,
                "country_code": feature.country_code,
                "geometry_type": feature.geometry.get("type"),
                "dry_run": dry_run,
            },
        )
        return
    if row.existed == 0:
        summary.inserted_count += 1
    else:
        summary.updated_count += 1


def log_boundary_load_complete(
    summary: BoundaryLoadSummary, *, release_id: str | None, scope_id: str | None
) -> None:
    """Emit the single ``boundary_load_complete`` summary log — shared by the list loader and the
    streaming CLI so a batched load reports one summary line, not one per batch."""
    log.info(
        "boundary_load_complete",
        extra={
            "dry_run": summary.dry_run,
            "release_id": release_id,
            "scope_id": scope_id,
            "features": summary.feature_count,
            "inserted": summary.inserted_count,
            "updated": summary.updated_count,
            "skipped_invalid": summary.skipped_invalid_count,
        },
    )


async def load_boundaries(
    session: AsyncSession,
    *,
    features: list[BoundaryFeature],
    dry_run: bool = False,
    release_id: str | None = None,
    scope_id: str | None = None,
) -> BoundaryLoadSummary:
    """Upsert boundary features into ``place_boundaries``. One transaction; caller commits.

    ``release_id``/``scope_id`` are structured-logging context only (the pinned Overture release
    and the dispatched scope — spec §11.3); ``place_boundaries`` has no columns for them.
    """
    summary = BoundaryLoadSummary(dry_run=dry_run)
    for feature in features:
        await apply_boundary_feature(session, feature, dry_run=dry_run, summary=summary)
    log_boundary_load_complete(summary, release_id=release_id, scope_id=scope_id)
    return summary
