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
- :func:`refresh_all_memberships` — the whole DB (boundary load + backfill). A thin composition of
  the staged :func:`compute_boundary_derivation` (the expensive boundary geometry, into temp tables,
  UNlocked) then :func:`publish_membership_state` (acquire the lock, apply the staged generation,
  re-assign every fountain, recompute ``fountain_count`` / ``is_canonical`` / ``parent_id``). One
  transaction (the caller commits); spec 2026-07-17 §2 stages compute so an interactive add never
  waits behind the geometry.

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

**Concurrency:** every live count/canonical write is serialized on the ``ADD_FOUNTAIN_LOCK``
advisory lock (shared with POST /fountains and the OSM import). :func:`publish_membership_state`
takes it (its CLI callers hold no other lock); :func:`compute_boundary_derivation` deliberately does
NOT (it writes only temp staging, takes no live-table lock). The single-fountain / count-only
helpers assume the caller already holds it — every request path that calls them (add, admin
patch/delete) takes it first, and the re-entrant lock in ``merge``/``rollback`` covers the import
path.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncEngine, AsyncSession

from app.locks import acquire_add_fountain_lock

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
_DELETE_COUNTRY_CELLS_SQL = text(
    """
    DELETE FROM place_boundary_cells cell
    USING place_boundaries pb
    WHERE pb.id = cell.place_id
      AND pb.country_code = :cc
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
_ASSIGN_CANDIDATE_SQL = text(
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
        JOIN membership_candidate_fountains cf ON cf.id = f2.id
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
_CANONICAL_RESET_COUNTRY_SQL = text(
    "UPDATE place_boundaries SET is_canonical = false WHERE country_code = :cc AND is_canonical"
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
_REMAP_CITY_CANDIDATE_SQL = text(
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
        JOIN membership_candidate_fountains cf ON cf.id = f2.id
        JOIN place_boundaries city ON city.id = f2.city_place_id
        LEFT JOIN place_boundaries canonical
          ON canonical.country_code = city.country_code
         AND canonical.parent_id = city.parent_id
         AND canonical.slug = city.slug
         AND canonical.place_kind = 'city'
         AND canonical.is_canonical = true
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

_CREATE_CANDIDATE_FOUNTAINS_TEMP_SQL = text(
    """
    CREATE TEMP TABLE IF NOT EXISTS membership_candidate_fountains (
        id uuid PRIMARY KEY
    ) ON COMMIT DROP
    """
)
_CREATE_AFFECTED_PLACES_TEMP_SQL = text(
    """
    CREATE TEMP TABLE IF NOT EXISTS membership_affected_places (
        id uuid PRIMARY KEY
    ) ON COMMIT DROP
    """
)
_CREATE_RAW_CITY_MEMBERSHIP_TEMP_SQL = text(
    """
    CREATE TEMP TABLE IF NOT EXISTS membership_raw_city_membership (
        fountain_id uuid PRIMARY KEY,
        city_place_id uuid NULL
    ) ON COMMIT DROP
    """
)
_CREATE_FINAL_CHANGED_PLACES_TEMP_SQL = text(
    """
    CREATE TEMP TABLE IF NOT EXISTS membership_final_changed_places (
        id uuid PRIMARY KEY
    ) ON COMMIT DROP
    """
)
_CLEAR_CANDIDATE_FOUNTAINS_TEMP_SQL = text("TRUNCATE membership_candidate_fountains")
_CLEAR_AFFECTED_PLACES_TEMP_SQL = text("TRUNCATE membership_affected_places")
_CLEAR_RAW_CITY_MEMBERSHIP_TEMP_SQL = text("TRUNCATE membership_raw_city_membership")
_CLEAR_FINAL_CHANGED_PLACES_TEMP_SQL = text("TRUNCATE membership_final_changed_places")
# Set-based union, NOT per-fountain `OR EXISTS` (spec 2026-07-17 candidate-capture design §1):
# the OR across two correlated EXISTS blocks forces the planner to walk ALL fountains with a
# spatial subplan each — O(world) with an unbounded worst case (Spain's capture ran 37+ hours in
# production). The union computes the same set from index-driven branches: the spatial branch
# drives from the country's cells into the fountain geometry GiST; the three assignment branches
# unnest `pb.id IN (country, region, city)` per column so each uses its btree (inner joins —
# NULL columns simply don't match). UNION dedupes (replacing SELECT DISTINCT); production plans:
# 85 s -> 14-41 s on the largest countries, and bounded by country size, not world size.
_CAPTURE_COUNTRY_CANDIDATES_SQL = text(
    """
    INSERT INTO membership_candidate_fountains (id)
    SELECT id FROM (
        SELECT f.id
        FROM place_boundaries pb
        JOIN place_boundary_cells cell ON cell.place_id = pb.id
        JOIN fountains f ON ST_Covers(cell.geom, f.location::geometry)
        WHERE pb.country_code = :cc
        UNION
        SELECT f.id
        FROM place_boundaries pb
        JOIN fountains f ON f.country_place_id = pb.id
        WHERE pb.country_code = :cc
        UNION
        SELECT f.id
        FROM place_boundaries pb
        JOIN fountains f ON f.region_place_id = pb.id
        WHERE pb.country_code = :cc
        UNION
        SELECT f.id
        FROM place_boundaries pb
        JOIN fountains f ON f.city_place_id = pb.id
        WHERE pb.country_code = :cc
    ) candidates
    ON CONFLICT DO NOTHING
    """
)
_ADD_CANDIDATE_PLACES_TO_AFFECTED_SQL = text(
    """
    INSERT INTO membership_affected_places (id)
    SELECT DISTINCT place_id
    FROM (
        SELECT f.country_place_id AS place_id
        FROM fountains f
        JOIN membership_candidate_fountains cf ON cf.id = f.id
        WHERE f.country_place_id IS NOT NULL
        UNION ALL
        SELECT f.region_place_id
        FROM fountains f
        JOIN membership_candidate_fountains cf ON cf.id = f.id
        WHERE f.region_place_id IS NOT NULL
        UNION ALL
        SELECT f.city_place_id
        FROM fountains f
        JOIN membership_candidate_fountains cf ON cf.id = f.id
        WHERE f.city_place_id IS NOT NULL
    ) places
    ON CONFLICT DO NOTHING
    """
)
_ADD_COUNTRY_PLACES_TO_AFFECTED_SQL = text(
    """
    INSERT INTO membership_affected_places (id)
    SELECT id
    FROM place_boundaries
    WHERE country_code = :cc
    ON CONFLICT DO NOTHING
    """
)
_CAPTURE_RAW_CITY_MEMBERSHIP_SQL = text(
    """
    INSERT INTO membership_raw_city_membership (fountain_id, city_place_id)
    SELECT f.id, f.city_place_id
    FROM fountains f
    JOIN membership_candidate_fountains cf ON cf.id = f.id
    ON CONFLICT (fountain_id) DO UPDATE SET city_place_id = EXCLUDED.city_place_id
    """
)
_CAPTURE_FINAL_CHANGED_PLACES_SQL = text(
    """
    INSERT INTO membership_final_changed_places (id)
    SELECT DISTINCT place_id
    FROM (
        SELECT raw.city_place_id AS place_id
        FROM membership_raw_city_membership raw
        JOIN fountains f ON f.id = raw.fountain_id
        WHERE raw.city_place_id IS DISTINCT FROM f.city_place_id
          AND raw.city_place_id IS NOT NULL
        UNION ALL
        SELECT f.city_place_id
        FROM membership_raw_city_membership raw
        JOIN fountains f ON f.id = raw.fountain_id
        WHERE raw.city_place_id IS DISTINCT FROM f.city_place_id
          AND f.city_place_id IS NOT NULL
    ) places
    ON CONFLICT DO NOTHING
    """
)
_ADD_FINAL_CHANGED_PLACES_TO_AFFECTED_SQL = text(
    """
    INSERT INTO membership_affected_places (id)
    SELECT id
    FROM membership_final_changed_places
    ON CONFLICT DO NOTHING
    """
)
_SELECT_AFFECTED_PLACE_IDS_SQL = text("SELECT id FROM membership_affected_places ORDER BY id")
_SELECT_FINAL_CHANGED_PLACE_IDS_SQL = text(
    "SELECT id FROM membership_final_changed_places ORDER BY id"
)
_COUNT_COUNTRY_CANDIDATES_SQL = text("SELECT count(*) FROM membership_candidate_fountains")
_COUNT_AFFECTED_PLACES_SQL = text("SELECT count(*) FROM membership_affected_places")
# --- Staged (generation-closed) boundary derivation (spec 2026-07-17 §2) ----------------------
# compute_boundary_derivation writes the new generation into these connection-scoped TEMP tables
# WITHOUT taking the advisory lock or touching any live table, so the dominant city-parenting
# geometry runs BEFORE the lock. publish_membership_state then applies them atomically under the
# lock. The tables are NOT ``ON COMMIT DROP`` (they must survive the compute-commit in the CLI's
# two-transaction layout on one pinned connection); compute starts with an unconditional DROP +
# CREATE so stale staging can never leak between runs on a reused pooled connection.
#
# _staged_boundary_derivation: one row per in-scope boundary carrying the NEW place_kind / parent_id
#   / region is_canonical (city canonical stays count-dependent → the publish fountain tail).
# _staged_place_boundary_cells: the new subdivided cells + the live table's GiST/place_id index +
#   ANALYZE performance contract, so staged city parenting probes the index (not a seq scan).
_DROP_STAGED_DERIVATION_SQL = text("DROP TABLE IF EXISTS _staged_boundary_derivation")
_CREATE_STAGED_DERIVATION_SQL = text(
    """
    CREATE TEMP TABLE _staged_boundary_derivation (
        place_id uuid PRIMARY KEY,
        place_kind text,
        parent_id uuid,
        is_canonical boolean NOT NULL DEFAULT false
    )
    """
)
_DROP_STAGED_CELLS_SQL = text("DROP TABLE IF EXISTS _staged_place_boundary_cells")
_CREATE_STAGED_CELLS_SQL = text(
    """
    CREATE TEMP TABLE _staged_place_boundary_cells (
        id uuid,
        place_id uuid,
        geom geometry
    )
    """
)
_CREATE_STAGED_CELLS_GEOM_IDX_SQL = text(
    "CREATE INDEX ON _staged_place_boundary_cells USING GIST (geom)"
)
_CREATE_STAGED_CELLS_PLACE_IDX_SQL = text("CREATE INDEX ON _staged_place_boundary_cells (place_id)")
_ANALYZE_STAGED_CELLS_SQL = text("ANALYZE _staged_place_boundary_cells")


def _place_kind_case(subtype_col: str) -> str:
    """The place_kind derivation CASE (subtype + per-country scope config), reused by the live and
    staged place-kind statements. Values are fixed internal identifiers, never user input."""
    return f"""CASE
        WHEN {subtype_col} = 'country' THEN 'country'
        WHEN {subtype_col} = ANY(
            COALESCE(cfg.eligible_region_subtypes, {_DEFAULT_REGION_ELIGIBLE_SQL})
        )
            THEN 'region'
        WHEN {subtype_col} = ANY(COALESCE(cfg.eligible_city_subtypes, {_DEFAULT_ELIGIBLE_SQL}))
            THEN 'city'
        ELSE NULL
    END"""


# Stage place_kind for every in-scope boundary from the LIVE identity columns (subtype + config —
# which do not change during a refresh); never reads the live place_kind (generation-closed).
_STAGED_PLACE_KIND_SQL = text(
    f"""
    INSERT INTO _staged_boundary_derivation (place_id, place_kind)
    SELECT pb.id, {_place_kind_case("pb.subtype")}
    FROM place_boundaries pb
    LEFT JOIN place_scope_config cfg ON cfg.country_code = pb.country_code
    """
)
_STAGED_PLACE_KIND_COUNTRY_SQL = text(
    f"""
    INSERT INTO _staged_boundary_derivation (place_id, place_kind)
    SELECT pb.id, {_place_kind_case("pb.subtype")}
    FROM place_boundaries pb
    LEFT JOIN place_scope_config cfg ON cfg.country_code = pb.country_code
    WHERE pb.country_code = :cc
    """
)

# Stage the canonical-region winners with the EXACT live ordering (partition (country_code, slug),
# ST_Area(boundary) DESC, overture_id ASC) but reading the staged place_kind — publish sets the live
# region flags to precisely these winners, so the staged city parents match the published winners.
_STAGED_CANONICAL_REGIONS_SQL = text(
    """
    WITH ranked AS (
        SELECT sbd.place_id, ROW_NUMBER() OVER (
            PARTITION BY pb.country_code, pb.slug
            ORDER BY ST_Area(pb.boundary) DESC, pb.overture_id ASC
        ) AS rn
        FROM _staged_boundary_derivation sbd
        JOIN place_boundaries pb ON pb.id = sbd.place_id
        WHERE sbd.place_kind = 'region'
    )
    UPDATE _staged_boundary_derivation sbd
    SET is_canonical = true
    FROM ranked
    WHERE sbd.place_id = ranked.place_id AND ranked.rn = 1
    """
)
_STAGED_CANONICAL_REGIONS_COUNTRY_SQL = text(
    """
    WITH ranked AS (
        SELECT sbd.place_id, ROW_NUMBER() OVER (
            PARTITION BY pb.country_code, pb.slug
            ORDER BY ST_Area(pb.boundary) DESC, pb.overture_id ASC
        ) AS rn
        FROM _staged_boundary_derivation sbd
        JOIN place_boundaries pb ON pb.id = sbd.place_id
        WHERE sbd.place_kind = 'region'
          AND pb.country_code = :cc
    )
    UPDATE _staged_boundary_derivation sbd
    SET is_canonical = true
    FROM ranked
    WHERE sbd.place_id = ranked.place_id AND ranked.rn = 1
    """
)

# Stage region -> country parents (matched by country_code); country is identified by STAGED
# place_kind = 'country'.
_STAGED_REGION_PARENT_SQL = text(
    """
    UPDATE _staged_boundary_derivation child
    SET parent_id = p.country_id
    FROM (
        SELECT sbd.place_id AS child_id, ctry.id AS country_id
        FROM _staged_boundary_derivation sbd
        JOIN place_boundaries c ON c.id = sbd.place_id
        LEFT JOIN LATERAL (
            SELECT pb.id
            FROM place_boundaries pb
            JOIN _staged_boundary_derivation s2 ON s2.place_id = pb.id
            WHERE s2.place_kind = 'country'
              AND pb.country_code = c.country_code
            ORDER BY pb.overture_id ASC
            LIMIT 1
        ) ctry ON TRUE
        WHERE sbd.place_kind = 'region'
    ) p
    WHERE child.place_id = p.child_id
    """
)
_STAGED_REGION_PARENT_COUNTRY_SQL = text(
    """
    UPDATE _staged_boundary_derivation child
    SET parent_id = p.country_id
    FROM (
        SELECT sbd.place_id AS child_id, ctry.id AS country_id
        FROM _staged_boundary_derivation sbd
        JOIN place_boundaries c ON c.id = sbd.place_id
        LEFT JOIN LATERAL (
            SELECT pb.id
            FROM place_boundaries pb
            JOIN _staged_boundary_derivation s2 ON s2.place_id = pb.id
            WHERE s2.place_kind = 'country'
              AND pb.country_code = c.country_code
            ORDER BY pb.overture_id ASC
            LIMIT 1
        ) ctry ON TRUE
        WHERE sbd.place_kind = 'region'
          AND c.country_code = :cc
    ) p
    WHERE child.place_id = p.child_id
    """
)

# Stage the subdivided cells (mirrors the live rebuild; publish copies them into the live table).
_STAGED_CELLS_INSERT_SQL = text(
    """
    INSERT INTO _staged_place_boundary_cells (id, place_id, geom)
    SELECT gen_random_uuid(), pb.id, sub.geom
    FROM place_boundaries pb
    CROSS JOIN LATERAL ST_Subdivide(pb.boundary::geometry, 128) AS sub(geom)
    """
)
_STAGED_CELLS_INSERT_COUNTRY_SQL = text(
    """
    INSERT INTO _staged_place_boundary_cells (id, place_id, geom)
    SELECT gen_random_uuid(), pb.id, sub.geom
    FROM place_boundaries pb
    CROSS JOIN LATERAL ST_Subdivide(pb.boundary::geometry, 128) AS sub(geom)
    WHERE pb.country_code = :cc
    """
)


def _staged_city_parent_sql(cell_table: str, *, scoped: bool):
    """Stage each city's parent = the smallest STAGED-canonical region covering the city's
    representative point (else the country when the scope has no region tier). Reads the staged
    cells (or, when boundaries did not change and cells were not re-staged, the live cells) via the
    constant-vs-indexed ``ST_Covers(cell.geom, cp.pt)`` GiST probe, and the staged place_kind /
    canonical relation. ``cell_table`` is one of two internal constants — never user input."""
    where_city = "AND c.country_code = :cc" if scoped else ""
    return text(
        f"""
        WITH city_pt AS MATERIALIZED (
            SELECT c.id, c.country_code, ST_PointOnSurface(c.boundary::geometry) AS pt
            FROM place_boundaries c
            JOIN _staged_boundary_derivation sbd ON sbd.place_id = c.id
            WHERE sbd.place_kind = 'city'
              {where_city}
        )
        UPDATE _staged_boundary_derivation city
        SET parent_id = p.parent_id
        FROM (
            SELECT cp.id AS city_id,
                   CASE
                       WHEN COALESCE(cardinality(cfg.eligible_region_subtypes), 1) = 0
                           THEN country.id
                       ELSE region.id
                   END AS parent_id
            FROM city_pt cp
            LEFT JOIN place_scope_config cfg ON cfg.country_code = cp.country_code
            LEFT JOIN LATERAL (
                SELECT pb.id
                FROM place_boundaries pb
                JOIN _staged_boundary_derivation s2 ON s2.place_id = pb.id
                WHERE s2.place_kind = 'country'
                  AND pb.country_code = cp.country_code
                ORDER BY pb.overture_id ASC
                LIMIT 1
            ) country ON TRUE
            LEFT JOIN LATERAL (
                SELECT pb.id
                FROM {cell_table} cell
                JOIN place_boundaries pb ON pb.id = cell.place_id
                JOIN _staged_boundary_derivation s3 ON s3.place_id = pb.id
                WHERE s3.place_kind = 'region'
                  AND s3.is_canonical = true
                  AND pb.country_code = cp.country_code
                  AND ST_Covers(cell.geom, cp.pt)
                ORDER BY ST_Area(pb.boundary) ASC, pb.overture_id ASC
                LIMIT 1
            ) region ON TRUE
        ) p
        WHERE city.place_id = p.city_id
        """
    )


_STAGED_CITY_PARENT_SQL = _staged_city_parent_sql("_staged_place_boundary_cells", scoped=False)
_STAGED_CITY_PARENT_LIVE_CELLS_SQL = _staged_city_parent_sql("place_boundary_cells", scoped=False)
_STAGED_CITY_PARENT_COUNTRY_SQL = _staged_city_parent_sql(
    "_staged_place_boundary_cells", scoped=True
)

# --- Publish: apply the staged generation to the live tables (under the advisory lock) ---------
# Copy the staged cells into the freshly-cleared live table (scope-bounded); the staged table holds
# exactly the scope's cells, so no WHERE is needed on the SELECT.
_PUBLISH_CELLS_INSERT_SQL = text(
    """
    INSERT INTO place_boundary_cells (id, place_id, geom)
    SELECT id, place_id, geom FROM _staged_place_boundary_cells
    """
)
# Apply staged place_kind + parent_id to the live boundaries (IS DISTINCT FROM skips no-op writes).
_APPLY_STAGED_DERIVATION_SQL = text(
    """
    UPDATE place_boundaries pb
    SET place_kind = sbd.place_kind, parent_id = sbd.parent_id
    FROM _staged_boundary_derivation sbd
    WHERE pb.id = sbd.place_id
      AND (pb.place_kind IS DISTINCT FROM sbd.place_kind
           OR pb.parent_id IS DISTINCT FROM sbd.parent_id)
    """
)
_APPLY_STAGED_DERIVATION_COUNTRY_SQL = text(
    """
    UPDATE place_boundaries pb
    SET place_kind = sbd.place_kind, parent_id = sbd.parent_id
    FROM _staged_boundary_derivation sbd
    WHERE pb.id = sbd.place_id
      AND pb.country_code = :cc
      AND (pb.place_kind IS DISTINCT FROM sbd.place_kind
           OR pb.parent_id IS DISTINCT FROM sbd.parent_id)
    """
)
# Set the live REGION canonical flags to exactly the staged winners (reset-first publish order has
# already cleared the old flags, so this is collision-free on uq_place_boundaries_region_canonical).
_PUBLISH_REGION_CANONICAL_SQL = text(
    """
    UPDATE place_boundaries pb
    SET is_canonical = true
    FROM _staged_boundary_derivation sbd
    WHERE pb.id = sbd.place_id
      AND sbd.is_canonical = true
      AND sbd.place_kind = 'region'
    """
)
_PUBLISH_REGION_CANONICAL_COUNTRY_SQL = text(
    """
    UPDATE place_boundaries pb
    SET is_canonical = true
    FROM _staged_boundary_derivation sbd
    WHERE pb.id = sbd.place_id
      AND pb.country_code = :cc
      AND sbd.is_canonical = true
      AND sbd.place_kind = 'region'
    """
)

# Staged-table summaries for the compute phase (report the NEW generation being computed — the live
# tables are still the previous generation until publish).
_STAGED_PLACE_KIND_SUMMARY_SQL = text(
    """
    SELECT
        count(*) FILTER (WHERE place_kind = 'country') AS countries,
        count(*) FILTER (WHERE place_kind = 'region') AS regions,
        count(*) FILTER (WHERE place_kind = 'city') AS cities,
        count(*) FILTER (WHERE place_kind IS NULL) AS none
    FROM _staged_boundary_derivation
    """
)
_STAGED_REGION_CANONICAL_SUMMARY_SQL = text(
    """
    SELECT
        count(*) FILTER (WHERE place_kind = 'region' AND is_canonical) AS regions,
        (SELECT count(*) FROM (
            SELECT pb.country_code, pb.slug
            FROM _staged_boundary_derivation sbd
            JOIN place_boundaries pb ON pb.id = sbd.place_id
            WHERE sbd.place_kind = 'region'
            GROUP BY pb.country_code, pb.slug HAVING count(*) > 1
        ) x) AS duplicate_region_slugs
    FROM _staged_boundary_derivation
    """
)
_STAGED_CITY_PARENT_SUMMARY_SQL = text(
    """
    SELECT
        count(*) FILTER (WHERE place_kind = 'city' AND parent_id IS NOT NULL) AS parented,
        count(*) FILTER (WHERE place_kind = 'city' AND parent_id IS NULL) AS null_parent
    FROM _staged_boundary_derivation
    """
)


@dataclass(frozen=True)
class RefreshScope:
    """Which boundaries a membership refresh covers + whether it re-derives the point-in-polygon
    cells. ``country_code=None`` is the whole DB; a code scopes every phase to that country (which
    always re-stages its own cells). ``rebuild_cells`` governs the full-scope cell stage/replace:
    ``True`` for a boundary load / backfill (boundaries changed), ``False`` for an OSM merge /
    rollback (only fountains changed — the live cells are already current)."""

    country_code: str | None = None
    rebuild_cells: bool = True

    @property
    def cc(self) -> str | None:
        return self.country_code.lower() if self.country_code is not None else None

    @property
    def scoped(self) -> bool:
        return self.country_code is not None

    @property
    def stage_cells(self) -> bool:
        # Country scope always re-stages its cells; full scope only when boundaries changed.
        return self.scoped or self.rebuild_cells


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


async def _prepare_scoped_refresh_temp_tables(session: AsyncSession) -> None:
    await session.execute(_CREATE_CANDIDATE_FOUNTAINS_TEMP_SQL)
    await session.execute(_CREATE_AFFECTED_PLACES_TEMP_SQL)
    await session.execute(_CREATE_RAW_CITY_MEMBERSHIP_TEMP_SQL)
    await session.execute(_CREATE_FINAL_CHANGED_PLACES_TEMP_SQL)
    await session.execute(_CLEAR_CANDIDATE_FOUNTAINS_TEMP_SQL)
    await session.execute(_CLEAR_AFFECTED_PLACES_TEMP_SQL)
    await session.execute(_CLEAR_RAW_CITY_MEMBERSHIP_TEMP_SQL)
    await session.execute(_CLEAR_FINAL_CHANGED_PLACES_TEMP_SQL)


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


async def _log_assignment_summary(session: AsyncSession, extra: dict | None = None) -> None:
    row = (await session.execute(_SUMMARY_SQL)).one()
    log.info(
        "fountain_assigned",
        extra={
            **(extra or {}),
            "fountains_total": row.fountains_total,
            "matched_country": row.matched_country,
            "matched_region": row.matched_region,
            "matched_city": row.matched_city,
            "country_only": row.country_only,
            "unmatched": row.unmatched,
        },
    )


async def _log_canonical_summary(
    session: AsyncSession, event: str, extra: dict | None = None
) -> None:
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
            **(extra or {}),
            "regions": row.regions,
            "cities": row.cities,
            "duplicate_region_slugs": row.duplicate_region_slugs,
        },
    )


async def _log_staged_place_kind_summary(session: AsyncSession, extra: dict | None = None) -> None:
    row = (await session.execute(_STAGED_PLACE_KIND_SUMMARY_SQL)).one()
    log.info(
        "place_kind_derived",
        extra={
            **(extra or {}),
            "countries": row.countries,
            "regions": row.regions,
            "cities": row.cities,
            "none": row.none,
        },
    )


async def _log_staged_region_canonical_summary(
    session: AsyncSession, extra: dict | None = None
) -> None:
    row = (await session.execute(_STAGED_REGION_CANONICAL_SUMMARY_SQL)).one()
    level = logging.WARNING if row.duplicate_region_slugs else logging.INFO
    log.log(
        level,
        "region_canonical_selected",
        extra={
            **(extra or {}),
            "regions": row.regions,
            # city canonical is count-dependent → selected in the publish fountain tail
            "cities": 0,
            "duplicate_region_slugs": row.duplicate_region_slugs,
        },
    )


async def _log_staged_city_parent_summary(session: AsyncSession, extra: dict | None = None) -> None:
    row = (await session.execute(_STAGED_CITY_PARENT_SUMMARY_SQL)).one()
    level = logging.WARNING if row.null_parent else logging.INFO
    log.log(
        level,
        "city_parented",
        extra={**(extra or {}), "parented": row.parented, "null_parent": row.null_parent},
    )


async def compute_boundary_derivation(session: AsyncSession, scope: RefreshScope) -> None:
    """Stage the new boundary derivation into connection-scoped TEMP tables, taking NO advisory lock
    and mutating NOTHING live (spec 2026-07-17 §2). The expensive geometry — the ``ST_Subdivide``
    cells and the dominant city-parenting probe — runs here, BEFORE the lock, so an interactive add
    is never blocked by it.

    Generation-closed dataflow (never reads the live ``place_kind`` / ``is_canonical``, which stay
    previous-generation throughout): staged ``place_kind`` -> staged canonical-region winners ->
    staged region parents -> (stage cells + GiST/place_id index + ANALYZE) -> staged city parents,
    reading the staged cells and the staged canonical relation. City canonical stays count-dependent
    and is selected by :func:`publish_membership_state`'s fountain tail.

    The caller owns the transaction; it need NOT hold the advisory lock (compute takes no live-table
    locks). When ``scope.rebuild_cells`` is False (an OSM merge / rollback — boundaries unchanged),
    cells are not re-staged and staged city parenting reads the already-current live cells.
    """
    cc = scope.cc
    log_extra = {"country": cc, "scope": "country"} if scope.scoped else None
    # Unconditional drop+create: stale staging can never leak on a reused pooled connection, and the
    # tables are NOT ON COMMIT DROP so they survive the compute-commit in the CLI two-transaction
    # layout (they drop with the connection).
    await session.execute(_DROP_STAGED_DERIVATION_SQL)
    await session.execute(_CREATE_STAGED_DERIVATION_SQL)
    await session.execute(_DROP_STAGED_CELLS_SQL)
    await session.execute(_CREATE_STAGED_CELLS_SQL)

    if scope.scoped:
        await session.execute(_STAGED_PLACE_KIND_COUNTRY_SQL, {"cc": cc})
    else:
        await session.execute(_STAGED_PLACE_KIND_SQL)
    await _log_staged_place_kind_summary(session, log_extra)

    if scope.scoped:
        await session.execute(_STAGED_CANONICAL_REGIONS_COUNTRY_SQL, {"cc": cc})
    else:
        await session.execute(_STAGED_CANONICAL_REGIONS_SQL)
    await _log_staged_region_canonical_summary(session, log_extra)

    if scope.scoped:
        await session.execute(_STAGED_REGION_PARENT_COUNTRY_SQL, {"cc": cc})
    else:
        await session.execute(_STAGED_REGION_PARENT_SQL)
    log.info("region_parented", extra=log_extra)

    if scope.stage_cells:
        if scope.scoped:
            await session.execute(_STAGED_CELLS_INSERT_COUNTRY_SQL, {"cc": cc})
        else:
            await session.execute(_STAGED_CELLS_INSERT_SQL)
        # Same GiST + place_id index + ANALYZE contract as the live table, so staged city parenting
        # probes the index rather than seq-scanning (the #239-class failure).
        await session.execute(_CREATE_STAGED_CELLS_GEOM_IDX_SQL)
        await session.execute(_CREATE_STAGED_CELLS_PLACE_IDX_SQL)
        await session.execute(_ANALYZE_STAGED_CELLS_SQL)

    if scope.scoped:
        await session.execute(_STAGED_CITY_PARENT_COUNTRY_SQL, {"cc": cc})
    elif scope.stage_cells:
        await session.execute(_STAGED_CITY_PARENT_SQL)
    else:
        await session.execute(_STAGED_CITY_PARENT_LIVE_CELLS_SQL)
    await _log_staged_city_parent_summary(session, log_extra)


async def publish_membership_state(
    session: AsyncSession, scope: RefreshScope
) -> MembershipRefreshSummary:
    """Acquire the advisory lock and atomically apply the staged generation to the live tables, then
    run the fountain-dependent tail (spec 2026-07-17 §2). One transaction; the caller commits.

    Reset-first publish order (the partial unique indexes are enforced per-statement, not at
    commit): (1) reset the live canonical flags while rows still carry their old hierarchy;
    (2) replace the live cells from staging (when boundaries changed) and apply the staged
    place_kind / parent_id; (3) set the live REGION canonical flags to exactly the staged winners;
    (4) the existing fountain-dependent tail (assign, recount, count-dependent CITY canonical,
    remap, recount).

    On any exception the caller rolls back and the previous generation is intact (the staged writes
    were temp-only; the live apply is atomic in this transaction). Returns the summary and emits
    ``membership_refresh_complete``.
    """
    cc = scope.cc
    ctx = (
        f"publish_membership_state:country:{cc}" if scope.scoped else "publish_membership_state:all"
    )
    scope_extra = {"scope": "country" if scope.scoped else "all", "country": cc}
    # Stage-boundary markers bracketing the advisory acquisition: the add-blocking publish window
    # opens once the lock is granted (spec 2026-07-17 §2 observability). Safe summary fields only.
    log.info("publish_waiting", extra=scope_extra)
    await acquire_add_fountain_lock(session, context=ctx)
    log.info("publish_started", extra=scope_extra)

    # (1) reset canonical on the OLD hierarchy.
    if scope.scoped:
        await session.execute(_CANONICAL_RESET_COUNTRY_SQL, {"cc": cc})
    else:
        await session.execute(_CANONICAL_RESET_SQL)

    # (2) replace the live cells from staging (only when boundaries changed) + apply staged
    # place_kind / parent to the live boundaries.
    if scope.stage_cells:
        if scope.scoped:
            await session.execute(_DELETE_COUNTRY_CELLS_SQL, {"cc": cc})
        else:
            await session.execute(_TRUNCATE_CELLS_SQL)
        await session.execute(_PUBLISH_CELLS_INSERT_SQL)
        await session.execute(_ANALYZE_CELLS_SQL)
    if scope.scoped:
        await session.execute(_APPLY_STAGED_DERIVATION_COUNTRY_SQL, {"cc": cc})
    else:
        await session.execute(_APPLY_STAGED_DERIVATION_SQL)

    # (3) set the live REGION canonical flags to exactly the staged winners.
    if scope.scoped:
        await session.execute(_PUBLISH_REGION_CANONICAL_COUNTRY_SQL, {"cc": cc})
    else:
        await session.execute(_PUBLISH_REGION_CANONICAL_SQL)

    # (4) the existing fountain-dependent tail per scope.
    if scope.scoped:
        return await _publish_country_tail(session, cc)
    return await _publish_full_tail(session)


async def _publish_full_tail(session: AsyncSession) -> MembershipRefreshSummary:
    await session.execute(_ASSIGN_SQL, {"fountain_id": None})
    await _log_assignment_summary(session)
    await session.execute(_RECOUNT_ALL_SQL)
    log.info("membership_recounted", extra={"scope": "all", "phase": "pre_city_canonical"})
    # Region canonical is already set from staging (publish step 3); select only the count-dependent
    # CITY winners. Cities are all-false after the reset-first step, so no reset is needed here.
    await session.execute(_CANONICAL_CITIES_SQL)
    await _log_canonical_summary(session, "city_canonical_selected")
    await session.execute(_REMAP_CITY_SQL, {"fountain_id": None})
    log.info("city_remapped", extra={"scope": "all"})
    await session.execute(_RECOUNT_ALL_SQL)
    log.info("membership_recounted", extra={"scope": "all", "phase": "post_city_remap"})

    summary = await _build_summary(session)
    _log_refresh_complete(summary)
    return summary


async def _publish_country_tail(session: AsyncSession, cc: str) -> MembershipRefreshSummary:
    log_extra = {"country": cc, "scope": "country"}
    await _prepare_scoped_refresh_temp_tables(session)
    await session.execute(_CAPTURE_COUNTRY_CANDIDATES_SQL, {"cc": cc})
    candidate_count = (await session.execute(_COUNT_COUNTRY_CANDIDATES_SQL)).scalar_one()
    await session.execute(_ADD_CANDIDATE_PLACES_TO_AFFECTED_SQL)
    await session.execute(_ASSIGN_CANDIDATE_SQL)
    await session.execute(_CAPTURE_RAW_CITY_MEMBERSHIP_SQL)
    await session.execute(_ADD_CANDIDATE_PLACES_TO_AFFECTED_SQL)
    await session.execute(_ADD_COUNTRY_PLACES_TO_AFFECTED_SQL, {"cc": cc})
    await _log_assignment_summary(session, log_extra)

    affected_ids = [row.id for row in (await session.execute(_SELECT_AFFECTED_PLACE_IDS_SQL)).all()]
    await recompute_place_counts(session, affected_ids)

    await session.execute(_REMAP_CITY_CANDIDATE_SQL)
    await session.execute(_CAPTURE_FINAL_CHANGED_PLACES_SQL)
    final_changed_ids = [
        row.id for row in (await session.execute(_SELECT_FINAL_CHANGED_PLACE_IDS_SQL)).all()
    ]
    if final_changed_ids:
        await session.execute(_ADD_FINAL_CHANGED_PLACES_TO_AFFECTED_SQL)
        affected_ids = [
            row.id for row in (await session.execute(_SELECT_AFFECTED_PLACE_IDS_SQL)).all()
        ]
        await recompute_place_counts(session, affected_ids)
    affected_count = (await session.execute(_COUNT_AFFECTED_PLACES_SQL)).scalar_one()
    log.info(
        "city_remapped",
        extra={
            "country": cc,
            "scope": "country",
            "candidate_fountains": candidate_count,
            "affected_places": affected_count,
            "final_changed_places": len(final_changed_ids),
        },
    )

    summary = await _build_summary(session)
    _log_refresh_complete(
        summary,
        extra={
            "country": cc,
            "scope": "country",
            "candidate_fountains": candidate_count,
            "affected_places": affected_count,
        },
    )
    return summary


async def _build_summary(session: AsyncSession) -> MembershipRefreshSummary:
    row = (await session.execute(_SUMMARY_SQL)).one()
    return MembershipRefreshSummary(
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


def _log_refresh_complete(summary: MembershipRefreshSummary, extra: dict | None = None) -> None:
    level = (
        logging.WARNING
        if summary.null_parent_cities or summary.duplicate_region_slugs
        else logging.INFO
    )
    log.log(
        level,
        "membership_refresh_complete",
        extra={
            **(extra or {}),
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


async def refresh_country_memberships(
    session: AsyncSession, country_code: str
) -> MembershipRefreshSummary:
    """Re-derive membership after loading one country's boundaries (thin composition).

    Runs :func:`compute_boundary_derivation` (staged) then :func:`publish_membership_state` (which
    acquires the advisory lock) back-to-back in the caller's single transaction — the merge-path
    all-or-nothing layout. On the merge path the caller already holds the lock before compute, so no
    add can wait on live-table locks mid-merge; publish's acquire is then a re-entrant no-op.
    """
    scope = RefreshScope(country_code=country_code)
    await compute_boundary_derivation(session, scope)
    return await publish_membership_state(session, scope)


async def refresh_all_memberships(
    session: AsyncSession, *, rebuild_cells: bool = True
) -> MembershipRefreshSummary:
    """Re-derive the whole membership state: assignment, counts, canonical, parent (spec §11.5).

    Thin composition of :func:`compute_boundary_derivation` (staged boundary phases: stage cells,
    derive ``place_kind``, canonical regions, region + city parents into temp tables) then
    :func:`publish_membership_state` (acquire the lock, apply the staged generation, then assign,
    recount, select canonical cities, remap, recount) — back-to-back in one transaction; the caller
    commits. Run on every boundary load and by the backfill CLI.

    ``rebuild_cells`` (default ``True``) controls whether ``place_boundary_cells`` is re-derived.
    Rebuild when the boundaries themselves changed (boundary load) or for the one-time backfill
    (cells may be empty/stale). A plain OSM import / rollback does NOT change boundaries — only
    which fountains fall where — so those callers pass ``rebuild_cells=False`` to skip the ~200s
    subdivide and re-derive against the already-current cells.

    :func:`publish_membership_state` acquires the ``ADD_FOUNTAIN_LOCK`` advisory lock so the apply +
    fountain recompute is serialized with concurrent adds + imports. The lock is re-entrant, so the
    merge / rollback callers that already hold it are unaffected.
    """
    scope = RefreshScope(rebuild_cells=rebuild_cells)
    await compute_boundary_derivation(session, scope)
    return await publish_membership_state(session, scope)


async def run_staged_membership_refresh(
    engine: AsyncEngine, scope: RefreshScope
) -> MembershipRefreshSummary:
    """Loader/CLI entry: run the refresh as TWO transactions on ONE pinned physical connection —
    ``compute`` (UNlocked, temp-only) → commit → ``publish`` (locked apply) → commit (spec
    2026-07-17 §2). The expensive geometry commits before the advisory lock is ever taken, so an
    interactive add is never blocked by it.

    Postgres temp tables belong to the physical connection, not to a pooled ``AsyncSession``, so the
    staging created in compute would vanish across a normal session's post-commit connection swap.
    We therefore pin ONE ``AsyncConnection`` for the whole operation and let a single bound
    ``AsyncSession`` own the transaction lifecycle exclusively (autobegin / commit / rollback) — the
    session and the connection can never fight over one transaction. A publish exception is rolled
    back via the session BEFORE the ``async with`` exit, so the connection is returned with no open
    or aborted transaction; the temp tables drop with the connection.

    Raises on any failure (compute or publish). A publish failure leaves the coherent PREVIOUS
    generation live (compute wrote only temp; the live apply is atomic and rolled back), and the
    caller — the loader Job (``restartPolicy: Never`` / ``backoffLimit: 0``) — fails visibly with a
    nonzero exit rather than silently retrying. Recovery is an explicit rerun.
    """
    scope_extra = {"scope": "country" if scope.scoped else "all", "country": scope.cc}
    async with engine.connect() as connection:
        session = AsyncSession(bind=connection, expire_on_commit=False)
        log.info("compute_started", extra=scope_extra)
        await compute_boundary_derivation(session, scope)
        await session.commit()
        log.info("compute_completed", extra=scope_extra)
        try:
            summary = await publish_membership_state(session, scope)
            await session.commit()
        except Exception:
            # Roll back via the session BEFORE the connection is returned, so it carries no open or
            # aborted transaction. Emit a safe stage marker (no payload/PII/SQL/driver internals) —
            # the propagating exception's traceback carries the diagnostic detail to stderr.
            await session.rollback()
            log.error("publish_failed", extra=scope_extra)
            raise
        # Emitted only after the commit above is durable — never before.
        log.info("publish_completed", extra=scope_extra)
        return summary
