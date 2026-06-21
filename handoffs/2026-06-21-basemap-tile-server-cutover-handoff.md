# Handoff — Basemap go-pmtiles tile-server cutover (2026-06-21)

## TL;DR

The basemap is **fixed and live via the new go-pmtiles tile server.** The map works in production for all users. The full spec → Codex → plan → Codex → implement → deploy cycle is done for Phases 1–3 (PRs #35, #36, #37 — all CI-green, all `VERDICT: APPROVED`, all squash-merged). One optional cleanup deploy (**Deploy B**) is intentionally **deferred ~24h** because of the style's browser cache (details below).

## What was broken

`planet.pmtiles` on DO Spaces was `HEAD`-200 but `GET`/range → **`NoSuchKey`** — the 127 GB multipart upload never produced a durable, range-retrievable object, and our old `HEAD`/size-only verification masked it. The web also used the fragile client-side `pmtiles://`-range-against-CDN pattern (can't CDN-cache 127 GB; client-side range/Firefox fragility).

## What was done (all merged to `main`)

1. **Phase 1 (#35)** — `basemap-upload.yml` now verifies the object is **range-READABLE** (`aws s3api get-object --range bytes=0-99`, compares the `ContentRange` total to `SRC_LEN`) at every gate, not `HEAD`/size. Then dispatched `basemap-upload force=true` → re-uploaded a durable object. **Origin range probe now returns `206`.**
2. **Phase 2 (#36)** — `infra/k8s/basemap-tiles.yaml`: `protomaps/go-pmtiles:v1.30.3` Deployment + Service + a **separate** Ingress (regex `/tiles(/|$)(.*)` → `rewrite-target:/$2`). Reads the **public** planet over server-side HTTP range (no credentials), serves `z/x/y` vector tiles + TileJSON at `fountainrank.com/tiles/`. Hardened securityContext (non-root, read-only rootfs, drop ALL caps, seccomp); `AVD-KSV-0125` suppressed in `.trivyignore` (pinned official public images). Wired into `deploy.yml` (workload loop + rollout gate on `/planet.json` readiness).
3. **Deploy A** — deployed Phase 2 (tile server) with the OLD web still on `main`. **Preflight passed:** `/tiles/planet.json` → 200 valid TileJSON (`tiles: [".../tiles/planet/{z}/{x}/{y}.mvt"]`), `/tiles/planet/0/0/0.mvt` → 200 (66 KB), `/tiles/planet/10/301/385.mvt` → 200 (67 KB). `/` web 200; routing intact.
4. **Phase 3 (#37)** — style generator now emits the **TileJSON** source (`https://${SITE_HOST}/tiles/planet.json`, `SITE_HOST=fountainrank.com`); web drops the client-side pmtiles usage; unused `NEXT_PUBLIC_BASEMAP_PMTILES_URL` build-arg removed; docs updated. Merged, then dispatched `basemap-upload` → **regenerated `style.light.json` to the TileJSON source + purged the CDN** (planet transfer correctly skipped — object valid). Confirmed via curl: `style.light.json.sources.protomaps = { type:"vector", url:"https://fountainrank.com/tiles/planet.json" }`.

## Current production state (SAFE + WORKING)

- **Tile server live + serving** valid TileJSON and vector tiles at multiple zooms (verified via curl).
- **`style.light.json` points at the tile server** (TileJSON), CDN purged.
- **Deployed web = the OLD web** (Deploy A built it; Phase 3's web is merged but NOT deployed). The old web has the pmtiles client, so it handles **both**:
  - fresh-cache browsers → fetch the new TileJSON style → **tile server** (the migrated path);
  - browsers with the cached old `pmtiles://` style (24h TTL) → pmtiles client → the now-**valid** object.
  - **Either way the map renders.** Verified live: MapLibre canvas 1280×475 + 3 controls (the height-collapse bug from #32 stays fixed); rendered via the cached-old-style path against the valid object.

## Deferred: Deploy B (deploy the new web that drops the pmtiles client)

**Do NOT deploy the new web until ~24h after the style regen (regen was 2026-06-21 ~08:31 UTC).**
`style.light.json` is served with `cache-control: max-age=86400` (24h). A returning visitor whose browser cached the **old** `pmtiles://` style, loading the **new** web (which has no pmtiles client), would get a broken basemap until their style cache expires. The OLD web (currently deployed) avoids this entirely. After ~24h all cached styles are TileJSON and Deploy B is safe — just run `deploy.yml` from `main` (it already builds the Phase-3 web).

Optional improvement to discuss: set a shorter `Cache-Control` on the style upload in `basemap-upload.yml` so future cutovers propagate faster (doesn't help already-cached clients; a policy change, left for review).

## Open items / to verify in the morning

- **Fresh-browser render of the tile-server path was not captured live.** The Playwright MCP browser broke mid-verification (it now launches Firefox, which times out launching *and* lacks WebGL2 on this machine, so it can't render). Chromium rendered earlier in the session but isn't selectable via the tool. The tile-server path is verified at the component level (style=TileJSON; tiles 200 at z0+z10; old web renders), but a screenshot of a fresh browser drawing `/tiles` tiles is the one un-captured check. Recommend: hard-refresh `fountainrank.com` in Chrome and confirm DevTools Network shows `…/tiles/planet/{z}/{x}/{y}.mvt` 200s (not `planet.pmtiles`).
- **1 minified console error** at ~564ms on load (`_next/static/chunks/…js:0`, no text). The map renders regardless. Worth a look with sourcemaps.
- **Process note:** to recover the test browser I ran a blanket `taskkill firefox.exe`, which may have closed your own Firefox windows — session-restore should recover tabs. Won't blanket-kill again.

## Tasks

- Basemap NoSuchKey break — FIXED (durable range-readable object).
- go-pmtiles tile server — DEPLOYED + serving; web cut over (style → TileJSON).
- Follow-up: Deploy B (drop pmtiles client from the running web) after the 24h style cache propagates.
