# Handoff — FountainRank Phase 3a (web map browsing) — BRAINSTORM IN PROGRESS

**Date:** 2026-06-20
**From:** In-repo Claude session (started the Phase 3 UI brainstorm via `superpowers:brainstorming`; visual companion hit a display glitch → restarting the conversation).
**To:** A fresh Claude/Codex instance in `D:\repos\fountainrank`.
**Relationship to other handoffs:** This handoff covers the **in-flight Phase 3a brainstorm only**. For the deployed baseline (web auth `v0.4.0` + profile sync `v0.5.0`, prod green), the prior handoff `handoffs/2026-06-20-profile-sync-deployed-handoff.md` still holds — nothing about deployed state changed. We are at the **brainstorm** step (no spec, no code yet).

---

## TL;DR — where we are

We are mid-`superpowers:brainstorming` on **Phase 3**, which we decomposed and started designing. **Several decisions are LOCKED** (below). The brainstorm is **not finished** — there are open questions still to walk through before writing the spec. No spec/plan/code exists yet for Phase 3.

**Resume by:** re-invoking `superpowers:brainstorming`, restating the locked decisions to the user, and continuing from the **first open question** in the "OPEN — next brainstorm questions" list. Then spec → Codex Loop A → plan → Codex Loop A → subagent-driven implement → PR → CI + Codex Loop B → squash-merge → owner-gated `v*.*.*` deploy (the standard sub-project cycle).

---

## LOCKED decisions (confirmed by owner this session)

1. **Phase 3 is split into TWO sub-projects** (owner chose "two: browse, then contribute"):
   - **3a = public map browsing (DO THIS FIRST):** MapLibre map, bbox-driven pin loading, clustering, pin styling (working/broken + rating + vote count per spec §8), tap-pin → fountain **detail view**. All **public, no auth**. This is the foundation.
   - **3b = contribute (LATER, separate cycle):** add-a-fountain (location pick + inline rating + 409 proximity handling) + rate-an-existing-fountain from detail. Reuses 3a's map/detail + the existing auth BFF (`getAuthedApiClient`).
   - **We are brainstorming 3a.**

2. **Basemap / tile source = self-hosted Protomaps, HOST THE WHOLE PLANET.** Upload one **~120 GB planet `.pmtiles`** to **DO Spaces + CDN**, render with **MapLibre GL JS + a Protomaps style**.
   - **Why the whole planet (not a US extract):** pmtiles is a single file served by **HTTP range requests** — the browser only fetches byte-ranges for tiles actually on screen, so **bandwidth scales with usage, not file size**. Hosting the planet means the owner's two goals ("cover the US" + "dead simple to add regions") are *both* satisfied for free — there are **no regions to manage**, the whole world is live.
   - **Cost:** DO Spaces is **$5/mo flat = 250 GB storage + 1 TB egress + built-in CDN**; the 120 GB planet fits inside base storage; egress scales with map views (comfortably inside 1 TB at launch scale). Overage: $0.02/GB storage, $0.01/GB transfer.
   - **Verified sizes:** planet z0–15 ≈ **120 GB**; one metro (Berlin, full bbox, z0–15) ≈ **84 MB**; planet z0–6 ≈ 60 MB; each extra zoom level ≈ **doubles** size. (Sources: docs.protomaps.com/basemaps/downloads, /pmtiles/, til.simonwillison.net/gis/pmtiles, docs.digitalocean.com/products/spaces/details/pricing/.)
   - **Implication / owner infra task:** a one-time ~120 GB upload of a Protomaps daily build to Spaces, plus occasional re-upload to refresh OSM data (infrequent — fountain-relevant data barely changes). The basemap source from the daily build at maps.protomaps.com/builds; do **not** hotlink — copy to our own Spaces (Protomaps explicitly discourages hotlinking). This is an **infra sub-task to fold into the 3a plan** (Spaces bucket/object + CDN; the style JSON + glyphs/sprites also need hosting).

3. **Map placement / IA = map at `/` with marketing above** (owner chose this over a dedicated `/map` route or map-as-homepage). The root route becomes the product surface: a marketing/brand band on top + the live map below, one page.

4. **Root page layout proportion = Option B: "hero band + map below."** A **taller branded hero band on top** (logo, headline, one-line pitch, **Sign in**) occupying ~the top third, with the **live map directly beneath it**. The fold cuts through the map (user scrolls a little to see all of it). This is a stronger brand moment on arrival than a slim app-header; it was chosen over (A) slim header + full-height map and (C) full hero / map below the fold.
   - **Design note to honor at spec time:** keep enough map visible above the fold that it's obviously interactive; the hero must not push the map entirely below the fold (that was the rejected option C). Make it responsive — on mobile the hero should be compact so the map isn't buried.

---

## OPEN — next brainstorm questions for 3a (resume here, one at a time)

Walk these with the owner before writing the spec (rough priority order):

1. **Initial map view / geolocation:** on load, request browser geolocation (HTTPS is available in prod) and center on the user with a "locate me" control — vs. default to a fixed view (e.g., a city) and let them search/pan. Handle permission-denied gracefully (fall back to a sensible default + the locate control).
2. **Detail view presentation:** tap a pin → **bottom sheet / side panel overlaying the map** (modern map UX, deep-linkable via URL state) vs. a **separate route** `/fountains/[id]`. Recommend an overlay panel with the fountain id reflected in the URL (shareable, back-button works). Detail shows: working/broken, overall stars + "N votes", **per-dimension averages** (Clarity/Taste/Pressure/Appearance), and comments. (Photos are **Phase 4** — out of scope.)
3. **Pin design & what's surfaced at pin level:** working vs broken (color — e.g. green/red, but verify contrast/colorblind safety, don't rely on color alone), and whether rating/vote count shows on the pin vs only on tap. Clustering at low zoom (cluster bubbles with counts). This is a **visual** question — good candidate for the visual companion (or inline sketches).
4. **bbox loading strategy:** query `GET /api/v1/fountains/bbox` on map **moveend** (debounced), with the backend's cap + client clustering. Consider a min-zoom before loading pins (avoid fetching the world at z2). Decide loading/empty/error states.
5. **Search / geocoding (scope decision):** is "search for a place and jump there" in 3a, or deferred? Spec §19 lists this as an open question (self-hosted Nominatim vs a provider). Recommend **deferring** geocoding from the browse MVP (geolocation + pan/zoom is enough for v1) to keep 3a focused — confirm with owner.
6. **MapLibre GL JS version** — pin the latest stable at **plan time** (house rule: `version-research-expert` / Context7). Also pick the **Protomaps style flavor** (light/dark/white/etc.) and the custom pin layer approach.
7. **Style-guide extension (house rule):** `docs/style-guide.md` must gain the new map UI elements (map shell, hero band on `/`, pins, cluster bubbles, detail panel, locate control) as they're designed.
8. **Landing copy:** root currently shows a "coming soon" pill — once a usable map ships, that's stale. Decide the new hero headline/pitch/CTA copy (the brainstorm wireframe used placeholder "Find, rate & add public drinking fountains near you").

---

## API the 3a UI builds against (ALL LIVE, public reads — see `backend/README.md`)

- `GET /api/v1/rating-types` — the 4 seeded dimensions (Clarity, Taste, Pressure, Appearance), in `sort_order`.
- `GET /api/v1/fountains?lat=&lng=&radius_m=` — nearby (ST_DWithin), nearest first, returns `distance_m`. `radius_m` optional (capped server-side).
- `GET /api/v1/fountains/bbox?min_lat=&min_lng=&max_lat=&max_lng=` — viewport envelope (ST_Intersects); inverted bounds → 422. **Primary map-load endpoint.**
- `GET /api/v1/fountains/{id}` — full detail incl. **per-dimension average/vote breakdown** + comments; unknown id → 404.
- **Pin payload** (nearby/bbox) includes: `id`, `location` (lat/lng), `is_working`, `average_rating`, `rating_count`, (+`distance_m` for nearby). Coordinates are **always lat/lng** in the API contract.
- Writes (`POST /api/v1/fountains`, `POST /api/v1/fountains/{id}/ratings`) require Logto auth — **those are 3b**, not 3a.

## Existing web patterns to reuse (don't reinvent)

- `web/lib/server/api.ts` — `getAuthedApiClient(requestId)` (server-only; attaches the resource JWT). 3a reads are **public**, so use a **non-authed** client for browsing; this authed pattern is for 3b.
- `web/lib/api.ts` — `resolveApiBaseUrl()` + the generated `@fountainrank/api-client` (`makeClient`). Typed client generated from backend OpenAPI.
- `web/app/account/page.tsx` — the established RSC data-fetch shape (force-dynamic, requestId, graceful error states, structured `log()`).
- Stack: **Next.js App Router**, **Tailwind CSS v4** (`globals.css` is just `@import "tailwindcss";`; brand colors as arbitrary-value utilities), **vitest** tests, pnpm + Turborepo monorepo.
- Brand tokens (`docs/style-guide.md`): Navy `#0A357E`, Blue `#0C44A0`, Royal `#0E4DA4` (bg gradient), Crown gold `#F2C200` (accent/CTA), Water cyan `#5FC5F0`, white text. Sign-in button = gold fill + navy text; sign-out = outline. Hero gradient: `bg-gradient-to-b from-[#0A357E] via-[#0C44A0] to-[#0E4DA4]`.

---

## Process notes for resuming (IMPORTANT)

- **We are in `superpowers:brainstorming`.** Its terminal state is "invoke `writing-plans`," and it defaults the spec path to `docs/superpowers/specs/...`. **OVERRIDE that:** this project's convention (CLAUDE.md) is **`docs/specs/YYYY-MM-DD-<topic>-design.md`** and **`docs/plans/YYYY-MM-DD-<topic>.md`**. Suggested spec filename: `docs/specs/2026-06-20-web-map-browsing-design.md` (adjust date to the day you write it).
- **Codex gating still applies on top of the skill flow:** after the spec is written + owner-approved, run **Codex Loop A** on the spec (and again on the plan) per `claude_help/codex-review-process.md` before implementing. PR gate = **CI green AND Codex `VERDICT: APPROVED` AND every PR comment addressed**, then **squash-merge** (`gh pr merge <N> --squash`). Deploy is an owner-gated `v*.*.*` tag → `deploy.yml`.
- **Visual companion:** the session used the brainstorming visual companion (browser mockups). It was running on **port 49957**, session dir `.superpowers/brainstorm/1810-1781979422/` (gitignored; mockup `content/root-layout.html` persists there). The owner reported a **display issue**, which is why we're restarting. A fresh session can either restart it (`skills/brainstorming/scripts/start-server.sh --project-dir /d/repos/fountainrank --open` — same `--project-dir` reuses the port) **or** continue the brainstorm in **plain text + inline ASCII sketches** if the companion keeps misbehaving. Decisions captured here do not depend on the companion.

## Process gotchas (carry forward — still true)

- **Windows pnpm store breaks repeatedly** (`EACCES`/IDE locks). Fresh-install fix: `pnpm install --lockfile-only` if needed, then `rm -rf node_modules web/node_modules packages/*/node_modules mobile/node_modules && pnpm install --frozen-lockfile`.
- **Codex (WSL) corrupts `backend/.venv`** → next Windows `uv` fails. Fix: `cd backend && rm -rf .venv && uv sync`.
- **Bash-tool cwd persists** across calls — `cd /d/repos/fountainrank` first if a stray `cd` happened.
- **Windows file tools need backslash paths** (`D:\repos\fountainrank\...`); the Bash tool is Git Bash (forward slashes, `/d/repos/...`).

---

## Read-first (in order) to resume the 3a brainstorm

1. `CLAUDE.md` — operating-rules hub.
2. This handoff (the decisions + open questions above).
3. `handoffs/2026-06-20-profile-sync-deployed-handoff.md` — deployed baseline + the broader Phase-3 framing (its "Phase 3" section).
4. `docs/specs/2026-06-16-architecture-and-foundation-design.md` — **§7 geo/PostGIS, §8 ranking (rating + votes on the map), §9 API surface, §14 frontend architecture (MapLibre + Protomaps), §20 roadmap.** (Note: the handoff's earlier "§11/§12/§13" references were off-by-numbering; the real sections are §7/§8/§9/§14/§20.)
5. `backend/README.md` — the live fountains API contract (above).
6. `docs/style-guide.md` — brand tokens + existing components; extend for map UI.
7. `web/lib/server/api.ts`, `web/lib/api.ts`, `web/app/account/page.tsx` — the web data-fetch patterns.
8. `claude_help/development-process.md` + `claude_help/codex-review-process.md` — the gating flow.
9. **Then:** re-invoke `superpowers:brainstorming`, restate the LOCKED decisions, and continue from open question #1 (initial view / geolocation).
