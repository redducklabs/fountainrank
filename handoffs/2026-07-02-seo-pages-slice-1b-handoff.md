# Crawlable SEO pages (#127) — Slice 1b merged — handoff (2026-07-02)

**Source:** the session that executed **Slice 1b** of the Codex-approved plan
`docs/plans/2026-07-02-crawlable-seo-pages.md` — the **Overture `division_area` boundary loader**
(PR #156, squash `fd4d4f6`). Next task is **Slice 1c — the `osm-boundary-load.yml` CI workflow.**
This supersedes `2026-07-02-seo-pages-slice0-and-1a-handoff.md` for the #127 items; that handoff
still holds the Slice-0 Overture decision context + the owner checklist (reproduced below).

---

## ✅ Shipped this session (on `main`)

| Change | Commit / PR | What |
|---|---|---|
| **#127 Slice 1b** — Overture boundary loader | **PR #156** → squash `fd4d4f6` | Pure/DB split loader for `division_area`. CI green, **Codex PR-review APPROVED** (round 2). |

**Three modules (mirror `app.imports.osm` / `merge` / `cli`), all backend-only, no migration
(reuse the Slice-1a `place_boundaries` table):**
- **`backend/app/imports/boundaries.py`** — pure, stdlib-only extraction. `slugify` (NFKD
  ASCII-fold, lowercase, hyphenate), `decode_osm_source` (prefer relation>way>node, **exact spec
  regex `^([nwr])(\d+)@\d+$`**, drop `@version`, nullable; accepts a native list **or** a JSON-string
  `sources[]`), `parse_boundary_geojson` → `BoundaryFeature`. **Enforces `class='land'`** (skips
  non-land with reason `non_land_class`) and **lowercases `country_code`**.
- **`backend/app/imports/boundary_load.py`** — `load_boundaries(session, *, features, dry_run,
  release_id, scope_id)` → `BoundaryLoadSummary`. Idempotent upsert `ON CONFLICT (overture_id)`;
  geometry coerced `ST_MakeValid → ST_CollectionExtract(_,3) → ST_Multi → ::geography`; a geom that
  doesn't survive as a **non-empty MultiPolygon** is flagged + skipped (never inserted). **Sticky
  slug** (never overwritten on update). **Lowercases `country_code` at the insert boundary too**
  (loader is directly callable). **Never sets `is_canonical`** (Slice 1d owns that). Caller commits.
- **`backend/app/imports/boundary_cli.py`** — the loader entry Slice 1c will `kubectl exec`:
  `python -m app.imports.boundary_cli --path <geojson> --overture-release-id <id> --scope-id <scope>
  [--dry-run]`. Reads the DuckDB GeoJSON, parses, upserts in one committed txn, prints a
  machine-readable JSON summary line; structured logs of counts + skip-reason histogram.
- Fixture `backend/tests/fixtures/overture_division_area_sample.geojson` (Polygon + MultiPolygon +
  a no-OSM-source feature + a multi-entry `sources[]` + a `class='maritime'` twin that must be
  dropped) and unit + integration + CLI tests (`test_boundaries_parse.py`, `test_boundary_load.py`,
  `test_boundary_cli.py`).

## 🔌 The loader's input contract (what Slice 1c must feed it — so you don't re-derive it)
The loader consumes a **GeoJSON FeatureCollection**; each feature's `properties` carries:
`overture_id` (GERS id — **alias the DuckDB `id` to `overture_id`** so GDAL doesn't promote a
literal `id` to the feature top level; a top-level `id` is accepted as a fallback), `subtype`,
`class` (must be `land`), `admin_level` (int 0/1/2 or null), `name` (from `names.primary`),
`country` (ISO alpha-2, any case — loader lowercases), and `sources` (the OSM-provenance array,
native JSON list or a JSON string). Geometry is the raw Overture geometry (Polygon **or**
MultiPolygon — the loader coerces). See spec **§11.3–§11.6** for the binding contract; the DuckDB
`SELECT` shape is in **§11.3** (add `AS overture_id` to the `id` column).

## ▶️ NEXT: #127 Slice 1c — `osm-boundary-load.yml` CI workflow (start here)
Per plan → **Slice 1** (1a/1b done; do **1c**, then 1d/1e). Build the **manual-dispatch** workflow
that is the CI-only production write path for boundaries (spec §11.3 "one write rule"):
- **Boundary-source registry** (its **own** small file, independent of `.github/osm-import-regions.yml`)
  recording the pinned **`overture_release_id`** + allowed country scopes. **Inherit the fail-closed
  validation pattern of `backend/app/imports/regions.py`**: allow-list release-id + country-scope
  syntax, **reject arbitrary S3/HTTP paths**, bind the dispatched scope to an **active** row **before
  any remote read**. (regions.py is pure/stdlib + file-invocable — mirror that shape for a new
  `boundaries_registry.py` or extend the concept; unit-test with plain dicts.)
- **Fetch:** install **DuckDB** (+ `spatial`/`httpfs`), read the pinned release from **anon public S3**
  (`SET s3_region='us-west-2'`, no creds) with `country`/bbox **predicate pushdown**, `WHERE
  class='land' AND subtype IN (...)`, emit GeoJSON via the §11.3 query (**alias `id AS overture_id`,
  `names.primary AS name`**, keep `sources`, `ST_Multi(geometry)`).
- **Load:** **`kubectl exec` into the running backend pod** and run `python -m
  app.imports.boundary_cli` there — **mirror `.github/workflows/osm-import-pbf.yml`** (that's the
  reference for the pod-exec production-write pattern, scope-bounds file streaming, and the
  runner/secrets split). PostGIS-validate before the write is already inside the loader (the invalid
  guard). Structured logs of found/inserted/updated/skipped.
- **Runner policy:** the secret-handling deploy/exec job is **Class B → `ubuntu-latest`**; lint/test
  stays on `redducklabs-runners` (see `claude_help/testing-ci.md`).
- **Do NOT** load the point `division` type; `parent_id`/containment + membership is **Slice 1d**.
- The osmium-from-Geofabrik **fallback** (§11.7) is a per-scope escape hatch only — install
  GDAL/`osmium-tool` for it only if you wire it; not required for the Overture primary path.

## 🛠️ Environment + tooling that WORKS here (unchanged — don't rediscover)
- **Backend local checks on Windows:** the repo `backend/.venv` is Codex's WSL venv and breaks
  `uv run` on Windows ([[fountainrank-windows-wsl-local-check-workarounds]]). Use an **isolated
  `UV_PROJECT_ENVIRONMENT`** (a Windows path *outside* the repo, e.g. under the session scratchpad):
  `export UV_PROJECT_ENVIRONMENT=<path>`, `uv sync` once, then from `backend/`:
  `uv run ruff check . && uv run ruff format --check . && uv run alembic upgrade head && uv run alembic check && uv run pytest`.
  This is the exact `./run.ps1 check -Backend` mirror (run.ps1 itself uses the default `.venv`, so it
  fails on Windows here). Slice 1b was backend-only (no OpenAPI/api-client/JS) — CI covered web/mobile.
- **DB:** `./run.ps1 up` runs `postgis/postgis:17-3.5` on **:5436** (the backend's default
  `DATABASE_URL`); it was up this session.
- **Overture validation harness (all via Docker, no local installs):** `python:3.12-slim` +
  `pip install duckdb` reads Overture **anonymously**; `postgis/postgis:17-3.5` for
  `ST_MakeValid`/`ST_Covers` parity; `ghcr.io/osgeo/gdal:ubuntu-full-latest` for Parquet `ogr2ogr`.
  Concrete S3 path + query in **spec §11.3**.

## 🔁 Process gate (unchanged — per `CLAUDE.md`)
branch → PR → **CI green AND Codex `VERDICT: APPROVED` AND every PR comment addressed** →
**squash-merge**. Codex in **bypass mode** (`sandbox:"danger-full-access"`, `approval-policy:"never"`),
WSL `cwd` `/mnt/d/repos/fountainrank`, **repo-relative paths**, loop until APPROVED; artifacts in
`temp/codex-reviews/` (gitignored). **Doc-only changes (specs/handoffs) commit direct to `main`;
every code slice is a PR.** New CI workflow / infra → read `claude_help/kubernetes-infra.md` +
`claude_help/github-environments.md` first. **No AI attribution, no time estimates.**

## 📋 Carried-forward owner actions (from the prior handoff — still open, owner-gated)
- [ ] **On-device verify** #149, #146, #147 (in the prior TestFlight/Play build) → close them; also
  #102–105, #120. These are **code-complete on `main`**, open only for on-device verification
  ([[fountainrank-verify-code-before-implementing-open-issue]]). #98/#99 done.
- [ ] **Deploy web** (manual — `gh workflow run deploy.yml --ref main`,
  [[fountainrank-deploy-is-manual-dispatch]]): ships merged #125/#126 robots.txt + sitemap.xml +
  www→apex + canonical (still NOT live). Then `curl -I` robots/sitemap (200) + `www.` (308→apex), and
  **submit the sitemap to GSC + Bing** (#125). *(No #127 Slice 0/1a/1b work is web-facing yet.)*
- [ ] **#128 GA4:** add the GA4 property id to the SEO agent's **local** registry (no secrets
  committed); `seo_health_check` → GA4 `ok`. Repo scope is nil.
- [ ] Unrelated pending: set `NEXT_PUBLIC_APP_STORE_URL` / `NEXT_PUBLIC_GOOGLE_PLAY_URL` on web deploy
  once store URLs exist (#135).
