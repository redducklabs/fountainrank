# Crawlable SEO pages (#127) — Slice 1c merged — handoff (2026-07-02)

**Source:** the session that executed **Slice 1c** of the Codex-approved plan
`docs/plans/2026-07-02-crawlable-seo-pages.md` — the **`osm-boundary-load.yml` CI workflow** (the
CI-only production write path for boundaries). Next task is **Slice 1d — mandatory precomputed
membership** (fountain → canonical city + country). Supersedes
`2026-07-02-seo-pages-slice-1b-handoff.md` for the #127 items; the carried-forward owner checklist
(reproduced below) still holds.

---

## ✅ Shipped this session (on `main`)

| Change | Commit / PR | What |
|---|---|---|
| **#127 Slice 1c** — boundary-load workflow | **PR #158** → squash `5a58fd2` | CI-only production boundary-load path. CI green, **Codex APPROVED** (round 2). |
| Mobile: drop clipped "Add" FAB label (iOS) | **PR #157** → squash `fc6711a` | Removed the `<Text>Add</Text>` under the center "+" FAB (clipped on iOS large safe-area inset); accessibilityLabel kept. **Owner: verify on-device on the next TestFlight build.** |

**Slice 1c — three new files (workflow mirrors `osm-import-pbf.yml`; validator mirrors `regions.py`):**
- **`.github/workflows/osm-boundary-load.yml`** — manual-dispatch, `ubuntu-latest` (Class B, cluster
  creds), `environment: production`, concurrency group `boundary-load-production`. Steps: validate
  registry (before any remote read) → install pinned **DuckDB 1.5.4** in an isolated venv → fetch
  `division_area` from **anonymous public S3** (`country` + `class='land'` predicate pushdown; §11.3
  query — `id AS overture_id`, `names.primary AS name`, `ST_Multi(geometry)`) → `doctl` auth →
  `kubectl exec` the deployed `app.imports.boundary_cli` in the backend pod. **`dry_run` defaults
  true.** The loader does the PostGIS validity gate in its own write transaction (no separate
  workflow postgis service — deliberate; Codex-approved).
- **`.github/boundary-source-regions.yml`** — the boundary-source registry (independent of
  `.github/osm-import-regions.yml`). Rows: `scope_id`, `country` (ISO alpha-2, UPPERCASE),
  `overture_release_id`, `status`. **Seeded: `overture:us` (US) + `overture:lu` (LU), both pinned to
  `2026-06-17.0`.** One `active` row per `scope_id`; the dispatched release MUST equal the row's pin.
- **`backend/app/imports/boundaries_registry.py`** — pure/stdlib fail-closed validator, file-invocable
  from CI. `validate_boundary_scope(rows, *, scope_id, release_id)`: bind to one **active** row;
  reject unknown/retired/ambiguous scopes, a release ≠ the scope's pin, a row missing a required key,
  and bad syntax (allow-lists scope/release/country). Emits the row's `country` (`--emit-country`).
  The S3 path is **built from the regex-validated release id** → arbitrary S3/HTTP path impossible.
  Tested in `backend/tests/test_boundaries_registry.py` (plain-dict rows; mirrors `test_regions.py`).

## ⚙️ How to run the boundary load (owner-gated — needs a deployed backend pod)
`gh workflow run osm-boundary-load.yml -f scope_id=overture:lu -f overture_release_id=2026-06-17.0`
(dry-run defaults true). **Smoke-test with `overture:lu` (365 land divisions) first**, confirm the
loader's found/inserted/updated/skipped JSON summary + skip-reason histogram in the pod logs, then
`overture:us` (~59k). Re-dispatch with `dry_run=false` to actually write `place_boundaries`. To pin a
newer Overture release: edit the registry row (a reviewed PR) then dispatch — "pin, never chase".

## ▶️ NEXT: #127 Slice 1d — mandatory precomputed membership (start here)
Per plan → Slice 1 (1a/1b/1c done; do **1d**, then 1e). Assign each fountain to its **canonical**
city + country place (spec §5, §11.5):
- **City-assignment ladder (§11.5, binding):** among the covering `division_area` rows whose
  `subtype` is in the scope's **eligible-city set** (default `{locality, localadmin}`; a scope opts
  in `county` where its municipal tier is `county` — e.g. **LU communes**), pick the highest-priority
  subtype (`locality`>`localadmin`>`county`), **smallest-area on ties**. **Unmatched points → country
  only, never a coarser forced tier.**
- **`parent_id` by containment (`ST_Covers`), NOT Overture hierarchy** (we didn't load the point
  `division` type). Store `country_place_id`/`city_place_id` (or `fountain_places`) + denormalized
  `fountain_count`; pick the canonical place per `(country_code, slug)` via **`is_canonical`** (§4.3,
  tie-break by `fountain_count`). Deterministic refresh on boundary load, OSM import, and user add;
  transactional count updates. Backfill job.
- **Tests (per Codex spec-review):** overlapping tiers (`locality` inside `county`), slug collisions
  across subtypes, a scope with **partial** locality coverage, an **unmatched** point → country-only,
  plus counts + refresh correctness on a fixture.
- Then **1e** — coverage report/gate (per-scope boundary count, matched/unmatched, city-assignment %
  by subtype; a scope's city routes are "ready" only above a threshold / with owner signoff, which
  also sets that scope's eligible-city subtype set).

## 🛠️ Environment + tooling that WORKS here (unchanged — don't rediscover)
- **Backend local checks on Windows:** the repo `backend/.venv` is Codex's WSL venv and breaks
  `uv run` on Windows ([[fountainrank-windows-wsl-local-check-workarounds]]). Use an **isolated
  `UV_PROJECT_ENVIRONMENT`** (a Windows path outside the repo, e.g. under the session scratchpad):
  `export UV_PROJECT_ENVIRONMENT=<path>`, `uv sync` once, then from `backend/`:
  `uv run ruff check . && uv run ruff format --check . && uv run alembic upgrade head && uv run alembic check && uv run pytest`
  (this session: **543 passed**, no drift). `run.ps1` itself uses the default `.venv`, so it fails here.
- **JS tooling can't run on this Windows host** (mobile `node_modules` are Codex's WSL install →
  eslint EACCES, vitest missing win32 native binding). Mobile lint/test/typecheck are covered by CI
  (`workspace-js` + `mobile-doctor`); local `tsc` can be run via the store copy if needed.
- **DB:** `./run.ps1 up` runs `postgis/postgis:17-3.5` on **:5436**; it was up this session.
- **Overture release pin:** `2026-06-17.0` was the Slice-0-vetted release **and** is the current
  DuckDB latest-stable pin (1.5.4) — no version tension.

## 🔁 Process gate (unchanged — per `CLAUDE.md`)
branch → PR → **CI green AND Codex `VERDICT: APPROVED` AND every PR comment addressed** →
**squash-merge**. Codex in **bypass mode** (`sandbox:"danger-full-access"`, `approval-policy:"never"`),
WSL `cwd` `/mnt/d/repos/fountainrank`, **repo-relative paths**, loop until APPROVED; artifacts in
`temp/codex-reviews/` (gitignored). **Doc-only changes (specs/handoffs) commit direct to `main`;
every code slice is a PR.** New CI workflow / infra → read `claude_help/kubernetes-infra.md` +
`claude_help/github-environments.md` first. **No AI attribution, no time estimates.**

## 📋 Carried-forward owner actions (still open, owner-gated)
- [ ] **Dispatch the boundary load** (this slice): `overture:lu` dry-run → `overture:us` dry-run →
  `dry_run=false`. Needs the backend deployed to the cluster (the workflow `kubectl exec`s the pod).
- [ ] **Verify the mobile "Add" FAB on-device (iOS)** in the next TestFlight build (PR #157).
- [ ] **On-device verify** #149, #146, #147, #102–105, #120 — code-complete on `main`, open only for
  on-device verification ([[fountainrank-verify-code-before-implementing-open-issue]]). #98/#99 done.
- [ ] **Deploy web** (manual — `gh workflow run deploy.yml --ref main`,
  [[fountainrank-deploy-is-manual-dispatch]]): ships merged #125/#126 robots.txt + sitemap.xml +
  www→apex + canonical (still NOT live). Then `curl -I` robots/sitemap (200) + `www.` (308→apex), and
  **submit the sitemap to GSC + Bing** (#125). *(No #127 Slice 0/1a/1b/1c work is web-facing yet.)*
- [ ] **#128 GA4:** add the GA4 property id to the SEO agent's **local** registry (no secrets
  committed); `seo_health_check` → GA4 `ok`. Repo scope is nil.
- [ ] Unrelated pending: set `NEXT_PUBLIC_APP_STORE_URL` / `NEXT_PUBLIC_GOOGLE_PLAY_URL` on web deploy
  once store URLs exist (#135).
