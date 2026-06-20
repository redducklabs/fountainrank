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

## 🚧 DEPLOY IS BLOCKED ON THE OWNER (do these, then tag a release)

The merged code builds + tests green WITHOUT these, but the deployed map will not render until:

1. **Pin PNG assets** → `web/public/pins/`: `pin-standard.png` (#3), `pin-selected.png` (#1), `pin-gold.png` (#4), `pin-broken.png` (#3 + red slash composited), and `pill-bg.png` (small white rounded-rect, stretchable; the `MapBrowser` `addImage` stretch coords are `[6,14]`/`content [6,6,14,14]` — match the asset). Export from `docs/logos/pin-only-logo-sheet.png`, transparent, ~2–3×, tip = bottom anchor. (Plan Task 11.) NOTE: there are 3 untracked WIP files in `docs/logos/` (`512-pin.png`, `512-pin.xcf`, `feature-graphic.png`) — not the named exports; not committed.
2. **Basemap hosting + infra** (Plan Task 20, issue context):
   - Upload a Protomaps daily-build **planet `.pmtiles`** + the **Light style JSON + glyphs + sprite** to a DO Spaces bucket fronted by the CDN. The hosted style JSON must embed its source as `pmtiles://<NEXT_PUBLIC_BASEMAP_PMTILES_URL>`.
   - Set `NEXT_PUBLIC_BASEMAP_STYLE_URL` (+ `_PMTILES_URL`) for the web deploy.
   - Terraform must manage the Spaces bucket/CDN + **CORS rules** (web origins, `GET`/`HEAD` + `Range`, expose `Accept-Ranges`/`Content-Range`/`Content-Length`) — this needs a **bucket-create-capable Spaces key** as a CI secret; the current key can't create buckets, so `infra/terraform/main.tf` (~L220-226) currently defers Spaces. Apply via CI (never local `apply`).
3. **Post-deploy smoke:** confirm the map loads pins cross-origin (API CORS) and renders tiles cross-origin with range requests (CDN). `docs/setup/README.md` → "API CORS for the web map" has the OPTIONS/GET smoke commands.

Then: owner-gated `v*.*.*` tag → `deploy.yml`.

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
