# SEO coverage report + per-scope readiness gate — design spec (2026-07-04)

Implements **Slice 1e** of `docs/plans/2026-07-02-crawlable-seo-pages.md` (the crawlable-SEO
feature, #127). Slices 1a–1d and 2–5 already shipped; the public country/city/attribute/fountain
routes + sitemaps are live for the `us` and `lu` scopes. Slice 1e is the last piece of Slice 1:
the **coverage report** (a per-scope diagnostic of how well boundaries + membership cover a scope)
and the **readiness gate** (a per-scope owner-signoff that controls whether a scope's *city* routes
are indexed/sitemapped).

Source sections: spec `docs/specs/2026-07-02-crawlable-seo-pages-design.md` §4.2, §7, §11.5; plan
Slice 1e. Rules unchanged: branch → PR → CI green + Codex `VERDICT: APPROVED` + comments addressed →
squash-merge; TDD where it applies; IaC read-only locally; production reads/writes go through the
CI-only path (`kubectl exec` the deployed backend pod). No time estimates, no AI attribution.

---

## 1. Problem

Two gaps remain from Slice 1:

1. **No per-scope visibility.** `membership.py` emits only a *global* `MembershipRefreshSummary`
   (total matched/unmatched/country-only/canonical). There is no per-scope view of boundary counts,
   city-assignment quality, or *where* city coverage is missing — so there's no principled basis for
   deciding whether a newly-loaded country is good enough to promote its city pages.
2. **No readiness gate.** The shipped routes gate on a single global per-city threshold
   (`fountain_count ≥ seo_place_min_fountains`) plus `is_canonical`. A scope with poor overall
   city coverage (most fountains land country-only, a few thin city pages slip over `K`) would still
   expose those city pages to search engines. The plan (§4.2/§7/§11.5) calls for a **per-scope**
   "city routes ready" gate — a threshold-informed **owner signoff** — that the sitemap + city-page
   `noindex` respect. It does not exist yet.

## 2. Goals / non-goals

**Goals:** (a) a read-only, per-scope coverage report runnable on demand against prod; (b) a durable,
git-declared per-scope readiness flag that gates a scope's city routes; (c) wire that gate into the
existing backend queries with **zero regression** to the live `us`/`lu` scopes.

**Non-goals:** country-page gating (country routes are never gated — any loaded country clears `K`
easily; the gate is *city*-specific, matching the plan's "city routes ready" wording); a per-scope
threshold-override column (readiness is the boolean signoff — the numeric threshold is only the
report's *recommendation* constant); re-plumbing load-time skip histograms (those stay in the
boundary-load logs); any new public HTTP surface; touching `osm-boundary-load.yml`.

## 3. Data model

Add one column to the existing `place_scope_config` table (today: `country_code` PK +
`eligible_city_subtypes`, seeded for `us`/`lu` in migration 0015):

```
city_routes_ready boolean NOT NULL DEFAULT false
```

- New Alembic migration **0017** (reversible; down-migration drops the column). The migration also
  **sets `city_routes_ready = true` for `us` and `lu`** — both are already live, so nothing
  regresses.
- Add `city_routes_ready: Mapped[bool]` to the `PlaceScopeConfig` model.

**Readiness semantics.** A scope is "city-ready" **iff** it has a `place_scope_config` row with
`city_routes_ready = true`. A country with no row (or `false`) still gets its city *memberships*
computed (via the COALESCE default eligible set in `membership.py`), but its city routes stay
`noindex` + out of the sitemap until the owner signs off. **Signoff = a reviewed PR** that
inserts/patches that scope's `place_scope_config` row (a data migration, the same mechanism that
already manages `eligible_city_subtypes`) — keeping the readiness state auditable and in git, never
prod-only.

## 4. Coverage report (read-only)

New module **`backend/app/seo_coverage.py`** (report logic; sibling of `membership.py`), thin CLI
**`backend/app/imports/seo_coverage_cli.py`** (mirrors `membership_cli.py`), and workflow
**`.github/workflows/seo-coverage-report.yml`** (manual dispatch; mirrors the tail of
`osm-boundary-load.yml`).

**What it computes** — one entry per loaded scope (each `subtype='country'` row), plus a global tail:

Per scope:
- `country_code`, `country_name`, `city_routes_ready` (current flag)
- `effective_eligible_city_subtypes` — the set the ladder **actually uses** for this scope (the
  `place_scope_config` row if present, else the code default `{locality, localadmin}`) — plus
  `eligible_from_config` (bool: `true` when it came from a config row, `false` when it's the default).
  A no-row country reports the real default set, not `null`, so `city_coverage_pct` is interpretable.
- `boundary_counts` — rows in this `country_code` by `subtype` (`country`/`region`/`county`/
  `localadmin`/`locality`)
- `fountains_in_country` (`country_place_id` = this country), `city_matched`, `country_only`, and
  **`city_coverage_pct` = city_matched / fountains_in_country**
- **`city_assignment_by_subtype`** — of the city-matched fountains, the split across the ladder
  subtypes actually used (`locality`/`localadmin`/`county`): count + percent each
- **`top_unmatched_clusters`** — the `country_only` fountains coarse-binned by location to show
  *where* city coverage is missing: top-N grid cells by count, each with a representative centroid
  (lat/lon) + count (see §7 decision)
- `invalid_boundaries` — count of this scope's boundaries where `NOT ST_IsValid(boundary::geometry)`
  (a health check; expected 0, since the loader rejects invalid geometry — see §7 decision). The
  `::geometry` cast is required: `boundary` is `Geography(MULTIPOLYGON,4326)` and `ST_IsValid` is a
  geometry predicate.
- `recommended_ready` — `city_coverage_pct ≥ SEO_COVERAGE_READY_PCT` (a config constant); a
  *recommendation* the owner reads, not an automatic action

Global tail:
- `unmatched_no_country` — fountains with `country_place_id IS NULL` (no loaded country covers them)
  + `top_unmatched_clusters` for them

**Delivery.** `python -m app.imports.seo_coverage_cli` prints the report as structured JSON to
stdout — read-only, no writes, no commit. The workflow (manual dispatch, `environment: production`,
read-only) authenticates with `doctl`, saves kubeconfig by the stable cluster name, finds the
Running backend pod, and `kubectl exec … python -m app.imports.seo_coverage_cli`, streaming the JSON
into the run logs. No file streaming, no dry-run flag — it only reads the DB the pod already
connects to.

**The workflow takes no `country` input** — it always emits the full per-scope report (a handful of
scopes; cheap). This deliberately removes any shell-injection surface in the Actions wrapper (the
report is small enough that per-scope filtering there earns nothing). The `--country <iso2>` filter
exists on the CLI only, for local/dev use, and is bound as a SQL parameter + syntactically validated
to a 2-letter code (never string-interpolated).

**Consistency contract (MUST — the report certifies owner-signoff evidence, so it must never show a
mixed boundary/membership state).** The boundary loader commits `place_boundaries` in batches and
*then* commits `refresh_all_memberships` (`backend/app/imports/boundary_cli.py`), so between those
commits the DB holds new boundaries against stale `country_place_id`/`city_place_id`/`fountain_count`
/`is_canonical`. The report guards against certifying that window on two levels:
- **In the CLI (lock-then-snapshot ordering is load-bearing):** on a single dedicated connection,
  **first acquire a *session-level* advisory lock — `pg_advisory_lock(ADD_FOUNTAIN_LOCK_KEY)`
  — BEFORE opening the report transaction**, then open **one `READ ONLY`, `REPEATABLE READ`**
  transaction and run every report query, then commit and **`pg_advisory_unlock(...)` in a
  `finally`** (the short-lived CLI connection also drops the session lock on close, as a backstop).
  The ordering matters: a `REPEATABLE READ` snapshot is fixed by the transaction's **first statement**,
  so taking a *transaction-scoped* `pg_advisory_xact_lock` as that first statement would fix the
  snapshot *before* the lock-wait completes — reading pre-refresh state. Acquiring a *session* lock
  *before* the transaction starts means the snapshot (established by the first query inside the txn)
  is taken only **after** the wait completes, i.e. after any in-flight membership mutation has
  committed. Holding the lock for the whole read also blocks any membership mutation from committing
  mid-report; `REPEATABLE READ` then guarantees a single stable snapshot across the report's many
  queries. Every fountain/membership mutation takes the **same key** as a transaction-scoped lock and
  does its mutation **and** membership refresh in **one** locked transaction — `refresh_all_memberships`,
  POST /fountains, admin hide/delete, and the OSM import (`merge.py` takes `ADD_FOUNTAIN_LOCK` before
  mutating and merges + refreshes in the same session transaction) — so the single session lock fully
  serializes the report against all of them. (`pg_advisory_lock` and `pg_advisory_xact_lock` share one
  lock space, so the session lock and those xact locks mutually exclude on the same key.)
- **At the workflow level (the one batched path):** the **boundary loader** is the only writer that
  commits before its locked refresh (batch upserts of `place_boundaries`, each its own commit, *then*
  the locked `refresh_all_memberships`), so its between-batch window is not lock-guarded. To close it,
  `seo-coverage-report.yml` declares the **same concurrency group as `osm-boundary-load.yml`**
  (`boundary-load-production`, `cancel-in-progress: false`) — a report and a boundary load can never
  run concurrently. No other write path has a committed pre-refresh window (the OSM import mutates +
  refreshes in one locked transaction), so the session lock covers the rest.

**Implementation notes (correctness/security):**
- Any lat/lon extraction (cluster centroids) goes through the **centralized `app/geo.py`** helpers
  (`latitude_of`/`longitude_of`) so lon/lat ordering stays correct and in one place; clustering casts
  `location::geometry` for `ST_SnapToGrid` (PostGIS geography has no snap-to-grid).
- `city_coverage_pct` (and the by-subtype percentages) are **null when the denominator is 0** (a
  scope with no matched fountains) — never a divide-by-zero; the raw counts still report.
- Read-only by construction: the CLI opens a `READ ONLY` transaction and never issues DML/commit;
  tests assert it performs no writes.

## 5. The gate wiring (backend only)

Two queries change; **no web code changes** — the cities sitemap sources from `list_places` and the
city page already derives `noindex` from the backend's `indexable` flag, so both inherit the gate.

1. **`GET /api/v1/places?country=<cc>` (`list_places`, cities branch)** — short-circuit to `[]`
   when `cc`'s scope is not ready, exactly like the existing "country not loaded → no cities" path.
   **Every crawler-visible city-list surface goes through this one endpoint** (verified: no other
   consumer exists), so all of them inherit the gate at once: the cities sitemap
   (`web/app/sitemaps/cities.xml`), the country page's "top cities" (degrades to the existing
   "explore the map" fallback), and the near-me page's popular-city links
   (`web/app/drinking-fountains-near-me`) — all call `getCountryCitiesServer`.
2. **`GET /api/v1/places/{country}/{city}/fountains` (`city_fountains`)** —
   `indexable = fountain_count ≥ seo_place_min_fountains AND scope_ready(cc)`. The city page's
   `generateMetadata` already sets `robots: { index: false }` when `!indexable`, so a not-ready
   scope's city pages become `noindex` while still rendering (reachable by direct link, excluded
   from discovery + sitemap).

The global `seo_place_min_fountains` (`K`) stays; readiness is a new AND-term. Country listing
(`country=None`) and country pages are untouched.

**Readiness lookup.** Both paths need "is `cc` ready?" — a single indexed PK read on
`place_scope_config` (`country_code` → `city_routes_ready`), resolved once per request. A missing
row means not-ready (safe default).

## 6. Testing

**Backend (pytest; mirrors existing suites):**
- `test_seo_coverage.py` — a fixture with one **ready** and one **not-ready** scope: assert per-scope
  boundary counts, `city_coverage_pct`, `city_assignment_by_subtype`, unmatched clustering (top cell
  + centroid + count), `invalid_boundaries` health, the `recommended_ready` threshold logic, and the
  global `unmatched_no_country` tail. Also: a scope **with no `place_scope_config` row** reports
  `effective_eligible_city_subtypes = {locality, localadmin}` + `eligible_from_config = false`;
  `city_coverage_pct` is `null` (not an error) when a scope has zero matched fountains; and the report
  **performs no writes** (runs in a `READ ONLY` transaction — assert no DML/commit).
- Extend `test_places.py` — a not-ready scope returns **no cities** from `list_places` and
  `indexable = false` from `city_fountains` *even when* `fountain_count ≥ K`; a ready scope is
  unchanged.
- Migration up/down + `alembic check` clean; `PlaceScopeConfig` model round-trip incl. the new
  column; `us`/`lu` seeded ready.

**Web (CI `workspace-js`):** a not-ready scope's city page is `noindex` and is absent from the
cities sitemap (mocked places API).

**Local runs** use the isolated `UV_PROJECT_ENVIRONMENT` backend venv (the repo `.venv` is Codex's
WSL env); JS checks run in CI.

## 7. Decisions

1. **Unmatched clustering = coarse `ST_SnapToGrid`** (≈0.5°) → top-N cells by count, each with a
   centroid + count. Chosen over `ST_ClusterKMeans` because it is **deterministic** and needs no `k`
   parameter — a stable, testable diagnostic. The grid size + N are config constants.
2. **"Invalid-ring skips" (plan wording) → "currently-invalid boundary geometries"** via
   `ST_IsValid(boundary::geometry)` (the cast is mandatory — `boundary` is a geography column). Load-
   time skips are not persisted in the DB (the loader rejects them and logs a skip histogram to the
   boundary-load run), so the coverage report reports what is queryable from current state: any
   boundary that is invalid *now* (expected 0). The per-load skip histogram stays the boundary-load
   workflow's responsibility.
3. **Signoff is git-declared, not a prod-set flag** — a reviewed data migration on
   `place_scope_config`, consistent with how `eligible_city_subtypes` is managed and with the repo's
   "keep knowledge in the repo" rule. §11.5's note that signoff "also sets the scope's eligible-city
   subtype set" is satisfied in the same migration (both columns live on `place_scope_config`).

## 8. Rollout / verification

- Ship the migration + gate + report behind CI + Codex approval; squash-merge.
- Deploy backend (manual `deploy.yml` dispatch) so the pod carries the migration + the
  `seo_coverage_cli`, then run `seo-coverage-report.yml` against prod and confirm the JSON for `us`
  and `lu` (both ready) — expect high country match, a plausible city split, and `invalid_boundaries
  = 0`.
- Because `us`/`lu` are seeded ready, the live sitemap + city pages are unchanged after deploy
  (verify: the cities sitemap still lists US/LU cities; a US city page is still indexable). The gate
  only ever *removes* a scope's city routes when that scope is not ready — a state neither live scope
  is in.
- The report + gate are also the **operational entry** for onboarding a new country later: load
  boundaries → run the report → if coverage is good, open the signoff PR (`city_routes_ready = true`,
  eligible set) → its city routes go live. This flow is documented in the SEO runbook
  (`docs/runbooks/seo.md`).
