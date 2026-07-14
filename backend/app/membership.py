"""Precomputed fountain -> place membership (#127 Slice 1d, spec §5/§11.5).

The public place pages (Slice 2+) MUST NOT run a live ``ST_Covers`` (spec §5 "resolves [MAJOR]
perf"). This module precomputes, per fountain, its containing **country** place and its
most-specific eligible **city** place, and keeps the denormalized ``fountain_count`` per place +
the ``is_canonical`` / ``parent_id`` derivations current. It is the ``recompute_*`` sibling of
``app/ranking.py`` / ``app/conditions.py`` / ``app/consensus.py``.

City-assignment ladder (spec §11.5, binding):
  1. **Country** = the ``subtype='country'`` polygon that covers the point (else unmatched:
     country + city both NULL — the country's boundaries are not loaded).
  2. **City** = among the covering ``division_area`` rows whose ``subtype`` is in the country's
     eligible set (``place_scope_config`` row, or the code default ``{locality, localadmin}``),
     the highest-priority subtype (``locality`` > ``localadmin`` > ``county``), smallest-area on
     ties. No eligible polygon covers the point -> **country-only, never a coarser forced tier**.
  3. **Canonical** (``is_canonical``) resolves same-``(country_code, slug)`` collisions across
     subtypes — highest-priority subtype, then largest ``fountain_count`` — so exactly one place
     owns the public ``/drinking-fountains/[country]/[city]`` URL (spec §4.3).

Two entry points share the ladder SQL:
- :func:`recompute_fountain_membership` — ONE fountain (user add / OSM import per-fountain / admin
  move or hide). Re-assigns that fountain, recomputes ``fountain_count`` for exactly the places it
  touched (old ∪ new), and re-selects ``is_canonical`` for those places' ``(country_code, slug)``
  group(s). Cheap: two GIST-indexed ``ST_Covers`` probes + a handful of counted/ranked places.
- :func:`recompute_place_counts` — count-only variant for the admin **delete** path (the fountain
  row is already gone, so there is nothing to re-assign): recomputes + re-canonicalizes exactly the
  given places' groups.
- :func:`refresh_all_memberships` — the whole DB (boundary load + backfill). Optionally rebuilds
  the ``place_boundary_cells`` point-in-polygon index (see below), then re-assigns every fountain,
  recomputes ``fountain_count`` (all places), ``is_canonical`` (uses the fresh counts), and
  ``parent_id`` (city -> country by matching ``country_code``). Set-based; one transaction (the
  caller commits).

Point-in-polygon at country scale runs against :class:`~app.models.PlaceBoundaryCell` — every
boundary broken into small ``ST_Subdivide`` cells — not the whole polygon: probing the ~136k-vertex
US country polygon per fountain ran the backfill 40+ min, while the cell GiST index makes it ~7s
(measured on prod). :func:`rebuild_place_boundary_cells` (re)builds that derivative from
``place_boundaries``; ``refresh_all_memberships`` does it only when boundaries changed (boundary
load / backfill), never on a plain OSM import (``rebuild_cells=False``). The single-fountain path
reads the already-built cells (a user add does not change boundaries).

``parent_id`` changes only when **boundaries** change, so the single-fountain path skips it. But
``is_canonical`` tie-breaks on ``fountain_count`` (spec §4.3/§11.5), so ANY count-changing path
re-selects the canonical owner for exactly the affected ``(country_code, slug)`` group(s) — the
public URL never resolves to a stale winner between full refreshes.

**Concurrency:** every count/canonical write is serialized on the ``ADD_FOUNTAIN_LOCK`` advisory
lock (shared with POST /fountains and the OSM import). :func:`refresh_all_memberships` takes it
itself (its CLI callers hold no other lock); the single-fountain / count-only helpers assume the
caller already holds it — every request path that calls them (add, admin patch/delete) takes it
first, and the re-entrant lock in ``merge``/``rollback`` covers the import path.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass

from sqlalchemy import func, select, text
from sqlalchemy.ext.asyncio import AsyncSession

from app.locks import ADD_FOUNTAIN_LOCK_KEY

log = logging.getLogger(__name__)

# The eligible city subtypes for a country with no place_scope_config row (spec §11.5). Kept here
# as the single source of truth and rendered into the SQL array literal below so a country-scale
# assignment never has to bind an array parameter.
DEFAULT_ELIGIBLE_CITY_SUBTYPES: tuple[str, ...] = ("locality", "localadmin")
DEFAULT_ELIGIBLE_REGION_SUBTYPES: tuple[str, ...] = ("region",)

# City specificity: locality (finest) > localadmin > county (coarsest eligible). A subtype outside
# the ladder sorts last (0) — it can only appear here if a scope opts an unexpected subtype into its
# eligible set, in which case "least specific" is the safe default.
_CITY_PRIORITY = {"locality": 3, "localadmin": 2, "county": 1}


def _priority_case(col: str) -> str:
    """A SQL ``CASE`` mapping a subtype column to its ladder priority (higher = more specific)."""
    whens = " ".join(f"WHEN '{sub}' THEN {rank}" for sub, rank in _CITY_PRIORITY.items())
    return f"CASE {col} {whens} ELSE 0 END"


# SQL array literal for the default eligible set, built from the constant (values are fixed internal
# subtype identifiers — never user input — so string-building is injection-safe).
_DEFAULT_ELIGIBLE_SQL = "ARRAY[" + ", ".join(f"'{s}'" for s in DEFAULT_ELIGIBLE_CITY_SUBTYPES) + "]"
_DEFAULT_REGION_ELIGIBLE_SQL = (
    "ARRAY[" + ", ".join(f"'{s}'" for s in DEFAULT_ELIGIBLE_REGION_SUBTYPES) + "]"
)

# Rebuild place_boundary_cells: break every boundary into small ST_Subdivide pieces so that a
# point-in-polygon probe hits a GiST index of small cells instead of one giant polygon. The US
# country polygon is ~136k vertices and its bbox covers every fountain, so the boundary GiST
# prefilter pruned nothing and each of ~50k fountains ran an exact PIP against 136k vertices — the
# country-scale backfill ran 40+ min. Via cells the same assignment is ~7s (measured on prod). 128
# = max vertices per output piece (the canonical PostGIS point-in-huge-polygon subdivision size).
# Cells are a rebuildable derivative of place_boundaries: TRUNCATE + full re-subdivide replaces them
# wholesale whenever boundaries change (boundary load) or on the membership backfill. TRUNCATE is
# transactional in PostgreSQL, so a rolled-back refresh leaves the prior cells intact.
_TRUNCATE_CELLS_SQL = text("TRUNCATE place_boundary_cells")
_REBUILD_CELLS_SQL = text(
    """
    INSERT INTO place_boundary_cells (id, place_id, geom)
    SELECT gen_random_uuid(), pb.id, sub.geom
    FROM place_boundaries pb
    CROSS JOIN LATERAL ST_Subdivide(pb.boundary::geometry, 128) AS sub(geom)
    """
)
# ANALYZE the freshly-rebuilt cells (standalone ANALYZE is allowed inside a transaction block).
# TRUNCATE resets reltuples to 0 and the re-INSERTed rows are uncommitted, so without this the
# planner still thinks the table is empty and would seq-scan it inside the per-fountain PIP LATERAL
# — turning the ~7s cell scan back into a country-scale disaster. Fresh stats let the planner pick
# the cell GiST index.
_ANALYZE_CELLS_SQL = text("ANALYZE place_boundary_cells")
_COUNT_CELLS_SQL = text("SELECT count(*) FROM place_boundary_cells")

# Derive URL tier from subtype + per-country scope configuration.
_PLACE_KIND_SQL = text(
    f"""
    UPDATE place_boundaries pb
    SET place_kind = CASE
        WHEN pb.subtype = 'country' THEN 'country'
        WHEN pb.subtype = ANY(
            COALESCE(cfg.eligible_region_subtypes, {_DEFAULT_REGION_ELIGIBLE_SQL})
        )
            THEN 'region'
        WHEN pb.subtype = ANY(COALESCE(cfg.eligible_city_subtypes, {_DEFAULT_ELIGIBLE_SQL}))
            THEN 'city'
        ELSE NULL
    END
    FROM place_boundaries src
    LEFT JOIN place_scope_config cfg ON cfg.country_code = src.country_code
    WHERE pb.id = src.id
      AND pb.place_kind IS DISTINCT FROM CASE
        WHEN src.subtype = 'country' THEN 'country'
        WHEN src.subtype = ANY(
            COALESCE(cfg.eligible_region_subtypes, {_DEFAULT_REGION_ELIGIBLE_SQL})
        )
            THEN 'region'
        WHEN src.subtype = ANY(COALESCE(cfg.eligible_city_subtypes, {_DEFAULT_ELIGIBLE_SQL}))
            THEN 'city'
        ELSE NULL
    END
    """
)

_PLACE_KIND_SUMMARY_SQL = text(
    """
    SELECT
        count(*) FILTER (WHERE place_kind = 'country') AS countries,
        count(*) FILTER (WHERE place_kind = 'region') AS regions,
        count(*) FILTER (WHERE place_kind = 'city') AS cities,
        count(*) FILTER (WHERE place_kind IS NULL) AS none
    FROM place_boundaries
    """
)

# Assign country_place_id + region_place_id + city_place_id for the fountains selected by the
# :fountain_id filter
# (a NULL filter = all fountains). Point-in-polygon runs against place_boundary_cells (the
# subdivided pieces), not the whole boundary: ST_Covers(c.geom, location::geometry) is a planar
# (geometry-space) containment test — correct for lon/lat point-in-polygon and cheaper than
# geography — resolved against a small cell via the cell GiST index, then joined back to the owning
# place_boundaries row by place_id. The city LATERAL keys off the country match's country_code, so
# an unmatched point (no country polygon) yields both NULL, and a covered-but-no-eligible-city
# point yields country-only. Countries do not overlap, so the country match tie-breaks on
# overture_id (deterministic) instead of ST_Area — dropping a needless ST_Area over the 136k-vertex
# country polygon. The city tie-break keeps smallest-area-wins (city polygons are small, so
# ST_Area is cheap) with overture_id as a final deterministic tie-break.
_ASSIGN_SQL = text(
    f"""
    UPDATE fountains f
    SET country_place_id = m.country_place_id,
        region_place_id = m.region_place_id,
        city_place_id = m.city_place_id
    FROM (
        SELECT
            f2.id AS fountain_id,
            cc.country_place_id,
            region.region_place_id,
            city.city_place_id
        FROM fountains f2
        LEFT JOIN LATERAL (
            SELECT pb.id AS country_place_id, pb.country_code
            FROM place_boundary_cells c
            JOIN place_boundaries pb ON pb.id = c.place_id
            WHERE pb.place_kind = 'country'
              AND ST_Covers(c.geom, f2.location::geometry)
            ORDER BY pb.overture_id ASC
            LIMIT 1
        ) cc ON TRUE
        LEFT JOIN LATERAL (
            SELECT pb.id AS region_place_id
            FROM place_boundary_cells c
            JOIN place_boundaries pb ON pb.id = c.place_id
            WHERE pb.country_code = cc.country_code
              AND pb.place_kind = 'region'
              AND ST_Covers(c.geom, f2.location::geometry)
            ORDER BY ST_Area(pb.boundary) ASC, pb.overture_id ASC
            LIMIT 1
        ) region ON TRUE
        LEFT JOIN LATERAL (
            SELECT pb.id AS city_place_id
            FROM place_boundary_cells c
            JOIN place_boundaries pb ON pb.id = c.place_id
            WHERE pb.country_code = cc.country_code
              AND pb.place_kind = 'city'
              AND ST_Covers(c.geom, f2.location::geometry)
            ORDER BY ({_priority_case("pb.subtype")}) DESC,
                     ST_Area(pb.boundary) ASC,
                     pb.overture_id ASC
            LIMIT 1
        ) city ON TRUE
        WHERE (CAST(:fountain_id AS uuid) IS NULL OR f2.id = CAST(:fountain_id AS uuid))
    ) m
    WHERE f.id = m.fountain_id
      AND (f.country_place_id IS DISTINCT FROM m.country_place_id
           OR f.region_place_id IS DISTINCT FROM m.region_place_id
           OR f.city_place_id IS DISTINCT FROM m.city_place_id)
    """
)

# Recompute fountain_count for a specific set of places (the single-fountain path). Only non-hidden
# fountains count (the public number + the >= K gate). A place appears in exactly one of the two FK
# columns across all fountains (a country polygon is only ever a country_place_id, a city polygon
# only ever a city_place_id), so the OR never double-counts.
_RECOUNT_PLACES_SQL = text(
    """
    UPDATE place_boundaries pb
    SET fountain_count = (
        SELECT count(*) FROM fountains f
        WHERE f.is_hidden = false
          AND (f.city_place_id = pb.id OR f.region_place_id = pb.id OR f.country_place_id = pb.id)
    )
    WHERE pb.id = ANY(:place_ids)
    """
)

# Recompute fountain_count for EVERY place in one pass (full refresh). GROUP BY once over the two
# membership columns, then LEFT JOIN so places with zero fountains reset to 0. IS DISTINCT FROM
# skips no-op writes (leaves updated_at untouched on unchanged rows).
_RECOUNT_ALL_SQL = text(
    """
    WITH counts AS (
        SELECT place_id, count(*) AS n
        FROM (
            SELECT city_place_id AS place_id FROM fountains
            WHERE is_hidden = false AND city_place_id IS NOT NULL
            UNION ALL
            SELECT region_place_id FROM fountains
            WHERE is_hidden = false AND region_place_id IS NOT NULL
            UNION ALL
            SELECT country_place_id FROM fountains
            WHERE is_hidden = false AND country_place_id IS NOT NULL
        ) x
        GROUP BY place_id
    )
    UPDATE place_boundaries pb
    SET fountain_count = COALESCE(counts.n, 0)
    FROM place_boundaries pb2
    LEFT JOIN counts ON counts.place_id = pb2.id
    WHERE pb.id = pb2.id
      AND pb.fountain_count IS DISTINCT FROM COALESCE(counts.n, 0)
    """
)

_CANONICAL_RESET_SQL = text("UPDATE place_boundaries SET is_canonical = false WHERE is_canonical")
_CANONICAL_REGIONS_SQL = text(
    """
    WITH ranked AS (
        SELECT id, ROW_NUMBER() OVER (
            PARTITION BY country_code, slug
            ORDER BY ST_Area(boundary) DESC, overture_id ASC
        ) AS rn
        FROM place_boundaries
        WHERE place_kind = 'region'
    )
    UPDATE place_boundaries SET is_canonical = true
    WHERE id IN (SELECT id FROM ranked WHERE rn = 1)
    """
)
_CANONICAL_CITIES_SQL = text(
    f"""
    WITH eligible AS (
        SELECT pb.id, pb.country_code, pb.parent_id, pb.slug, pb.subtype, pb.fountain_count,
               pb.overture_id
        FROM place_boundaries pb
        WHERE pb.place_kind = 'city' AND pb.parent_id IS NOT NULL
    ),
    ranked AS (
        SELECT id, ROW_NUMBER() OVER (
            PARTITION BY country_code, parent_id, slug
            ORDER BY ({_priority_case("subtype")}) DESC, fountain_count DESC, overture_id ASC
        ) AS rn
        FROM eligible
    )
    UPDATE place_boundaries SET is_canonical = true
    WHERE id IN (SELECT id FROM ranked WHERE rn = 1)
    """
)

# Scoped canonical re-selection for the single-fountain / delete paths: re-pick the canonical only
# for the (country_code, slug) groups the affected places belong to (a count change can only flip
# the winner within a place's own group). Reset-then-set within the txn keeps the partial unique
# index satisfied. Only city-eligible places are ever canonical, so resetting a group's non-eligible
# members (e.g. a country polygon sharing a slug) is a harmless no-op. Runs AFTER the recount.
_RECANON_RESET_SQL = text(
    """
    UPDATE place_boundaries pb
    SET is_canonical = false
    FROM (
        SELECT DISTINCT country_code, parent_id, slug
        FROM place_boundaries
        WHERE id = ANY(:place_ids) AND place_kind = 'city' AND parent_id IS NOT NULL
    ) tg
    WHERE pb.country_code = tg.country_code
      AND pb.parent_id = tg.parent_id
      AND pb.slug = tg.slug
      AND pb.place_kind = 'city'
      AND pb.is_canonical
    """
)
_RECANON_SET_SQL = text(
    f"""
    WITH tg AS (
        SELECT DISTINCT country_code, parent_id, slug
        FROM place_boundaries
        WHERE id = ANY(:place_ids) AND place_kind = 'city' AND parent_id IS NOT NULL
    ),
    grp AS (
        SELECT pb.id, pb.country_code, pb.parent_id, pb.slug, pb.subtype, pb.fountain_count,
               pb.overture_id
        FROM place_boundaries pb
        JOIN tg ON tg.country_code = pb.country_code
               AND tg.parent_id = pb.parent_id
               AND tg.slug = pb.slug
        WHERE pb.place_kind = 'city'
    ),
    ranked AS (
        SELECT id, ROW_NUMBER() OVER (
            PARTITION BY country_code, parent_id, slug
            ORDER BY ({_priority_case("subtype")}) DESC, fountain_count DESC, overture_id ASC
        ) AS rn
        FROM grp
    )
    UPDATE place_boundaries SET is_canonical = true
    WHERE id IN (SELECT id FROM ranked WHERE rn = 1)
    """
)

_PARENT_RESET_SQL = text(
    "UPDATE place_boundaries SET parent_id = NULL WHERE place_kind IS DISTINCT FROM 'region'"
)
_REGION_PARENT_SQL = text(
    """
    UPDATE place_boundaries child
    SET parent_id = p.country_id
    FROM (
        SELECT c.id AS child_id, ctry.id AS country_id
        FROM place_boundaries c
        LEFT JOIN LATERAL (
            SELECT pb.id
            FROM place_boundaries pb
            WHERE pb.place_kind = 'country'
              AND pb.country_code = c.country_code
            ORDER BY pb.overture_id ASC
            LIMIT 1
        ) ctry ON TRUE
        WHERE c.place_kind = 'region'
    ) p
    WHERE child.id = p.child_id
      AND child.parent_id IS DISTINCT FROM p.country_id
    """
)

_CITY_PARENT_SQL = text(
    """
    UPDATE place_boundaries city
    SET parent_id = p.parent_id
    FROM (
        SELECT c.id AS city_id,
               CASE
                   WHEN COALESCE(cardinality(cfg.eligible_region_subtypes), 1) = 0
                       THEN country.id
                   ELSE region.id
               END AS parent_id
        FROM place_boundaries c
        LEFT JOIN place_scope_config cfg ON cfg.country_code = c.country_code
        LEFT JOIN LATERAL (
            SELECT pb.id
            FROM place_boundaries pb
            WHERE pb.place_kind = 'country'
              AND pb.country_code = c.country_code
            ORDER BY pb.overture_id ASC
            LIMIT 1
        ) country ON TRUE
        LEFT JOIN LATERAL (
            SELECT pb.id
            FROM place_boundary_cells cell
            JOIN place_boundaries pb ON pb.id = cell.place_id
            WHERE pb.place_kind = 'region'
              AND pb.is_canonical = true
              AND pb.country_code = c.country_code
              AND ST_Covers(cell.geom, ST_PointOnSurface(c.boundary::geometry))
            ORDER BY ST_Area(pb.boundary) ASC, pb.overture_id ASC
            LIMIT 1
        ) region ON TRUE
        WHERE c.place_kind = 'city'
    ) p
    WHERE city.id = p.city_id
      AND city.parent_id IS DISTINCT FROM p.parent_id
    """
)

_REMAP_CITY_SQL = text(
    """
    UPDATE fountains f
    SET city_place_id = remap.canonical_city_id
    FROM (
        SELECT f2.id AS fountain_id,
               CASE
                   WHEN city.parent_id IS NULL THEN NULL
                   ELSE canonical.id
               END AS canonical_city_id
        FROM fountains f2
        JOIN place_boundaries city ON city.id = f2.city_place_id
        LEFT JOIN place_boundaries canonical
          ON canonical.country_code = city.country_code
         AND canonical.parent_id = city.parent_id
         AND canonical.slug = city.slug
         AND canonical.place_kind = 'city'
         AND canonical.is_canonical = true
        WHERE (CAST(:fountain_id AS uuid) IS NULL OR f2.id = CAST(:fountain_id AS uuid))
    ) remap
    WHERE f.id = remap.fountain_id
      AND f.city_place_id IS DISTINCT FROM remap.canonical_city_id
    """
)

_REMAP_CITY_GROUPS_SQL = text(
    """
    WITH tg AS (
        SELECT DISTINCT country_code, parent_id, slug
        FROM place_boundaries
        WHERE id = ANY(:place_ids) AND place_kind = 'city' AND parent_id IS NOT NULL
    ),
    grp AS (
        SELECT pb.id, pb.country_code, pb.parent_id, pb.slug
        FROM place_boundaries pb
        JOIN tg ON tg.country_code = pb.country_code
               AND tg.parent_id = pb.parent_id
               AND tg.slug = pb.slug
        WHERE pb.place_kind = 'city'
    ),
    winner AS (
        SELECT g.country_code, g.parent_id, g.slug, pb.id AS canonical_city_id
        FROM grp g
        JOIN place_boundaries pb
          ON pb.country_code = g.country_code
         AND pb.parent_id = g.parent_id
         AND pb.slug = g.slug
         AND pb.place_kind = 'city'
         AND pb.is_canonical = true
        GROUP BY g.country_code, g.parent_id, g.slug, pb.id
    )
    UPDATE fountains f
    SET city_place_id = winner.canonical_city_id
    FROM grp
    JOIN winner ON winner.country_code = grp.country_code
               AND winner.parent_id = grp.parent_id
               AND winner.slug = grp.slug
    WHERE f.city_place_id = grp.id
      AND f.city_place_id IS DISTINCT FROM winner.canonical_city_id
    """
)

_RECOUNT_CITY_GROUPS_RAW_SQL = text(
    """
    WITH tg AS (
        SELECT DISTINCT country_code, parent_id, slug
        FROM place_boundaries
        WHERE id = ANY(:place_ids) AND place_kind = 'city' AND parent_id IS NOT NULL
    ),
    grp AS (
        SELECT pb.id
        FROM place_boundaries pb
        JOIN tg ON tg.country_code = pb.country_code
               AND tg.parent_id = pb.parent_id
               AND tg.slug = pb.slug
        WHERE pb.place_kind = 'city'
    )
    UPDATE place_boundaries pb
    SET fountain_count = (
        SELECT count(DISTINCT f.id)
        FROM fountains f
        JOIN place_boundary_cells cell ON cell.place_id = pb.id
        WHERE f.is_hidden = false
          AND ST_Covers(cell.geom, f.location::geometry)
    )
    WHERE pb.id IN (SELECT id FROM grp)
    """
)

_RECOUNT_CITY_GROUPS_SQL = text(
    """
    WITH tg AS (
        SELECT DISTINCT country_code, parent_id, slug
        FROM place_boundaries
        WHERE id = ANY(:place_ids) AND place_kind = 'city' AND parent_id IS NOT NULL
    ),
    grp AS (
        SELECT pb.id
        FROM place_boundaries pb
        JOIN tg ON tg.country_code = pb.country_code
               AND tg.parent_id = pb.parent_id
               AND tg.slug = pb.slug
        WHERE pb.place_kind = 'city'
    )
    UPDATE place_boundaries pb
    SET fountain_count = (
        SELECT count(*) FROM fountains f
        WHERE f.is_hidden = false AND f.city_place_id = pb.id
    )
    WHERE pb.id IN (SELECT id FROM grp)
    """
)

_SUMMARY_SQL = text(
    """
    SELECT
        (SELECT count(*) FROM fountains) AS fountains_total,
        (SELECT count(*) FROM fountains WHERE country_place_id IS NOT NULL) AS matched_country,
        (SELECT count(*) FROM fountains WHERE region_place_id IS NOT NULL) AS matched_region,
        (SELECT count(*) FROM fountains WHERE city_place_id IS NOT NULL) AS matched_city,
        (SELECT count(*) FROM fountains
           WHERE country_place_id IS NOT NULL AND city_place_id IS NULL) AS country_only,
        (SELECT count(*) FROM fountains WHERE country_place_id IS NULL) AS unmatched,
        (SELECT count(*) FROM place_boundaries WHERE is_canonical) AS canonical_places,
        (SELECT count(*) FROM place_boundaries WHERE place_kind = 'city' AND parent_id IS NULL)
            AS null_parent_cities,
        (SELECT count(*) FROM (
            SELECT country_code, slug FROM place_boundaries
            WHERE place_kind = 'region'
            GROUP BY country_code, slug HAVING count(*) > 1
        ) x) AS duplicate_region_slugs
    """
)


@dataclass
class MembershipRefreshSummary:
    fountains_total: int = 0
    matched_country: int = 0
    matched_region: int = 0
    matched_city: int = 0
    country_only: int = 0
    unmatched: int = 0
    canonical_places: int = 0
    null_parent_cities: int = 0
    duplicate_region_slugs: int = 0


async def rebuild_place_boundary_cells(session: AsyncSession) -> int:
    """Fully rebuild ``place_boundary_cells`` from ``place_boundaries`` (``ST_Subdivide`` every
    boundary into small GiST-indexed pieces) and return the resulting cell count.

    Cells are the point-in-polygon acceleration structure for membership assignment: probing a small
    cell via its GiST index is fast regardless of the source polygon's vertex count, where probing
    the whole 136k-vertex US country polygon per fountain was not (the country-scale backfill ran
    40+ min). Call this whenever ``place_boundaries`` changes (a boundary load) or on the one-time
    backfill; a plain OSM import / user add does NOT change boundaries and must NOT rebuild.

    Does NOT commit — the caller owns the transaction and MUST hold the ``ADD_FOUNTAIN_LOCK``
    advisory lock (``refresh_all_memberships`` takes it before calling this). The rebuild is a
    ``TRUNCATE`` + full re-``INSERT``; ``TRUNCATE`` is transactional in PostgreSQL, so a rolled-back
    refresh restores the prior cells.
    """
    await session.execute(_TRUNCATE_CELLS_SQL)
    await session.execute(_REBUILD_CELLS_SQL)
    await session.execute(_ANALYZE_CELLS_SQL)
    cells = (await session.execute(_COUNT_CELLS_SQL)).scalar_one()
    log.info("place_boundary_cells_rebuilt", extra={"cells": cells})
    return cells


async def recompute_place_counts(session: AsyncSession, place_ids) -> None:
    """Recompute ``fountain_count`` for the given places and re-select ``is_canonical`` for their
    ``(country_code, slug)`` group(s). The count-only path for the admin **delete** trigger, where
    the fountain row is gone so there is nothing to re-assign — but its old places' counts (and the
    canonical winner those counts tie-break) must still be corrected. Does NOT commit; the caller
    owns the txn and must hold the ``ADD_FOUNTAIN_LOCK`` advisory lock."""
    ids = [pid for pid in place_ids if pid is not None]
    if not ids:
        return
    await session.execute(_RECOUNT_PLACES_SQL, {"place_ids": ids})
    await session.execute(_RECOUNT_CITY_GROUPS_RAW_SQL, {"place_ids": ids})
    await session.execute(_RECANON_RESET_SQL, {"place_ids": ids})
    await session.execute(_RECANON_SET_SQL, {"place_ids": ids})
    await session.execute(_REMAP_CITY_GROUPS_SQL, {"place_ids": ids})
    await session.execute(_RECOUNT_CITY_GROUPS_SQL, {"place_ids": ids})
    log.info("membership_recounted", extra={"places": len(ids), "scope": "places"})


async def recompute_fountain_membership(session: AsyncSession, fountain_id) -> None:
    """Re-assign ONE fountain's country/city place, recompute the touched places' counts, and
    re-select ``is_canonical`` for their slug group(s).

    Does NOT commit — the caller owns the transaction and MUST hold the ``ADD_FOUNTAIN_LOCK``
    advisory lock (POST /fountains, OSM import, and the admin patch path all take it first), so the
    count + canonical recompute is race-safe. Safe to call before any boundaries are loaded (leaves
    both memberships NULL). Idempotent: re-running assigns the same places and recomputes the same
    counts.
    """
    old = (
        await session.execute(
            text(
                "SELECT country_place_id, region_place_id, city_place_id "
                "FROM fountains WHERE id = :fid"
            ),
            {"fid": fountain_id},
        )
    ).one_or_none()
    if old is None:  # fountain was deleted between flush and refresh — nothing to assign.
        return

    await session.execute(_ASSIGN_SQL, {"fountain_id": fountain_id})

    raw_new = (
        await session.execute(
            text(
                "SELECT country_place_id, region_place_id, city_place_id "
                "FROM fountains WHERE id = :fid"
            ),
            {"fid": fountain_id},
        )
    ).one()

    # Recompute counts + canonical for exactly the places whose raw membership set changed
    # (old ∪ raw_new). The recount must happen BEFORE remapping to canonical: otherwise a duplicate
    # city challenger can never accumulate enough count to overtake the old winner.
    affected = {
        pid
        for pid in (
            old.country_place_id,
            old.region_place_id,
            old.city_place_id,
            raw_new.country_place_id,
            raw_new.region_place_id,
            raw_new.city_place_id,
        )
        if pid is not None
    }
    await recompute_place_counts(session, affected)
    await session.execute(_REMAP_CITY_SQL, {"fountain_id": fountain_id})

    new = (
        await session.execute(
            text(
                "SELECT country_place_id, region_place_id, city_place_id "
                "FROM fountains WHERE id = :fid"
            ),
            {"fid": fountain_id},
        )
    ).one()

    # Null-parent cities remap to NULL outside the group remap path. Recount again if the fountain's
    # final canonical/null city differs from the raw assignment.
    if new.city_place_id != raw_new.city_place_id:
        affected.add(raw_new.city_place_id)
        affected.add(new.city_place_id)
        await recompute_place_counts(session, affected)

    log.info(
        "fountain_membership_recomputed",
        extra={
            "fountain_id": str(fountain_id),
            "country_place_id": str(new.country_place_id) if new.country_place_id else None,
            "region_place_id": str(new.region_place_id) if new.region_place_id else None,
            "city_place_id": str(new.city_place_id) if new.city_place_id else None,
        },
    )


async def _log_place_kind_summary(session: AsyncSession) -> None:
    row = (await session.execute(_PLACE_KIND_SUMMARY_SQL)).one()
    log.info(
        "place_kind_derived",
        extra={
            "countries": row.countries,
            "regions": row.regions,
            "cities": row.cities,
            "none": row.none,
        },
    )


async def _log_city_parent_summary(session: AsyncSession) -> None:
    row = (
        await session.execute(
            text(
                """
                SELECT
                    count(*) FILTER (WHERE place_kind = 'city' AND parent_id IS NOT NULL)
                        AS parented,
                    count(*) FILTER (WHERE place_kind = 'city' AND parent_id IS NULL)
                        AS null_parent
                FROM place_boundaries
                """
            )
        )
    ).one()
    level = logging.WARNING if row.null_parent else logging.INFO
    log.log(
        level,
        "city_parented",
        extra={"parented": row.parented, "null_parent": row.null_parent},
    )


async def _log_assignment_summary(session: AsyncSession) -> None:
    row = (await session.execute(_SUMMARY_SQL)).one()
    log.info(
        "fountain_assigned",
        extra={
            "fountains_total": row.fountains_total,
            "matched_country": row.matched_country,
            "matched_region": row.matched_region,
            "matched_city": row.matched_city,
            "country_only": row.country_only,
            "unmatched": row.unmatched,
        },
    )


async def _log_canonical_summary(session: AsyncSession, event: str) -> None:
    row = (
        await session.execute(
            text(
                """
                SELECT
                    count(*) FILTER (WHERE place_kind = 'region' AND is_canonical) AS regions,
                    count(*) FILTER (WHERE place_kind = 'city' AND is_canonical) AS cities,
                    (SELECT count(*) FROM (
                        SELECT country_code, slug FROM place_boundaries
                        WHERE place_kind = 'region'
                        GROUP BY country_code, slug HAVING count(*) > 1
                    ) x) AS duplicate_region_slugs
                FROM place_boundaries
                """
            )
        )
    ).one()
    level = logging.WARNING if row.duplicate_region_slugs else logging.INFO
    log.log(
        level,
        event,
        extra={
            "regions": row.regions,
            "cities": row.cities,
            "duplicate_region_slugs": row.duplicate_region_slugs,
        },
    )


async def refresh_all_memberships(
    session: AsyncSession, *, rebuild_cells: bool = True
) -> MembershipRefreshSummary:
    """Re-derive the whole membership state: assignment, counts, canonical, parent (spec §11.5).

    Ordered so each step sees the previous one's output: (rebuild point-in-polygon cells ->) derive
    place_kind -> parent regions to countries -> assign raw country/region/city membership -> select
    canonical regions -> parent cities -> recount -> select canonical cities -> remap city
    membership to canonical city rows -> recount again. Set-based; one transaction — the caller
    commits.
    Run on every boundary load and by the backfill CLI.

    ``rebuild_cells`` (default ``True``) controls whether ``place_boundary_cells`` is re-derived
    first. Rebuild when the boundaries themselves changed (boundary load) or for the one-time
    backfill (cells may be empty/stale). A plain OSM import / rollback does NOT change boundaries —
    only which fountains fall where — so those callers pass ``rebuild_cells=False`` to skip the
    ~200s subdivide and just re-assign against the already-current cells.

    Takes the ``ADD_FOUNTAIN_LOCK`` advisory lock so a whole-DB refresh (boundary load / backfill /
    rollback) is serialized with concurrent adds + imports — otherwise a refresh could recount from
    a snapshot missing an in-flight add and commit a stale ``fountain_count`` over it. The lock is
    re-entrant, so callers that already hold it (``merge``/``rollback``) are unaffected; the same
    lock also serializes the cell rebuild + PIP against those callers' cell reads.
    """
    await session.execute(select(func.pg_advisory_xact_lock(ADD_FOUNTAIN_LOCK_KEY)))
    if rebuild_cells:
        await rebuild_place_boundary_cells(session)
    await session.execute(_PLACE_KIND_SQL)
    await _log_place_kind_summary(session)
    await session.execute(_PARENT_RESET_SQL)
    await session.execute(_REGION_PARENT_SQL)
    log.info("region_parented")
    await session.execute(_ASSIGN_SQL, {"fountain_id": None})
    await _log_assignment_summary(session)
    await session.execute(_CANONICAL_RESET_SQL)
    await session.execute(_CANONICAL_REGIONS_SQL)
    await _log_canonical_summary(session, "region_canonical_selected")
    await session.execute(_CITY_PARENT_SQL)
    await _log_city_parent_summary(session)
    await session.execute(_RECOUNT_ALL_SQL)
    log.info("membership_recounted", extra={"scope": "all", "phase": "pre_city_canonical"})
    await session.execute(_CANONICAL_RESET_SQL)
    await session.execute(_CANONICAL_REGIONS_SQL)
    await session.execute(_CANONICAL_CITIES_SQL)
    await _log_canonical_summary(session, "city_canonical_selected")
    await session.execute(_REMAP_CITY_SQL, {"fountain_id": None})
    log.info("city_remapped", extra={"scope": "all"})
    await session.execute(_RECOUNT_ALL_SQL)
    log.info("membership_recounted", extra={"scope": "all", "phase": "post_city_remap"})

    row = (await session.execute(_SUMMARY_SQL)).one()
    summary = MembershipRefreshSummary(
        fountains_total=row.fountains_total,
        matched_country=row.matched_country,
        matched_region=row.matched_region,
        matched_city=row.matched_city,
        country_only=row.country_only,
        unmatched=row.unmatched,
        canonical_places=row.canonical_places,
        null_parent_cities=row.null_parent_cities,
        duplicate_region_slugs=row.duplicate_region_slugs,
    )
    level = (
        logging.WARNING
        if summary.null_parent_cities or summary.duplicate_region_slugs
        else logging.INFO
    )
    log.log(
        level,
        "membership_refresh_complete",
        extra={
            "fountains_total": summary.fountains_total,
            "matched_country": summary.matched_country,
            "matched_region": summary.matched_region,
            "matched_city": summary.matched_city,
            "country_only": summary.country_only,
            "unmatched": summary.unmatched,
            "canonical_places": summary.canonical_places,
            "null_parent_cities": summary.null_parent_cities,
            "duplicate_region_slugs": summary.duplicate_region_slugs,
        },
    )
    return summary
