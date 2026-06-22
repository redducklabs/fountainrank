# Handoff — OSM fountain ingestion live + mobile map fixes (2026-06-22)

## TL;DR

OSM/Protomaps fountain ingestion is **designed, built, merged, deployed, and live**: **~360 San Diego fountains** are on the production map, rateable, rendering as standard unrated pins. The mobile map (basemap + fountains) is **fixed and verified on Android Chrome + Firefox**. The large-scale (state→US→world) import path is **designed + Codex-approved** and tracked in **issue #48**, ready to implement next. `main` HEAD = **`fd97309`**; production is healthy.

Everything below is verified-live state + a resume guide so a fresh conversation can continue.

---

## What shipped this session (all merged to `main`, squash, Codex-approved, CI-green)

| PR | What |
|---|---|
| **#45** | OSM ingestion backend: `created_source`/`is_hidden`/nullable owner + `fountain_provenances`/`osm_fountain_import_runs`/`osm_fountain_import_candidates`/`fountain_import_events` (migration `0004`); parser (`app/imports/osm.py`); merge service (`app/imports/merge.py`) — idempotent, advisory-lock-serialized, scope-limited removal, durable events, rollback, dry-run; `is_hidden` visibility filter; typed `409` duplicate body; importer CLI (`app/imports/cli.py`). Closed issue #34. |
| **#46** | Operator import workflow `.github/workflows/osm-import.yml` (Overpass bbox → backend-pod exec) + `app/imports/overpass.py` converter. |
| **#47** | Design doc `docs/specs/2026-06-21-osm-pbf-large-scale-import-design.md` (Geofabrik/osmium large-scale path), Codex Loop A approved. |
| **#49** | `map.on('error')` capture + `?debug` map diagnostics overlay (web). |
| **#50** | Cache-bust basemap style URL (`style.light.json?v=2`) — fixes stale-cached pmtiles style. |
| **#51** | Harden bbox request-id (crypto.randomUUID fallback) + surface fetch error/api-base in `?debug`. |
| **#52** | **Inline `NEXT_PUBLIC_API_BASE_URL`** via literal `process.env` access — fixes prod web calling `localhost:3021` for the API. |

Also released **`v0.6.0`** (tag) which carried #45/#46 + Deploy B (the Phase-3 web that dropped the client-side pmtiles protocol). Design spec for ingestion: `docs/specs/2026-06-21-osm-fountain-ingestion-design.md`; plan: `docs/plans/2026-06-21-osm-fountain-ingestion.md`. Backend tests: 178 passing locally + CI.

---

## Current production state (verified live 2026-06-22 ~05:35 UTC)

- **Map renders on mobile + desktop** (Android Chrome + Firefox confirmed by the owner). Basemap = go-pmtiles tile server (`fountainrank.com/tiles`) via TileJSON style on the CDN.
- **Fountains load + render**: ~360 imported San Diego fountains (`is_working=true`, unrated). The live bbox API returns them; pins show.
- **Backend live**: `api.fountainrank.com` healthy; migration `0004` applied in prod.
- Probes (all 200/expected): `fountainrank.com/`, `/tiles/planet.json`, a z14 `.mvt`, `api.fountainrank.com/readyz`, `/api/v1/rating-types`, `/api/v1/fountains/bbox`.
- Latest deploy run: **27931426457** (workflow_dispatch, sha `fd97309`).

### The two mobile bugs that were fixed (for context — both RESOLVED)
The "mobile map doesn't work" was **two unrelated bugs, neither GPU/Firefox-related** (mobile WebGL2 is fine — Adreno 650):
1. **Gray basemap** — browsers had a **cached old `style.light.json`** pointing at the removed `pmtiles://` protocol (served `max-age=86400`, no version in the URL). Fixed by versioning the style URL (#50). `BASEMAP_STYLE_VER` in `deploy.yml` — bump it on any future style source/content change.
2. **"Couldn't load fountains"** — **prod web called `http://localhost:3021`** for the API (dev default), not `https://api.fountainrank.com`. Masked because desktop testers run a local backend on :3021. Root cause: `resolveApiBaseUrl` used aliased/bracket `process.env` access, which Next.js doesn't inline into the client bundle. Fixed (#52).

A **`?debug` diagnostics overlay** is live (visit `fountainrank.com/?debug`): shows GPU renderer, resolved API base, basemap tiles-seen/sourceLoaded, and captured MapLibre + bbox-fetch errors. **Consider removing it** (or keeping it gated) once stability is confirmed — it's invisible to normal users.

---

## Next steps (prioritized)

1. **Implement OSM PBF large-scale import — issue #48** (design approved in #47). Geofabrik `.osm.pbf` → `osmium tags-filter`/`export` → id-decode/dedup normalizer (`osmium_geojson.py`) → backend-pod import, with a committed region registry (`.github/osm-import-regions.yml`) + mandatory `scope_bounds` from the extract `.poly`. First target: **California** (it re-owns the San Diego bbox scope and proves the path scales). This is the path to US → world.
   - Interim: import more SoCal metros now via the existing bbox workflow — `gh workflow run osm-import.yml -f bbox="S,W,N,E" -f scope_id="us/ca/<metro>" -f dataset="overpass:<metro>" -f label="<Name>" -f dry_run=true` (then `dry_run=false`).
2. **Fix the empty-state pill wrap — issue #53** (just filed; cosmetic). `web/components/map/MapStates.tsx` `EmptyHint`/`CapHint`: inline `rounded-full` span breaks across line-boxes on narrow viewports → use `inline-block whitespace-nowrap` (and/or `max-w-[90vw] text-center`).
3. **Structured fountain data cluster — #38–#43** (attributes, rating/attribute flow, operational status + verification, notes/reviews, access context, filters) and **#44** (extensible place ratings for restrooms). These are per-user consensus-observation models; the OSM import deliberately defers tag→attribute mapping to a follow-up that consumes the preserved `source_tags` (see ingestion spec §4.3).
4. **bbox 500 on whole-globe — #20** (latent; good hygiene now that the table has data; not user-reachable due to client zoom-gating).
5. **Dependabot PRs**: #22 (frontend-js) **fails CI** — needs fixing; #15 (backend-python) and #1 (actions/checkout) are green but stale-based and unreviewed — rebase + Codex + merge when ready.
6. **Other enhancements**: #19 geocoding/place-search, #18 dark mode (incl. dark basemap flavor), moderation cluster #10–#13.
7. **Follow-ups noted in code/docs**: shorten the basemap style `Cache-Control` in `basemap-upload.yml` for faster future style propagation; remove the `?debug` overlay if no longer needed; the deferred OSM-tag→attribute mapping pass.

---

## Operational context (read before deploying / importing)

- **Deploy** = a release tag push (`vX.Y.Z`) **or** `gh workflow run deploy.yml` (workflow_dispatch builds `main` HEAD). Always from CI — never local. Migrations run via `kubectl exec` into the backend pod inside the deploy.
- **OSM import** = `gh workflow run osm-import.yml` (operator/CI only; `production` environment gate; `dry_run` defaults true). Runbook: `docs/runbooks/osm-fountain-import.md`. Rollback by run id: `app.imports.merge.rollback_run` (hides inserts, never deletes user rows/ratings).
- **Rollback the San Diego import if ever needed**: its run_id was `4ac9d9f2-f996-4654-8b1d-25ab2ace57a0` (scope `us/ca/san-diego`, bbox/Overpass). Note: per the PBF design, this bbox scope is a **bootstrap that the future California PBF import will re-own**, then retire.
- **Local `node_modules` is in a broken state** on the dev box (a Windows EPERM file-lock during pnpm reconcile — a held handle on `mobile/node_modules`, likely an editor/expo process; do NOT blanket-kill it per the owner's standing rule). Consequence: **local web `eslint`/`tsc`/`next build` and `./run.ps1 check -Web` cannot run** — rely on CI for web checks. Backend checks (`./run.ps1 check -Backend`, uv/.venv) work fine. A clean `pnpm install` once the lock-holder is closed will repair it.
- **Process unchanged**: branch → PR → CI green + Codex `VERDICT: APPROVED` + every PR comment addressed → squash-merge (see `claude_help/codex-review-process.md`). Run Codex in bypass mode with the WSL-derived `cwd`. For re-reviews of the SAME artifact use `codex-reply` on the same thread; for a NEW artifact start a FRESH `codex` session (a bloated thread stalls).

## How to resume (copy-paste)

```bash
# Confirm prod is healthy
curl -s -o /dev/null -w "web:   %{http_code}\n" "https://fountainrank.com/"
curl -s -o /dev/null -w "tiles: %{http_code}\n" "https://fountainrank.com/tiles/planet.json"
curl -s -o /dev/null -w "api:   %{http_code}\n" "https://api.fountainrank.com/readyz"
curl -s "https://api.fountainrank.com/api/v1/fountains/bbox?min_lat=32.55&min_lng=-117.10&max_lat=32.70&max_lng=-116.95" | python3 -c "import json,sys;print('SD-area fountains:',len(json.load(sys.stdin)))"
# State
gh issue list --state open -L 30
git -C . log --oneline -8 origin/main
```

**Key artifacts**: ingestion spec `docs/specs/2026-06-21-osm-fountain-ingestion-design.md` · ingestion plan `docs/plans/2026-06-21-osm-fountain-ingestion.md` · PBF design `docs/specs/2026-06-21-osm-pbf-large-scale-import-design.md` · runbook `docs/runbooks/osm-fountain-import.md` · importer `backend/app/imports/{osm,merge,cli,overpass}.py` · import workflow `.github/workflows/osm-import.yml` · Codex reviews under `temp/codex-reviews/` (gitignored).
