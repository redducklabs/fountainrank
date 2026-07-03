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
- :func:`refresh_all_memberships` — the whole DB (boundary load + backfill). Re-assigns every
  fountain, then recomputes ``fountain_count`` (all places), ``is_canonical`` (uses the fresh
  counts), and ``parent_id`` (city -> country by containment). Set-based; one transaction (the
  caller commits).

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

# Assign country_place_id + city_place_id for the fountains selected by the :fountain_id filter
# (a NULL filter = all fountains). ST_Covers(boundary, location): the polygon covers the point.
# The city LATERAL keys off the country match's country_code, so an unmatched point (no country
# polygon) yields both NULL, and a covered-but-no-eligible-city point yields country-only.
_ASSIGN_SQL = text(
    f"""
    UPDATE fountains f
    SET country_place_id = m.country_place_id,
        city_place_id = m.city_place_id
    FROM (
        SELECT
            f2.id AS fountain_id,
            cc.country_place_id,
            city.city_place_id
        FROM fountains f2
        LEFT JOIN LATERAL (
            SELECT pb.id AS country_place_id, pb.country_code
            FROM place_boundaries pb
            WHERE pb.subtype = 'country' AND ST_Covers(pb.boundary, f2.location)
            ORDER BY ST_Area(pb.boundary::geometry) ASC
            LIMIT 1
        ) cc ON TRUE
        LEFT JOIN place_scope_config cfg ON cfg.country_code = cc.country_code
        LEFT JOIN LATERAL (
            SELECT pb.id AS city_place_id
            FROM place_boundaries pb
            WHERE pb.country_code = cc.country_code
              AND pb.subtype = ANY(COALESCE(cfg.eligible_city_subtypes, {_DEFAULT_ELIGIBLE_SQL}))
              AND ST_Covers(pb.boundary, f2.location)
            ORDER BY ({_priority_case("pb.subtype")}) DESC, ST_Area(pb.boundary::geometry) ASC
            LIMIT 1
        ) city ON TRUE
        WHERE (CAST(:fountain_id AS uuid) IS NULL OR f2.id = CAST(:fountain_id AS uuid))
    ) m
    WHERE f.id = m.fountain_id
      AND (f.country_place_id IS DISTINCT FROM m.country_place_id
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
          AND (f.city_place_id = pb.id OR f.country_place_id = pb.id)
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

# Select one canonical place per (country_code, slug) among city-eligible places (spec §4.3/§11.5).
# MUST run after _RECOUNT_ALL_SQL — the tie-break reads the fresh fountain_count. overture_id is the
# final stable tie-break so the winner is deterministic. Reset-then-set keeps the partial unique
# index (country_code, slug) WHERE is_canonical satisfied at every step (one true row per group).
_CANONICAL_RESET_SQL = text("UPDATE place_boundaries SET is_canonical = false WHERE is_canonical")
_CANONICAL_SET_SQL = text(
    f"""
    WITH eligible AS (
        SELECT pb.id, pb.country_code, pb.slug, pb.subtype, pb.fountain_count, pb.overture_id
        FROM place_boundaries pb
        LEFT JOIN place_scope_config cfg ON cfg.country_code = pb.country_code
        WHERE pb.subtype = ANY(COALESCE(cfg.eligible_city_subtypes, {_DEFAULT_ELIGIBLE_SQL}))
    ),
    ranked AS (
        SELECT id, ROW_NUMBER() OVER (
            PARTITION BY country_code, slug
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
    FROM (SELECT DISTINCT country_code, slug FROM place_boundaries WHERE id = ANY(:place_ids)) tg
    WHERE pb.country_code = tg.country_code AND pb.slug = tg.slug AND pb.is_canonical
    """
)
_RECANON_SET_SQL = text(
    f"""
    WITH tg AS (
        SELECT DISTINCT country_code, slug FROM place_boundaries WHERE id = ANY(:place_ids)
    ),
    grp AS (
        SELECT pb.id, pb.country_code, pb.slug, pb.subtype, pb.fountain_count, pb.overture_id
        FROM place_boundaries pb
        JOIN tg ON tg.country_code = pb.country_code AND tg.slug = pb.slug
        LEFT JOIN place_scope_config cfg ON cfg.country_code = pb.country_code
        WHERE pb.subtype = ANY(COALESCE(cfg.eligible_city_subtypes, {_DEFAULT_ELIGIBLE_SQL}))
    ),
    ranked AS (
        SELECT id, ROW_NUMBER() OVER (
            PARTITION BY country_code, slug
            ORDER BY ({_priority_case("subtype")}) DESC, fountain_count DESC, overture_id ASC
        ) AS rn
        FROM grp
    )
    UPDATE place_boundaries SET is_canonical = true
    WHERE id IN (SELECT id FROM ranked WHERE rn = 1)
    """
)

# Derive parent_id by containment (city -> country), NOT Overture's hierarchy (spec §11.4). A
# representative interior point of the child (ST_PointOnSurface, guaranteed inside the child, hence
# inside its country) is tested against country polygons. Country places themselves get NULL.
_PARENT_RESET_SQL = text(
    "UPDATE place_boundaries SET parent_id = NULL "
    "WHERE subtype = 'country' AND parent_id IS NOT NULL"
)
_PARENT_SET_SQL = text(
    """
    UPDATE place_boundaries child
    SET parent_id = p.country_id
    FROM (
        SELECT c.id AS child_id, ctry.id AS country_id
        FROM place_boundaries c
        LEFT JOIN LATERAL (
            SELECT pb.id
            FROM place_boundaries pb
            WHERE pb.subtype = 'country'
              AND pb.id <> c.id
              AND ST_Covers(pb.boundary, ST_PointOnSurface(c.boundary::geometry)::geography)
            ORDER BY ST_Area(pb.boundary::geometry) ASC
            LIMIT 1
        ) ctry ON TRUE
        WHERE c.subtype <> 'country'
    ) p
    WHERE child.id = p.child_id
      AND child.parent_id IS DISTINCT FROM p.country_id
    """
)

_SUMMARY_SQL = text(
    """
    SELECT
        (SELECT count(*) FROM fountains) AS fountains_total,
        (SELECT count(*) FROM fountains WHERE country_place_id IS NOT NULL) AS matched_country,
        (SELECT count(*) FROM fountains WHERE city_place_id IS NOT NULL) AS matched_city,
        (SELECT count(*) FROM fountains
           WHERE country_place_id IS NOT NULL AND city_place_id IS NULL) AS country_only,
        (SELECT count(*) FROM fountains WHERE country_place_id IS NULL) AS unmatched,
        (SELECT count(*) FROM place_boundaries WHERE is_canonical) AS canonical_places
    """
)


@dataclass
class MembershipRefreshSummary:
    fountains_total: int = 0
    matched_country: int = 0
    matched_city: int = 0
    country_only: int = 0
    unmatched: int = 0
    canonical_places: int = 0


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
    await session.execute(_RECANON_RESET_SQL, {"place_ids": ids})
    await session.execute(_RECANON_SET_SQL, {"place_ids": ids})


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
            text("SELECT country_place_id, city_place_id FROM fountains WHERE id = :fid"),
            {"fid": fountain_id},
        )
    ).one_or_none()
    if old is None:  # fountain was deleted between flush and refresh — nothing to assign.
        return

    await session.execute(_ASSIGN_SQL, {"fountain_id": fountain_id})

    new = (
        await session.execute(
            text("SELECT country_place_id, city_place_id FROM fountains WHERE id = :fid"),
            {"fid": fountain_id},
        )
    ).one()

    # Recompute counts + canonical for exactly the places whose membership set changed (old ∪ new).
    # The fountain row is already updated in this txn, so the counts reflect it.
    affected = {
        pid
        for pid in (
            old.country_place_id,
            old.city_place_id,
            new.country_place_id,
            new.city_place_id,
        )
        if pid is not None
    }
    await recompute_place_counts(session, affected)
    log.info(
        "fountain_membership_recomputed",
        extra={
            "fountain_id": str(fountain_id),
            "country_place_id": str(new.country_place_id) if new.country_place_id else None,
            "city_place_id": str(new.city_place_id) if new.city_place_id else None,
        },
    )


async def refresh_all_memberships(session: AsyncSession) -> MembershipRefreshSummary:
    """Re-derive the whole membership state: assignment, counts, canonical, parent (spec §11.5).

    Ordered so each step sees the previous one's output: assign every fountain -> recompute all
    counts -> select ``is_canonical`` (tie-breaks on the fresh counts) -> derive ``parent_id``
    (independent). Set-based; one transaction — the caller commits. Run on every boundary load and
    by the backfill CLI.

    Takes the ``ADD_FOUNTAIN_LOCK`` advisory lock so a whole-DB refresh (boundary load / backfill /
    rollback) is serialized with concurrent adds + imports — otherwise a refresh could recount from
    a snapshot missing an in-flight add and commit a stale ``fountain_count`` over it. The lock is
    re-entrant, so callers that already hold it (``merge``/``rollback``) are unaffected.
    """
    await session.execute(select(func.pg_advisory_xact_lock(ADD_FOUNTAIN_LOCK_KEY)))
    await session.execute(_ASSIGN_SQL, {"fountain_id": None})
    await session.execute(_RECOUNT_ALL_SQL)
    await session.execute(_CANONICAL_RESET_SQL)
    await session.execute(_CANONICAL_SET_SQL)
    await session.execute(_PARENT_RESET_SQL)
    await session.execute(_PARENT_SET_SQL)

    row = (await session.execute(_SUMMARY_SQL)).one()
    summary = MembershipRefreshSummary(
        fountains_total=row.fountains_total,
        matched_country=row.matched_country,
        matched_city=row.matched_city,
        country_only=row.country_only,
        unmatched=row.unmatched,
        canonical_places=row.canonical_places,
    )
    log.info(
        "membership_refresh_complete",
        extra={
            "fountains_total": summary.fountains_total,
            "matched_country": summary.matched_country,
            "matched_city": summary.matched_city,
            "country_only": summary.country_only,
            "unmatched": summary.unmatched,
            "canonical_places": summary.canonical_places,
        },
    )
    return summary
