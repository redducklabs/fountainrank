# Handoff — FountainRank Phase 3a (web map browsing) — MERGED, NOT YET DEPLOYED

**Date:** 2026-06-20
**State:** Phase 3a code is **merged to `main`** (squash `26915e2`, "feat: Phase 3a — public web map browsing (#21)"). It is **not deployed** — deploy is owner-gated and **blocked on owner deliverables** (below).
**Supersedes:** `handoffs/2026-06-20-phase3a-map-browsing-brainstorm-handoff.md` (the brainstorm is done; spec + plan are written, Codex-approved, and implemented).

---

## What shipped (PR #21, all gates green)

Full cycle: brainstorm → spec (`docs/specs/2026-06-20-web-map-browsing-design.md`, Codex Loop A APPROVED) → plan (`docs/plans/2026-06-20-web-map-browsing.md`, Codex Loop A APPROVED) → subagent-driven implementation (19 tasks, each TDD'd + reviewed) → final whole-branch review (READY) → PR #21 → **CI green + Codex Loop B `VERDICT: APPROVED` + all comments addressed** → squash-merge.

- **Backend:** `ranking_score` on the bbox + nearby pin payload (`FountainPin`); detail `dimensions[]` ordered by `RatingType.sort_order`; api-client regenerated. (+ tests, incl. a `max_results==500` pin mirrored web↔backend, and a CORS prod-origins guard.)
- **Web map** (`web/lib/map/*`, `web/components/map/*`): MapLibre GL JS + `pmtiles` on a self-hosted Protomaps **Light** basemap; auto-geolocate + locate control (fallback to a US default view); custom pins via GL symbol layers — standard #3 / gold (`ranking_score > 4`) #4 / broken (red slash) / selected #1 + halo, status = shape+color (colorblind-safe); gold ★rating pill at near zoom; brand-blue cluster bubbles; debounced bbox fetch with bounds normalization (lat clamp, lng wrap, antimeridian skip), ~z10 min-zoom gate, honest cap hint, and loading/empty/error states (the error toast now fires on any non-2xx; a sequence guard prevents stale viewport overwrites).
- **Detail** (`web/components/fountain/*`, `web/app/fountains/[id]`, `web/app/@modal/(.)fountains/[id]`): real SSR `/fountains/[id]` route (indexable; 404→HTTP404) surfaced as a focus-trapped overlay (side panel / bottom sheet) via parallel + intercepting routes — map stays mounted; graceful "couldn't load" on non-404 / network throw; `X-Request-ID` correlation.
- **Accessible** "fountains in view" list (GL pins aren't tabbable) and the homepage hero band + map at `/` (replaced "coming soon"; metadata updated). Style guide updated for all new UI.

Tests: full local CI mirror (`./run.ps1 check`) + remote CI both green. Pure logic unit-tested; the shipping `SELECTED_ICON_EXPR` is behaviorally tested via MapLibre's `createExpression` evaluator.

---

## Deploy prep — DONE in #23 (92202ae) / remaining owner-only steps

**Done in #23 (merged):**
- **Pin assets** committed (`web/public/pins/{pin-standard,pin-gold,pin-selected,pin-broken,pill-bg}.png`), derived from `docs/logos/512-pin.png` (now committed) via `scripts/gen-pin-assets.py` — swappable for bespoke art (referenced by name in `web/lib/map/style.ts`; no code change).
- **Gated basemap Terraform** (`infra/terraform/main.tf`): `digitalocean_spaces_bucket.basemap` + `digitalocean_spaces_bucket_cors_configuration` (GET/HEAD, `Range`, exposes `Accept-Ranges`/`Content-Range`/`Content-Length`/`ETag`) + `digitalocean_cdn`, all behind `var.manage_basemap_spaces` (default **false** → no-op; manual-apply only). The `terraform.yml` apply workflow has a `manage_basemap_spaces` dispatch input wired to `TF_VAR_manage_basemap_spaces`.
- **Runbook**: `docs/setup/README.md` → "Basemap hosting" has the full owner steps + the CORS smoke (now a regional bbox, not the #20 global-500 case).

**Remaining owner-only (the deployed map renders once these are done):**
1. **Create a bucket-create-capable DO Spaces key** (the current key 403s on bucket-create); set it as the Terraform apply job's `SPACES_ACCESS_KEY`/`SPACES_SECRET_KEY` (`production` env). Confirm the TF-state S3 backend still authenticates with it.
2. **Dispatch the Terraform workflow** (`action=apply`, `manage_basemap_spaces=true`) → creates the bucket/CDN/CORS. Record the `basemap_cdn_endpoint` output.
3. **Upload** the planet `.pmtiles` + Light style/glyphs/sprite (public-read) and point the style's vector source at `pmtiles://<cdn>/planet.pmtiles` — exact `aws s3 cp` commands in the runbook.
4. **Set** `NEXT_PUBLIC_BASEMAP_STYLE_URL` + `_PMTILES_URL` for the web deploy (env var names only; never `.env`).
5. **Smoke** a cross-origin range request (206 + range headers) and load `/`. Then tag the owner-gated `v*.*.*` release → `deploy.yml`.

(Untracked WIP still in `docs/logos/`: `512-pin.xcf`, `feature-graphic.png` — intentionally not committed.)

---

## Tracked follow-ups (GitHub issues)
- **#18** — dark mode (deferred from 3a; light-only ships, but the basemap flavor is a single swappable config + pin assets are swappable, so it's cheap to add).
- **#19** — place search / geocoding (deferred from 3a).
- **#20** — pre-existing backend 500 on a whole-globe bbox (NOT reachable by the 3a client — the min-zoom gate prevents world-scale requests; out of 3a scope).

---

## Next sub-project: Phase 3b (contribute)
Add-a-fountain (location pick + inline rating + 409 proximity handling) + rate-an-existing-fountain from the detail panel. Reuses 3a's map + detail overlay + the existing **auth BFF** (`web/lib/server/api.ts` `getAuthedApiClient`). The detail panel already notes "Rate this fountain arrives in Phase 3b." Follow the same cycle: brainstorm → spec (Codex Loop A) → plan (Codex Loop A) → subagent-driven implement → PR → CI + Codex Loop B → squash-merge → owner-gated deploy.

## Process notes (carry forward)
- Backend checks: `./run.ps1 check -Backend` (not bare pytest). Web: `./run.ps1 check -Web [-Fast]`. Full mirror: `./run.ps1 check`.
- `run.ps1 generate` can hit a no-TTY pnpm purge prompt in Git Bash; prefix pnpm cmds with `CI=1` if they prompt. api-client `openapi.json` + `schema.d.ts` are gitignored (regen via the turbo `generate` build-dep).
- Web typing: `@types/geojson` is a UMD namespace that needs a `/// <reference types="@types/geojson" />` at the top of files using `GeoJSON.*` (pins.ts, layers.ts) under `moduleResolution: bundler`. vitest uses `globals: true` for RTL auto-cleanup. Codex (WSL) reviews can leave a stale `.next/types/routes.d.ts` locally — harmless; CI regenerates.
