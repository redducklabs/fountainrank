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

## Key correctness insight — and the two places it does NOT hold

*Revision 2 — rewritten after Codex spec-review-1 (3 [MAJOR]). The original "everything filtered to
X" was wrong on re-loads: a fountain can cross a border into an already-loaded neighbour, which a
full refresh reassigns to the neighbour and recounts there. So the safe design is **boundary-derived
rows scoped to X, but fountain reassignment global over a candidate set, with recount / canonical /
remap driven by the complete old∪new affected-place set** — the exact machinery
`recompute_fountain_membership` already uses.*

The membership model is **per-country only for boundary-derived state**:

- **`place_kind` / `parent_id` / canonical selection for X's boundaries** depend only on X's
  boundaries and X's `place_scope_config`, and canonical keys (`(country_code, slug)` /
  `(country_code, parent_id, slug)`) never span countries. **These are safe to scope to
  `country_code = X`** — reclassifying X's boundaries cannot change another country's rows.

It is **NOT** per-country for **fountain assignment**, in two cases that a correct design must handle:

1. **Border points.** `ST_Covers` uses closed polygons, so a fountain exactly on a shared border is
   covered by *both* countries' cells. The full refresh resolves this deterministically via the
   country LATERAL's `ORDER BY pb.overture_id ASC`. A scoped assignment that filtered the country
   PIP to `= X` would pick X even when the full refresh picks the neighbour. **So the scoped
   reassignment MUST use the global `_ASSIGN_SQL` unchanged** (all-country country PIP + tie-break),
   applied only to a bounded *candidate set* — never a country-filtered PIP.

2. **Re-loads that move a fountain out of X into an already-loaded neighbour Y.** The full refresh
   assigns it to Y and updates Y's `fountain_count`. So the recount/remap/canonical steps MUST
   operate on the **complete old∪new affected-place set** — every `country_place_id` /
   `region_place_id` / `city_place_id` the candidate fountains held *before* reassignment, unioned
   with the ones they hold *after* — which can include Y's places. Recounting "only X's places"
   would leave Y stale. This is exactly what `recompute_place_counts`/`recompute_fountain_membership`
   already do for the single-fountain path.

With those two rules, a scoped refresh of X produces a DB state **identical to a full refresh** —
for X's rows, for the candidate fountains, and for any neighbour place a candidate moved to/from —
and leaves every untouched country bit-for-bit identical. That whole-DB equivalence (not just
"X unchanged") is the invariant and the parity test.

## Design — `refresh_country_memberships(session, country_code)`

A new entry point beside `refresh_all_memberships`, under the same `ADD_FOUNTAIN_LOCK` advisory lock.
It composes two things that are each already proven: **boundary reclassification scoped to X**, and
the **old∪new affected-set recompute** of `recompute_fountain_membership`. The step order mirrors the
full refresh (assign → recount → canonical, because canonical tie-breaks on the fresh counts).

**Definitions computed up front, inside the transaction:**

- **Candidate fountains** `C` = the fountains whose assignment could change:
  `(covered by X's freshly-rebuilt cells) UNION (currently assigned to any X place —
  country_place_id / region_place_id / city_place_id ∈ X's boundary ids)`. First load: `C` = the
  fountains geographically in X (currently country=NULL). Re-load: also the fountains X used to own.
- **Old affected places** `P_old` = every distinct `country_place_id`/`region_place_id`/`city_place_id`
  held by `C` **before** reassignment — captured into a temp set *before* step 4. This is what makes
  a neighbour Y's stale count impossible.

**Steps:**

1. **Incremental cells.** `DELETE FROM place_boundary_cells WHERE place_id IN (SELECT id FROM
   place_boundaries WHERE country_code = :cc)`, `INSERT` `ST_Subdivide` cells for X's boundaries only,
   `ANALYZE place_boundary_cells`. Other countries' cells untouched. (First load: DELETE is a no-op.)
2. **`place_kind`** for X — `_PLACE_KIND_SQL + AND pb.country_code = :cc`.
2b. **Scoped parent reset** — the country-scoped equivalent of `_PARENT_RESET_SQL`, run **after**
   step 2 and **before** any re-parenting:
   `UPDATE place_boundaries SET parent_id = NULL WHERE country_code = :cc AND place_kind IS DISTINCT
   FROM 'region'`. Load-bearing for a row whose `place_kind` **changed** on this load: a boundary that
   went `region → NULL`, `city → NULL`, or `region → ineligible` would otherwise keep its old
   `parent_id`, which a full refresh clears. (Regions keep their parent here and have it re-set in
   step 3; cities are NULLed here and re-parented in step 6.) Scoped to `country_code = :cc` so
   non-X rows are untouched.
3. **Region parent** for X — `_REGION_PARENT_SQL` scoped to X.
4. **Capture `P_old`, then reassign `C` with the GLOBAL `_ASSIGN_SQL`** (all-country country PIP +
   `overture_id` tie-break — **not** country-filtered), applied `WHERE f.id ∈ C`. A border/moved
   fountain therefore resolves to exactly the country a full refresh would pick, including a neighbour
   Y.
5. **Region canonical for X — count-free, so X-only is exact.** Country-scoped, tier-INDEPENDENT
   reset (`UPDATE place_boundaries SET is_canonical = false WHERE country_code = :cc AND is_canonical`
   — clears a row that changed tier, which a `place_kind`-filtered reset would miss), then select X's
   canonical **regions**. Regions never depend on a neighbour or on any fountain count (the parent
   spec makes region canonical `ST_Area`-geodesic, count-free), so a cross-border fountain move can
   **never** change a region winner — X is the only country whose regions can change, and only
   because X's boundaries changed.
6. **City parent** for X — `_CITY_PARENT_SQL` with its `city_pt` CTE filtered to `country_code = :cc`
   (so `ST_PointOnSurface` runs only over X's cities), parenting X cities to X's canonical regions.

7–11. **Fountain counts + city canonical + remap = a BATCH of `recompute_fountain_membership`,
   mirrored statement-for-statement.** The scoped refresh must reproduce that proven single-fountain
   sequence, over the whole candidate set `C` at once, so it inherits its exact behaviour — including
   the NULL-parent remap that a group-only pipeline misses. Let `P = P_old ∪ P_new ∪ (all X place
   ids)` (`P_new` = places `C` holds after step 4; `P_old` captured before it):
   - **`recompute_place_counts(session, P)`** — the admin-delete group pipeline:
     `_RECOUNT_PLACES_SQL`(P) → **`_RECOUNT_CITY_GROUPS_RAW_SQL`(P)** (raw geometry recount of every
     member of each affected `(country_code, parent_id, slug)` group, so a post-remap zero-count twin
     can regain the count needed to win) → `_RECANON_RESET_SQL`/`_RECANON_SET_SQL`(P) (reselect the
     canonical city per affected group) → **`_REMAP_CITY_GROUPS_SQL`(P)** (remap **every** fountain in
     each affected group onto the new canonical city — not just `C`) → `_RECOUNT_CITY_GROUPS_SQL`(P).
   - **`_REMAP_CITY_SQL` over `C`** — the step the group pipeline does **not** do: its
     `CASE WHEN city.parent_id IS NULL THEN NULL` branch sets `city_place_id = NULL` for a candidate
     fountain whose covering city lost its canonical parent (the degenerate §3 case). Exactly the
     `_REMAP_CITY_SQL` call `recompute_fountain_membership` runs after `recompute_place_counts`.
   - **Final recount** of `P` plus any place whose count the NULL-remap just changed — mirroring
     `recompute_fountain_membership`'s trailing `recompute_place_counts` when the final city differs
     from the raw assignment.

   So the scoped refresh = **X-boundary reclassification (steps 1–6)** + **`_ASSIGN_SQL` over `C`
   (step 4)** + **the `recompute_fountain_membership` count/canonical/remap tail, batched over `C`
   with affected set `P` (steps 7–11)**. Region reclassification is X-scoped and safe; every
   fountain/count/city-canonical/remap operation is the existing proven machinery over the complete
   affected set. No new count/canonical/remap SQL is written.

## Shared invariant with the existing incremental path — same-group city polygons don't overlap

`_RECOUNT_CITY_GROUPS_RAW_SQL` counts a group's members by **geometry** (`ST_Covers`), not by the FK.
This reconstructs raw counts for non-candidate neighbour fountains (its whole purpose), but it counts
a fountain for **every** covering city in the group — whereas `_ASSIGN_SQL` picks exactly **one** raw
city (subtype priority → smallest area → `overture_id`). The two therefore agree **iff two cities in
the same `(country_code, parent_id, slug)` group never geometrically overlap** — true for Overture
`division_area` at one subtype tier (administrative divisions partition, not overlap). This invariant
is **not new**: the existing `recompute_place_counts` (admin-delete / single-fountain path) already
relies on it, so the scoped refresh is exactly as full-refresh-equivalent as the code already in
production. The design states it explicitly and the tests assert non-overlap for the fixtures; if
Overture ever ships overlapping same-group polygons it would already break the shipped incremental
path, and is caught by the whole-DB parity oracle.

## Wiring

`boundary_cli` already knows the loaded scope's country (it passes `--scope-id`, and the registry
row carries the ISO country). Pass that country code to `refresh_country_memberships` instead of
`refresh_all_memberships`. The **backfill migration `0025` is unaffected** — it is frozen and
already ran; this changes only the ongoing loader path.

`refresh_all_memberships` stays (the CLI `--all` path, the one-time backfill semantics, and a manual
"rebuild everything" escape hatch). The OSM-import callers (`merge.py`) that pass
`rebuild_cells=False` are unchanged — they don't load boundaries.

**Planner-quality guard (Codex [MINOR]).** The incremental cells + `ANALYZE` leave whole-table stats
current, but the scoped candidate/PIP query must still use the cell GiST index. The implementation
verifies this on a realistic multi-country fixture (assert the plan is index-based / that the load
completes in the expected small time), because the existing `_ANALYZE_CELLS_SQL` comment already
warns that stale stats turn the PIP into a country-scale seq-scan disaster.

## The invariant, as a test — whole-DB parity under mutation

The invariant is **whole-DB equivalence to a full refresh**, and the tests must attack the re-load /
cross-border cases, not just "mutate nothing." The parity oracle: snapshot the **entire** membership
state (`fountains.{country,region,city}_place_id` + `place_boundaries.{place_kind,parent_id,
is_canonical,fountain_count}`) after `refresh_country_memberships('B')`, and separately after a fresh
`refresh_all_memberships()` from the same inputs; assert they are **byte-identical across both
countries**.

Required mutation scenarios (all with country A already loaded + refreshed):

1. **First load of B** (B boundaries streamed, unclassified): scoped('B') == full refresh; A identical.
2. **Idempotence:** scoped('B') twice == once.
3. **B shrinks so a fountain crosses into A** (the [MAJOR] case): scoped('B') assigns that fountain
   to **A**, updates **A's** `fountain_count`, and matches a full refresh — proving the recount spans
   `P_old`.
4. **B expands over a fountain previously in A:** the fountain moves to B (or stays A per the
   `overture_id` tie-break) exactly as a full refresh decides.
5. **A/B shared-border point:** resolves to the same country as a full refresh (global tie-break).
6. **A row in B changes tier / becomes `place_kind` NULL:** its stale `is_canonical` is cleared
   (proving the country-scoped tier-independent reset).
7. **A city in B loses its canonical parent region:** affected fountains remap to NULL, matching a
   full refresh.

Any scenario where scoped('B') and full refresh disagree on **any** row of **either** country is a
failing test — that is the whole point of the oracle.

## Non-goals

- No change to the URL contract, indexability, or the city-state behavior (Hamburg stays a region
  with district cities — confirmed desired).
- Not touching `refresh_all_memberships` correctness — only adding a scoped sibling.
