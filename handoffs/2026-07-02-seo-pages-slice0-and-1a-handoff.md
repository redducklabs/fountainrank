# Crawlable SEO pages (#127) — Slice 0 decided + Slice 1a merged — handoff (2026-07-02)

**Source:** the session that executed the **Codex-approved plan** `docs/plans/2026-07-02-crawlable-seo-pages.md`:
ran the **Slice 0** boundary-source spike (decision merged) and shipped **Slice 1a** (the
`place_boundaries` table, PR #155 merged). Next task is **Slice 1b — the Overture loader.** This
supersedes `2026-07-02-rankings-seo-fixes-and-mobile-deploy-handoff.md` for the #127 items; that
handoff still holds the shipped-PR context (#152/#153/#154) and the owner checklist reproduced below.

---

## ✅ Shipped this session (both on `main`)

| Change | Commit / PR | What |
|---|---|---|
| **#127 Slice 0** — boundary-source decision | `23f8b51` (docs, direct to `main`) | Chose **Overture Divisions `division_area`**, loaded via **DuckDB from anon public S3** (release-pinned). Amended the spec (**new §11** decision note + "Superseded by §11" notes on §4.1/§4.2/§4.4/§5/§8), rewrote plan **Slice 1** around Overture, committed a validated sample `docs/specs/2026-07-02-crawlable-seo-pages-slice0-sample.geojson`. **Codex spec-review APPROVED** (round 2). |
| **#127 Slice 1a** — `place_boundaries` table | **PR #155** → squash `4f00541` | `PlaceBoundary` model + reversible Alembic **`0014`** + 8 tests. CI green, **Codex PR-review APPROVED** (round 2). |

## 🧭 The Overture decision in one paragraph (so you don't re-derive it)
Fountains have no name/address; place names come from **geometry we own** (spec §2). We load
**Overture Divisions `division_area`** (ODbL + CC0, global, GeoParquet on anon S3) once into
`place_boundaries` and derive country + city pages by `ST_Covers` point-in-polygon. **Non-obvious
truths proven on real data (spec §11.2):** identity is the **Overture GERS `overture_id`, NOT an OSM
id**; the city tier is a **`subtype`** (`locality`/`localadmin`, or `county` where a country has no
locality tier — Overture `admin_level` is *normalized* 0/1/2…, **not** OSM's 2/4/6/8, and is NULL at
`locality`); filter **`class='land'`** (one area per division, 1:1); geometry is **0% invalid** but
Overture mixes `Polygon`/`MultiPolygon` so the loader must **`ST_Multi`-coerce**; OSM `(type,id)` is
**nullable best-effort provenance** decoded from `sources[]` (prefer relation>way>node,
`^([nwr])(\d+)@\d+$`, drop `@version`). Full contract: **spec §11.4–§11.6**.

## ▶️ NEXT: #127 Slice 1b — the Overture loader (start here)
Per `docs/plans/2026-07-02-crawlable-seo-pages.md` → **Slice 1** (1a is done; do **1b**, then 1c/1d/1e):
consume DuckDB-fetched `division_area` (release-pinned, `class='land'`); **upsert idempotently on
`overture_id`**; `ST_Multi`-coerce + `ST_MakeValid` guard; set `subtype`/`class`/`admin_level`; derive
`country_code` (see the casing note below) + a sticky `slug` from `names.primary`; decode OSM
provenance into nullable `osm_type`/`osm_id`; `parent_id` is **containment-derived** (Slice 1d), NOT
Overture's hierarchy (do **not** load the point `division` type). **Fixtures (real Overture shape): a
`Polygon` feature + a `MultiPolygon` feature, a feature with NO OSM source, and a multi-entry
`sources[]` decode.** Pure extraction/slug/collision/provenance-decode logic unit-tested. The
`a<2*rel+1>` area-id round-trip test stays on the **fallback** osmium path only (spec §11.7), not here.
- **Codex's Slice-1b watch-item (from the spec review):** `country_code` casing is a loader contract —
  the model stores it lowercased to match the URL segment (`/drinking-fountains/[country]`); normalize
  to lowercase **before insert** so canonical `(country_code, slug)` uniqueness isn't split by case.

## 🛠️ Environment + tooling that WORKS here (don't rediscover)
- **Backend local checks on Windows:** the repo `backend/.venv` is **Codex's WSL (POSIX) venv** and
  breaks `uv run` on Windows (memory [[fountainrank-windows-wsl-local-check-workarounds]]). Use an
  **isolated `UV_PROJECT_ENVIRONMENT`** (a Windows path *outside* the repo, e.g. under the session
  scratchpad): `export UV_PROJECT_ENVIRONMENT=<path>` then `uv sync` once, then
  `uv run ruff check . && uv run ruff format --check . && uv run alembic upgrade head && uv run alembic check && uv run pytest` from `backend/`. This is the exact `./run.ps1 check -Backend` mirror (run.ps1 itself uses the default `.venv`, so it fails on Windows here).
- **DB:** `./run.ps1 up` starts `postgis/postgis:17-3.5` on **:5436** (the backend's default
  `DATABASE_URL`). It was up this session.
- **Overture validation harness (reusable for Slice 1b), all via Docker — no local installs:**
  `python:3.12-slim` + `pip install duckdb` (`INSTALL/LOAD spatial,httpfs; SET s3_region='us-west-2'`)
  reads Overture **anonymously** (confirmed — no creds, no requester-pays); `postgis/postgis:17-3.5`
  for `ST_MakeValid`/`ST_Covers` parity with CI; `ghcr.io/osgeo/gdal:ubuntu-full-latest` for
  Parquet-capable `ogr2ogr`. Concrete path + query shape are in **spec §11.3**
  (`s3://overturemaps-us-west-2/release/2026-06-17.0/theme=divisions/type=division_area/*.parquet`).
- **Migration/model conventions:** `backend/app/models.py` `NAMING_CONVENTION` (short CHECK names),
  Geography via `geoalchemy2` (`spatial_index=True` auto-creates `idx_<table>_<col>`), partial index via
  `postgresql_where=text(...)`; migration mirrors the model or `alembic check` flags drift. `0014` is
  the reference for a Geography + partial-unique + self-FK table; migration tests assert names in
  `pg_indexes`/`pg_constraint` (see `tests/test_place_boundaries_migration.py`).

## 🔁 Process gate (unchanged — per `CLAUDE.md`)
branch → PR → **CI green AND Codex `VERDICT: APPROVED` AND every PR comment addressed** →
**squash-merge**. Codex in **bypass mode** (`sandbox:"danger-full-access"`, `approval-policy:"never"`),
WSL `cwd` `/mnt/d/repos/fountainrank`, **repo-relative paths**, loop until APPROVED; review artifacts in
`temp/codex-reviews/` (gitignored: spec `…-design-spec-review-N.md`, PR `pr-<N>-review-N.md`). **Slice 0
was a spec amendment (doc-only) committed direct to `main`; every code slice is a PR.** New UI →
`docs/style-guide.md`. **No AI attribution, no time estimates.**

## 📋 Carried-forward owner actions (from the prior handoff — still open, owner-gated)
- [ ] **On-device verify** #149, #146, #147 (in the TestFlight/Play build from the prior session) → close them; also #102–105, #120.
- [ ] **Deploy web** (manual — `gh workflow run deploy.yml --ref main`, [[fountainrank-deploy-is-manual-dispatch]]): ships the merged #125/#126 robots.txt + sitemap.xml + www→apex + canonical (still NOT live). Then `curl -I` robots/sitemap (200) + `www.` (308→apex), and **submit the sitemap to GSC + Bing** (#125). *(None of the #127 Slice 0/1a work is web-facing yet — no deploy needed for it.)*
- [ ] **#128 GA4:** add the GA4 property id to the SEO agent's **local** registry (no secrets committed); `seo_health_check` → GA4 `ok`. Repo scope is nil (GA4 already installed).
- [ ] Unrelated pending: set `NEXT_PUBLIC_APP_STORE_URL` / `NEXT_PUBLIC_GOOGLE_PLAY_URL` on web deploy once store URLs exist (#135).

## 🔎 Issue status reminder (the memory rule — verify before re-implementing)
Open mobile issues #149/#146/#147/#102–105/#120 are **code-complete on `main`**, open only for
on-device verification ([[fountainrank-verify-code-before-implementing-open-issue]]). #98/#99 done.
