# SEO coverage report + readiness gate (#127 Slice 1e) — SHIPPED, DEPLOYED & VERIFIED (2026-07-04)

Self-contained handoff. Picked up from `handoffs/2026-07-04-doks-nodes-right-sized-deployed.md` §6
("Slice 1e — coverage report/gate … the best code pickup") and took it spec → plan → implement →
PR → **merge → deploy → live verification**, end to end.

`main` HEAD: `a16ef41 seo` (owner's local seo-agent notes) on top of
`b0c1ff7 feat: SEO coverage report + per-scope city-routes readiness gate (#127 Slice 1e) (#175)`.

---

## 1. What shipped

**PR #175** (squash `b0c1ff7`) — Slice 1e completes Slice 1 of the crawlable-SEO feature (#127).
CI green · Codex `VERDICT: APPROVED` (first pass, `temp/codex-reviews/pr-175-review-1.md`) · squash-merged.

- **Design docs (Codex-approved, 3 review rounds each):** spec
  `docs/specs/2026-07-04-seo-coverage-gate-design.md`, plan `docs/plans/2026-07-04-seo-coverage-gate.md`.
- **NEW standing reference:** `docs/runbooks/seo.md` — how the whole crawlable-SEO system works
  (Part A) **+ the owner exposure playbook (Part B)**. Read this for anything SEO going forward.
- **Data model:** migration `0017_place_scope_config_ready` adds
  `place_scope_config.city_routes_ready boolean NOT NULL default false`, **seeded `true` for `us`/`lu`**
  (the already-live scopes) so nothing regressed. A country with no row (or `false`) is **NOT ready**
  — the safe default; a new scope's city routes stay `noindex`/out-of-sitemap until an owner signs it
  off in a reviewed migration.
- **The gate (two backend points; web + sitemap inherit it, zero web-logic change):**
  `app/routers/places.py` — `list_places(country=cc)` returns `[]` for a not-ready scope;
  `city_fountains.indexable = fountain_count >= K AND scope_ready`. Every crawler-visible city-list
  surface (cities sitemap, country-page top-cities, near-me links, city-page `noindex`) flows through
  these two. **Country routes are never gated.**
- **Read-only coverage report:** `app/seo_coverage.py` (`compute_coverage(bind, *, country=None)`) +
  `app/imports/seo_coverage_cli.py` + `.github/workflows/seo-coverage-report.yml` (manual dispatch,
  **no inputs**, Class B `ubuntu-latest`, shares the `boundary-load-production` concurrency group).
  Runs under a **session advisory lock → `READ ONLY REPEATABLE READ` snapshot** (lock acquired +
  committed *before* the read so the snapshot is fixed after the lock wait — see the CLI's
  `collect_locked_coverage`; the ordering is load-bearing and guarded by `test_lock_is_held_during_read`).

## 2. Deployed & verified LIVE (2026-07-04)

- `deploy.yml` on `main` (`a16ef41`) — **succeeded on the 2nd run**. The 1st run failed on a
  **transient** `astral-sh/setup-uv` timeout fetching the uv version manifest from
  raw.githubusercontent.com ("operation aborted due to timeout") — infra flake, not code; a plain
  re-dispatch fixed it. Migration 0017 ran on prod ("Run DB migrations" step green); all rollouts green.
- Live checks: `api.fountainrank.com/healthz` 200 · `/readyz` PostGIS round-trip ok ·
  `GET /api/v1/places?country=us` returns US cities (Manhattan 447, Queens 420, …) → gate allows the
  ready `us` scope, **no regression** · cities sitemap still lists US cities.
- **`seo-coverage-report.yml` dispatched against prod → success.** Live report (run `28722727090`):
  - **us**: ready, 24,465 in-country, **18,529 city-matched (75.7% coverage)**, 5,936 country-only,
    all matched on `locality`, `invalid_boundaries=0`, recommended_ready=True.
    Boundaries: 31,830 locality / 3,134 county / 51 region / 1 country.
  - **lu**: ready, 167 in-country, **167 city-matched (100%)**, all on `county` (LU communes), 0 invalid.
  - **GLOBAL `unmatched_no_country = 25,261`** — fountains in countries whose boundaries aren't loaded.
    This is the actionable signal (see §3): most of our fountains are outside the US/LU scopes.

## 3. Next tasks (pick up here — nothing blocked)

**Biggest exposure levers (owner-local, no repo code — see `docs/runbooks/seo.md` Part B):**
- **Submit `sitemap.xml` to Google Search Console + Bing Webmaster** (#125). The sitemap is live; it
  just needs domain verification + submission. This is the #1 lever and still not done.
- **Finish GA4 wiring** (#128): add the GA4 property id to the local seo-agent registry, run
  `seo_health_check` → GA4 `ok`. (Owner already keeps these values in `claude_help/seo.md` — see §4.)

**Expand coverage (now quantified):** the report shows **25,261 fountains in unloaded countries**.
To turn those into indexable pages: add a row to `.github/boundary-source-regions.yml` (PR) → run
`osm-boundary-load.yml` (dry-run first) → run `seo-coverage-report.yml` → if coverage is good, open the
signoff PR setting that scope's `city_routes_ready=true` on `place_scope_config`. Full flow in
`docs/runbooks/seo.md` Part B.3 + `docs/runbooks/osm-fountain-import.md`.

**Routine / optional (carried forward):**
- Dependabot **#151** (frontend-js) & **#138** (backend-python) — still open.
- Optional cluster hygiene: metrics-server (`kubectl top`/HPA) + pod anti-affinity/topology-spread.
- **Deferred non-blocking Minors** from the Slice-1e reviews (a future 1-PR cleanup, none urgent):
  (a) `places.py` logs the same `"places served"` message for both the not-ready and country-not-found
  zero-result cases (distinguished only by `scope_ready`/`country_found` extra fields);
  (b) `seo_coverage.py` pins `AND cpb.subtype='country'` on one join but not its siblings (identical
  results — cosmetic);
  (c) `web/app/sitemap.test.ts` empty-cities test uses a single country (a second ready-with-cities
  country would prove *selective* exclusion).

## 4. ⚠️ `claude_help/seo.md` is on PUBLIC main

The owner committed `claude_help/seo.md` (`a16ef41`) — operational seo-agent notes containing the
**GA4 property id, GCP project id/number, and service-account email** (credential *paths* only, no raw
keys). This repo is **public**, so those identifiers are now publicly visible. If unintended, scrub +
`.gitignore` it; otherwise it's the owner's on-record decision. (It has no effect on the deployed app.)

## 5. Env / process notes (carried forward)

- **Backend local checks (Windows):** the repo `backend/.venv` is Codex's WSL env and breaks `uv run`
  here. Use an **isolated `UV_PROJECT_ENVIRONMENT`** (a Windows path outside the repo), `uv sync` once,
  then from `backend/`: `uv run ruff check . && uv run ruff format --check . && uv run alembic upgrade
  head && uv run alembic check && uv run pytest` (this session: **633 passed**). `run.ps1` uses the
  default `.venv`, so it fails here. **Use `ruff format`, NOT `black`** (the global CLAUDE.md says
  black; this backend is ruff — a subagent got bitten by that).
- **JS/web can't run on this host** (web/mobile `node_modules` are Codex's WSL install); the CI
  `workspace-js` job is the gating web verification.
- **Deploy is a manual dispatch** (`gh workflow run deploy.yml --ref main`) — merge to main does NOT
  deploy. Watch for the transient `setup-uv` manifest-fetch timeout; just re-dispatch if it hits.
- **Codex gate** (bypass mode, WSL `cwd` `/mnt/d/repos/fountainrank`, repo-relative paths): every
  spec/plan/PR loops to `VERDICT: APPROVED`; artifacts in `temp/codex-reviews/` (gitignored).
- This slice was built via **subagent-driven development** (fresh implementer per task + per-task
  spec/quality review + a whole-branch review), ledger at `.superpowers/sdd/progress.md` (gitignored).
