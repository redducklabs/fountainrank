# Discovery Filters (Slice 5) — Implementation Plan

> TDD, task-by-task. Source spec: `docs/specs/2026-06-22-contribution-data-and-gamification-design.md` §9 "Filter semantics". Issue #43.

**Goal:** Add discovery filters to the `GET /fountains` (nearby) and `GET /fountains/bbox` endpoints using the structured data from Slices 1–4 (attribute consensus, operational status, ratings). Filters are additive query params; defined unknown-handling; all filters applied in `WHERE` before `ORDER BY`/`LIMIT`. No schema change (reuses the `(attribute_type_id, consensus_value)` consensus index).

## Global constraints
Same as prior slices. No new tables/migrations. Branch `feat/discovery-filters` → PR → CI green + Codex `VERDICT: APPROVED` + comments addressed → squash-merge → deploy.

## Filters (query params on BOTH nearby + bbox)
A shared FastAPI dependency `discovery_filters(...) -> DiscoveryFilters` (a frozen dataclass) parses the params so both endpoint signatures stay clean and the logic is shared:

| Param | Type | Meaning |
|---|---|---|
| `working_now` | bool=false | authoritative `current_status='ok'` OR (`current_status IS NULL` AND baseline `is_working=true`). Excludes `reported_issue`/`degraded`/`not_working`. |
| `verified_within_days` | int>0 \| None | `last_verified_at >= now - N days` (server `now`, UTC). |
| `bottle_filler` | bool=false | attribute `bottle_filler` consensus = `yes` |
| `wheelchair_reachable` | bool=false | attribute `wheelchair_reachable` consensus = `yes` |
| `dual_height` | bool=false | attribute `dual_height` consensus = `yes` |
| `indoor` | bool=false | attribute `indoor_outdoor` consensus = `indoor` |
| `public_access` | bool=false | attribute `access_kind` consensus = `public` |
| `min_rating` | float \| None, **`Query(ge=1.0, le=5.0)`** | `average_rating >= min_rating` (1–5 scale; out-of-range → 422) |
| `min_rating_count` | int \| None, `Query(ge=0)` | `rating_count >= min_rating_count` |
| `include_unknown` | bool=false | widens the **attribute** filters (see below) |

Only filters that are "on" (true / not-None) are applied. `min_rating`/`verified_within_days`/`min_rating_count` are simple column predicates. `working_now` is a column predicate over the denormalized `current_status`/`is_working`.

## Attribute filter semantics (#43, spec §9) — the careful part
Each attribute filter targets `(key, value)` (e.g. `bottle_filler`→`("bottle_filler","yes")`, `indoor`→`("indoor_outdoor","indoor")`, `public_access`→`("access_kind","public")`). Resolved via a JOIN to `attribute_types` constrained to **`key == <key> AND place_type == 'fountain' AND is_active`** (NOT hard-coded ids, and NOT key-only — keys are unique per place type, so a future restroom attribute sharing a key must not affect fountain filtering; this matters especially for the `NOT EXISTS(... consensus_value IS NOT NULL)` branch).

- **Default (no `include_unknown`):** match iff `EXISTS` a `fountain_attribute_consensus` row for that fountain+key with `consensus_value = <value>`. A tie/`mixed` has `consensus_value = NULL` → never matches (spec §6.3); unknown / no-consensus / no-row → excluded.
- **`include_unknown=true`:** widen to ALSO include fountains NOT definitively known to be something else — i.e. match iff `EXISTS(consensus_value=<value>)` **OR** `NOT EXISTS(consensus row with consensus_value IS NOT NULL)` for that key. This includes `yes`/target, plus `confidence='none'` rows and fountains with no observation, while still **excluding** fountains with a definite contradicting consensus (e.g. `bottle_filler` definitively `no`). Documented + tested as the unknown-handling matrix.

Each attribute filter is an independent `EXISTS`/`NOT EXISTS` correlated subquery `AND`-ed into the `WHERE` — multiple attribute filters AND together. Uses the `ix_fountain_attribute_consensus_attr_value` index.

## Execution order (correctness, spec §9)
`_apply_discovery_filters(stmt, filters, *, now)` adds every predicate to the `WHERE` clause. The endpoints then apply `ORDER BY` (distance for nearby; none for bbox) and `.limit(settings.max_results)` **after** all filters — never cap before filtering. (The spatial predicate + `is_hidden=false` stay in `WHERE` too.)

## Files
- `app/schemas.py` or a small `app/filters.py`: `DiscoveryFilters` dataclass + the `discovery_filters` Query dependency + `_apply_discovery_filters` query builder + the `ATTRIBUTE_FILTERS` map. (Put it in `app/filters.py` to keep the router lean.)
- `app/routers/fountains.py`: `nearby_fountains` + `fountains_in_bbox` gain `filters: DiscoveryFilters = Depends(discovery_filters)`, call `_apply_discovery_filters` before order/limit.
- Tests: `test_filters.py`.

## Tests (the unknown-handling matrix is the heart)
Build fountains with known states, then assert filter results:
- `working_now`: ok-corroborated included; not_working/reported_issue/degraded excluded; no-reports + `is_working=true` included; no-reports + `is_working=false` excluded.
- attribute default: consensus `yes` included; consensus `no` excluded; tie/`mixed` (NULL) excluded; no-observation excluded; `include_unknown=true` → `yes` + no-observation + tie included, but definite `no` STILL excluded.
- enum filters: `indoor` matches `indoor_outdoor=indoor`, excludes `outdoor`; `public_access` matches `access_kind=public`, excludes `restricted`.
- `min_rating`/`min_rating_count`: boundary inclusive; **`min_rating` out-of-range (0, 6, -1) → 422** (both endpoints, via the shared dependency); `verified_within_days`: inside/outside window + `<=0` → 422.
- **filter-before-LIMIT correctness (must catch the real regression):** for nearby, seed **`max_results` NON-matching fountains NEARER** the query point plus matching fountains FARTHER, with the cap high enough to return the matching set after filtering — a cap-before-filter implementation would return only the nearer non-matching rows and the test fails. For bbox (no order), use an over-cap set where matching rows would fall outside an unfiltered limited subquery. (Use a `settings` override to set a small `max_results` for a deterministic, fast test.)
- combined filters AND together; no filters → unchanged behavior (existing nearby/bbox tests still pass).
- bbox AND nearby both honor the filters (parametrized key cases).
- **OpenAPI** (`test_openapi.py`): the new query params (`working_now`, `bottle_filler`, `min_rating`, `include_unknown`, …) appear on BOTH `/api/v1/fountains` and `/api/v1/fountains/bbox`. (The generated `packages/api-client` artifacts are gitignored and regenerated by CI — no commit needed; this slice ships no web/mobile code.)

## Definition of done
Backend mirror green; PR CI green + Codex `VERDICT: APPROVED` + comments addressed; squash-merge; deploy; verify a filtered bbox query live. #43 closed (API/data); filter UI is Slice 6. Then Slice 6.
