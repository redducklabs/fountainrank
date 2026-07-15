# Scoped membership refresh for boundary loads — design (2026-07-14)

Performance follow-up to `docs/specs/2026-07-14-place-hierarchy-drilldown-design.md`. No change to
the membership *model* or URL contract — only to *how much* a single boundary load recomputes.

## Problem

`backend/app/imports/boundary_cli.py` calls `refresh_all_memberships()` after loading one country's
boundaries. That function recomputes the **entire** DB: `TRUNCATE place_boundary_cells` +
`ST_Subdivide` over **every** boundary, then re-assigns/recounts/re-canonicalizes **every** fountain
and place. Measured on production: loading Germany (after the US was already loaded) took **~40
min**, dominated by the full cell rebuild and the all-fountains passes. The worldwide fan-out is ~57
more countries; at ~40 min each, serialized, that is ~38 hours — and each load re-locks the prod DB
and re-processes all US data for no reason.

## Key correctness insight — why scoping by country is safe

The membership model is **per-country by construction**:

- **Countries do not overlap.** A fountain is covered by at most one `subtype='country'` polygon, so
  loading country X can only change the membership of fountains inside X. Every other country's
  fountains keep their assignment unchanged.
- **Canonical groups are per-country.** The unique keys are `(country_code, slug)` for regions and
  `(country_code, parent_id, slug)` for cities. No canonical group spans two countries, so selecting
  canonical rows for X's places never depends on, and never affects, another country's rows.
- **`place_kind` / `parent_id` for X's boundaries depend only on X's boundaries and X's
  `place_scope_config`** (region parent = X's country; city parent = X's canonical region).

Therefore a refresh that touches **only** country X's boundaries, cells, places, and the fountains
inside X produces **exactly** the same final state (for X's rows and X's fountains) as a full
refresh — and leaves every other country **bit-for-bit unchanged**. This equivalence is the design's
core invariant and its test.

## Design — `refresh_country_memberships(session, country_code)`

A new entry point beside `refresh_all_memberships`. Same 10-step shape, every step filtered to
`country_code = :cc`, plus an incremental cell rebuild. Runs under the same `ADD_FOUNTAIN_LOCK`
advisory lock.

1. **Incremental cells.** `DELETE FROM place_boundary_cells WHERE place_id IN (SELECT id FROM
   place_boundaries WHERE country_code = :cc)`, then `INSERT` `ST_Subdivide` cells for **only** X's
   boundaries, then `ANALYZE place_boundary_cells`. Other countries' cells are untouched. (First load
   of X: the DELETE is a no-op; re-load: it replaces X's cells wholesale — same wholesale-replace
   semantics the full rebuild has, scoped.)
2. **`place_kind`** — the existing `_PLACE_KIND_SQL` `+ AND pb.country_code = :cc`.
3. **Region parent** — `_REGION_PARENT_SQL` scoped to X (region → X's country row).
4. **Fountain assignment — the one cross-row step, bounded to X's fountains.** Reassign exactly the
   fountains that are (a) covered by X's freshly-built cells, **or** (b) currently assigned to any of
   X's places (so a re-load that *shrinks* a boundary un-assigns a fountain that left X). The
   candidate set:
   ```
   WHERE f.id IN (
       SELECT f2.id FROM fountains f2
       JOIN place_boundary_cells cell ON ST_Covers(cell.geom, f2.location::geometry)
       JOIN place_boundaries pb ON pb.id = cell.place_id AND pb.country_code = :cc
       UNION
       SELECT f3.id FROM fountains f3
       JOIN place_boundaries pb ON pb.country_code = :cc
       WHERE pb.id IN (f3.country_place_id, f3.region_place_id, f3.city_place_id)
   )
   ```
   The existing 3-way PIP assignment then runs for just that bounded set. Countries don't overlap, so
   a fountain in the candidate set can only match X's country polygon anyway — the result is
   identical to the global assignment for those fountains, and no fountain outside X is read for
   assignment.
5. **Canonical regions** — `_CANONICAL_REGIONS_SQL` scoped to X (reset + select among
   `place_kind='region' AND country_code = :cc`).
6. **City parent** — `_CITY_PARENT_SQL` scoped to X (cities in X → X's canonical regions). The
   `city_pt` CTE is likewise filtered to X, so `ST_PointOnSurface` runs only over X's cities.
7. **Recount** — recount only X's places (the 3-way count restricted to
   `pb.country_code = :cc`).
8. **Canonical cities** — scoped to X.
9. **Remap** — remap `city_place_id` for X's candidate fountains onto X's canonical city rows.
10. **Recount** X's places again (post-remap).

Every SQL variant is the *same* logic as the full-refresh statement with a `country_code = :cc`
predicate (and, for the fountain steps, the bounded candidate set). No new logic — only a filter —
so divergence risk is minimal and is pinned by the parity test below.

## Wiring

`boundary_cli` already knows the loaded scope's country (it passes `--scope-id`, and the registry
row carries the ISO country). Pass that country code to `refresh_country_memberships` instead of
`refresh_all_memberships`. The **backfill migration `0025` is unaffected** — it is frozen and
already ran; this changes only the ongoing loader path.

`refresh_all_memberships` stays (the CLI `--all` path, the one-time backfill semantics, and a manual
"rebuild everything" escape hatch). The OSM-import callers (`merge.py`) that pass
`rebuild_cells=False` are unchanged — they don't load boundaries.

## The invariant, as a test

`refresh_country_memberships(session, 'xx')` on a fixture with **two** countries loaded must produce
a DB state **identical** to `refresh_all_memberships(session)` — for **both** countries. Concretely:
load country A + country B fixtures; run full refresh; snapshot the whole membership state; mutate
nothing; run `refresh_country_memberships` for B; assert (a) B's rows/fountains are unchanged
(idempotent) **and** (b) A's rows/fountains are byte-identical (untouched). Then a second test:
starting from "A loaded, B boundaries just streamed but unclassified," `refresh_country_memberships('B')`
yields the same B-state as a full refresh would, and leaves A identical.

Plus: a fountain on the A/B border stays with the country that covers it; a re-load of B that drops a
boundary un-assigns the fountains that left B; the scoped path never changes A's `fountain_count`.

## Non-goals

- No change to the URL contract, indexability, or the city-state behavior (Hamburg stays a region
  with district cities — confirmed desired).
- Not touching `refresh_all_memberships` correctness — only adding a scoped sibling.
