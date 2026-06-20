# Phase 3a — Web Map Browsing (design spec)

**Date:** 2026-06-20
**Status:** Design approved by owner; pending Codex Loop A.
**Phase:** 3a — the first half of Phase 3 (§20 of the foundation spec). 3a is **public map browsing**; 3b (contribute: add/rate) is a separate later cycle.
**Supersedes:** the in-flight brainstorm captured in `handoffs/2026-06-20-phase3a-map-browsing-brainstorm-handoff.md`.

Related standing docs: `docs/specs/2026-06-16-architecture-and-foundation-design.md` (§7 geo/PostGIS, §8 ranking, §9 API, §14 frontend, §20 roadmap); `backend/README.md` (live API contract); `docs/style-guide.md` (brand tokens + components).

---

## 1. Goal & scope

Ship a **public, no-auth** drinking-fountain discovery map on the web. The root route `/` becomes the product surface: a branded hero band above a live MapLibre map of fountains, with a tap-to-open fountain detail view. All data comes from the **already-live public read API**.

### In scope (3a)
- Root `/` redesigned to **hero band + live map** (the current "coming soon" page is replaced).
- MapLibre GL JS map on the self-hosted Protomaps **whole-planet** basemap (Light flavor).
- Auto-geolocation on load + a "locate me" control, with graceful fallback.
- bbox-driven pin loading (debounced), clustering, and loading/empty/error states.
- Custom pin rendering: working/broken + top-rated (gold) + selected states, with a rating pill; clusters at low zoom.
- Fountain **detail view** as an overlay panel backed by a real SSR route (`/fountains/[id]`).
- A **small backend addition**: expose `ranking_score` on the map/bbox pin payload (+ regenerate the shared API client).
- Style-guide entries for every new map UI element.

### Out of scope (3a)
- **Adding / rating fountains** → Phase 3b (reuses 3a's map + detail + the existing auth BFF).
- **Photos** → Phase 4.
- **Place search / geocoding** → deferred; tracked in **issue #19**.
- **Dark mode** → deferred; tracked in **issue #18**. 3a ships **light-only** but follows "dark-mode-ready" hygiene (§5.4).
- Leaderboards/profiles → Phase 5.

---

## 2. Locked decisions (owner-approved)

1. **Phase split:** build **3a (browse) first**, then 3b (contribute) as a separate cycle.
2. **Basemap:** self-hosted **Protomaps whole-planet pmtiles** on DO Spaces + CDN, served by HTTP range requests; rendered by **MapLibre GL JS**. **Light** style flavor.
3. **IA / placement:** map lives at **`/`** with marketing above it.
4. **Layout (Option B):** a taller branded **hero band on top** (wordmark, headline, one-line pitch, Sign in) over the **live map directly beneath**; the fold cuts through the map; hero compacts on mobile.
5. **Initial view:** auto-geolocate on load + persistent "locate me" control; graceful fallback to a default (continental US) view.
6. **Detail view:** an **overlay panel** (desktop side panel / mobile bottom sheet) backed by a **real `/fountains/[id]` SSR route** via Next.js parallel + intercepting routes.
7. **Pins (custom art):** rendered from the project pin sheet (`docs/logos/pin-only-logo-sheet.png`) as MapLibre **symbol-layer** icons:
   - **Broken** (priority) → standard pin **+ red slash**.
   - **Top-rated** (`ranking_score > 4`) → **gold pin** (#4).
   - **Otherwise** (incl. unrated) → **standard pin** (#3).
   - **Selected** (its panel open) → an **additive** halo / raised treatment; the standard icon also swaps #3 → **#1** (gold and broken keep their status icon so a selected broken fountain stays slashed).
   - **Rating pill** (gold ★ + average) at near zoom; **clusters** (neutral brand-blue count bubbles) at far zoom.
8. **Gold threshold:** the weighted **`ranking_score > 4`** from §8 of the foundation spec (not the raw average — avoids single-vote gilding).
9. **Hero copy:** headline **"Find a drinking fountain near you."**; pitch **"A free, community map of public drinking fountains — see what's nearby, what's working, and how people rate it."**
10. **Search:** deferred (issue #19). **Dark mode:** deferred (issue #18).

---

## 3. Information architecture & routes

| Route | Rendering | Purpose |
|---|---|---|
| `/` | RSC hero + client map | Hero band (SEO-friendly server markup) + the live `MapBrowser` client component beneath it. |
| `/fountains/[id]` | RSC (SSR) | Standalone, indexable, shareable fountain detail page (direct load / refresh / crawl). |
| `@modal/(.)fountains/[id]` | intercepting route | When `/fountains/[id]` is reached by a **soft** navigation from the map, render the detail as an **overlay** while `/` (the map) stays mounted underneath. |

**Parallel + intercepting routes (the "Instagram modal" pattern):**
- `app/layout.tsx` gains a `@modal` parallel slot rendered alongside `children`.
- `app/@modal/default.tsx` returns `null` (no overlay by default / on hard navigation).
- `app/@modal/(.)fountains/[id]/page.tsx` intercepts the soft navigation and renders the detail content inside an overlay container (a client component handling dismiss / back / focus-trap), reusing the same detail-content component as the standalone page.
- `app/fountains/[id]/page.tsx` renders the full standalone page (used on hard navigation, refresh, direct link, crawler).

Because the `children` slot stays on `/` during a soft navigation, the map client component **does not unmount** while the overlay is open — no tile/pin re-fetch, no map teardown. The browser **Back** button closes the overlay (route pops back to `/`).

---

## 4. Backend additions (small, in `backend/app/`)

Two small, well-scoped backend changes are part of 3a. Both touch `backend/app/routers/fountains.py` (+ `schemas.py`) and require regenerating the shared `@fountainrank/api-client` — so 3a touches **backend + api-client + web**, not web alone.

**4.1 `ranking_score` on the pin payload.** The gold-pin rule keys off the weighted `ranking_score`. Today `FountainPin` (the bbox/nearby payload, `backend/app/schemas.py`) exposes `average_rating` + `rating_count` but **not** `ranking_score`; the field is already computed and denormalized on the `Fountain` row and already returned by `FountainDetail`. Add `ranking_score: float | None` to `FountainPin` and populate it in **both** the `fountains_in_bbox` and `nearby_fountains` serializers (`backend/app/routers/fountains.py`) — no new computation, it surfaces an existing column.

**4.2 Deterministic detail dimension ordering.** The detail panel renders the per-dimension rows in a fixed display order. Today `serialize_fountain_detail` orders the dimensions by `RatingType.id` (`backend/app/routers/fountains.py`), and `DimensionSummary` does **not** expose `sort_order` — so the client cannot order them itself. `sort_order` is the column purpose-built for display order (data model §6). **Change:** order the detail dimensions by `RatingType.sort_order` in the serializer. (Today id-order and sort_order coincide for the seed data, but relying on that coincidence is fragile; ordering by the intended column makes the contract explicit and robust to reseeding.) The web client renders `dimensions[]` in the order returned — it does not re-sort.

**Tests:** backend tests assert `ranking_score` is present in **both** the bbox and nearby responses, and that detail dimensions come back in `sort_order`.

---

## 5. Map component

### 5.1 Client/server boundary
MapLibre GL JS is browser-only. `/` stays a **server component** that renders the hero markup (so the headline/pitch are server-rendered for SEO). It embeds a tiny **`"use client"` loader** (e.g. `MapBrowserLoader`) whose only job is `dynamic(() => import("./MapBrowser"), { ssr: false })`. **`ssr: false` must live inside a Client Component** — Next.js App Router (16.x) rejects `next/dynamic({ ssr: false })` used directly in a Server Component, so the RSC page must not call it. The WebGL canvas thus never server-renders, while the hero remains SSR. The map fetches its own data client-side (§6).

### 5.2 Basemap & hosting (infra sub-task, folded into the plan)
- One-time owner upload of a **Protomaps daily-build planet `.pmtiles`** (~120 GB) to a DO Spaces bucket fronted by the Spaces CDN. **Do not hotlink** the public Protomaps build — copy to our own bucket (Protomaps discourages hotlinking).
- Host the **Protomaps style JSON + glyphs + sprite** on Spaces as well; MapLibre loads the style + the `pmtiles://` source via the `pmtiles` protocol plugin (range requests).
- Periodic (infrequent) re-upload to refresh OSM data.
- Terraform owns the bucket/CDN per the IaC rules (no by-hand cloud mutation); the upload itself is an owner runbook step.
- **Browser-origin CORS + range support on the basemap CDN (required).** The style JSON, glyphs, sprite, and `.pmtiles` are fetched **by the browser** from the Spaces/CDN origin (a *different* origin than both the web app and the API), and PMTiles relies on **HTTP range requests**. So the bucket/CDN must: allow the web origins (`https://fountainrank.com`, `https://www.fountainrank.com`, dev/preview) via CORS; permit `GET`/`HEAD` and the `Range` request header; and **expose** `Accept-Ranges`, `Content-Range`, and `Content-Length` to the browser. This CORS/range config is owned by Terraform (Spaces bucket CORS rules), not console-only mutation, and is verified by a smoke check from the deployed web origin (the map must actually render tiles cross-origin).

### 5.3 Initial view / geolocation
- On mount, request `navigator.geolocation.getCurrentPosition` with a **short timeout** and `enableHighAccuracy:false`; on success, `flyTo` the user's location at a neighborhood zoom (≈ z14).
- On denial / unavailable / timeout, fall back to a **default continental-US view**; never block map render on the prompt.
- A persistent **"locate me"** control re-requests geolocation on click (user gesture) and recenters.

### 5.4 Dark-mode-ready hygiene (no dark UI in 3a)
Per issue #18: keep the **basemap style/flavor a single swappable config value**, keep **pin asset references swappable** (a map of state → asset URL), and prefer brand **tokens over scattered literals** where it is low-cost. No theme toggle and no dark assets ship in 3a.

---

## 6. Data flow, bbox loading & states

### 6.1 Fetching
- Pins load from **`GET /api/v1/fountains/bbox?min_lat&min_lng&max_lat&max_lng`** (the primary map endpoint).
- Trigger on map **`moveend`, debounced** (a named constant, ≈300 ms); each settle reads the current viewport and refetches. The map stays interactive during loads.
- **Bounds normalization (required — the live API is strict).** `map.getBounds()` can return latitudes/longitudes **outside** the API's accepted ranges (it 422s on `lng`/`lat` outside `[-180,180]`/`[-90,90]`) and can describe a viewport that **crosses the antimeridian** (`min_lng > max_lng`), which the bbox endpoint also rejects with 422 (documented limitation in `backend/app/routers/fountains.py`). A **pure `normalizeBounds` helper** therefore: clamps latitude to `[-90, 90]`; wraps longitude into `[-180, 180]`; and detects an antimeridian-crossing viewport. For 3a, a crossing viewport is **skipped** (no fetch that frame) — mirroring the backend's own documented Phase-1 stance — rather than sent (which would 422); splitting into two envelope queries is a noted future option. This helper is unit-tested across these cases; the earlier "we just avoid 422" assumption is replaced by this explicit contract.
- **Min-zoom gate (a named constant, ≈z10):** below the threshold, skip the fetch and show a "Zoom in to see fountains" hint (a world-scale bbox is huge and the server caps results, making a zoomed-out view arbitrary/misleading). Auto-geolocation lands the user above this threshold, so they normally see pins immediately.
- **Cap awareness (honest, heuristic — not "first N").** The bbox endpoint returns a **bare `list[FountainPin]`** capped at `settings.max_results` (currently 500), with **no `has_more`/total metadata and no deterministic order**. The client therefore cannot truthfully say "the first N" (the result is unordered) nor read the server's cap from the payload. Instead: pin the cap as a **shared constant mirrored from the backend** (`MAX_BBOX_RESULTS`, kept in sync — and asserted against the backend value in a test), and when a viewport returns exactly that many rows, show a **neutral, explicitly-heuristic** hint — "Lots of fountains here — zoom in to see them all" — never "showing the first N." Residual, accepted risk for 3a: a viewport with *exactly* the cap count and no truncation shows the hint too. A precise contract (a response envelope with `has_more`) is a deliberately deferred future option, not part of 3a, to avoid a response-shape change rippling through the API client + mobile.

### 6.2 Client → API access (CORS — verify the existing config)
The bbox calls are **client-side from the browser** to `api.fountainrank.com` (a different origin than the web app) — 3a is the first browser-origin API caller (the account page reads are server-side RSC). The backend **already** ships explicit-origin CORS: `cors_allow_origins` defaults to `https://fountainrank.com`, `https://www.fountainrank.com`, `http://localhost:3020` with `allow_credentials=True` and **no wildcard** (`backend/app/config.py`, installed via `CORSMiddleware` in `backend/app/main.py`). So the 3a task is **not** to design CORS but to: **verify those origins are correct in production**, add any missing **preview/dev** origin if the deploy introduces one, preserve the **no-`*`-with-credentials** rule, and add a **browser-origin smoke check** (a real cross-origin GET from the web origin succeeds). (Alternative considered and rejected for v1: proxying every bbox call through a Next.js route handler — a server hop on every pan; direct client→API with the existing CORS is the standard map pattern.)

### 6.3 States
- **Loading** — a subtle, non-blocking indicator; keep the previous pins on screen until the new set arrives (no flash of empty map).
- **Empty** — "No fountains mapped here yet." (No add-CTA — that's 3b.)
- **Error** — a dismissible toast with **Retry**; keep the last good pins visible. Log client-side fetch failures.

---

## 7. Pins, clustering & rendering

### 7.1 Source & clustering
A single MapLibre **GeoJSON source** holds the current viewport's fountains with `cluster: true` (`clusterRadius`, `clusterMaxZoom` tuned at plan time). Layers:
1. **Cluster circles** — neutral brand-blue (`#0C44A0`) circles, radius stepped by point count; white count label. Tapping a cluster zooms to expand.
2. **Unclustered pin** — a **symbol layer** with a **data-driven `icon-image`** selecting the pin state (below). Anchored at the teardrop tip (`icon-anchor: bottom`).
3. **Rating pill** — a symbol layer on unclustered points showing the gold-★ + average (a stretchable pill background via `icon-text-fit` + `text-field`), gated to **near zoom** (drops off when zoomed out / clustered). **`average_rating` is nullable** (unrated fountains): when it is null the pill is **not rendered** (the pin alone shows) — the layer filters out null-average features, so the map never shows `null`/`NaN`/an empty pill. A pure formatter (tested) produces the pill text and returns "no pill" for null.
4. **Selected halo** — a top-most layer filtered to the active fountain id (set when a pin is tapped / the detail route is active), drawing a halo + raising the active fountain above clusters and pins. Additive — it does not replace the status icon (see §7.2).

GPU-rendered symbol layers (not DOM markers) are required because the map is public and a viewport can hold many fountains, and because clustering is native to GL sources.

### 7.2 Pin state machine (icon selection)
The **status icon** is chosen per fountain feature, in this precedence:
1. **Broken** (`is_working === false`) → `pin-broken` (standard #3 with the red slash composited in). **Broken always wins over gold** — a broken fountain is never gilded.
2. **Top-rated** (`is_working && ranking_score != null && ranking_score > 4`) → `pin-gold` (#4).
3. **Default** (working, incl. unrated) → `pin-standard` (#3), which swaps to `pin-selected` (#1) when this fountain is the active/selected one.

**Selection is additive**, not a fourth exclusive state: the active fountain always gets the halo + raised z-order (§7.1 layer 4) regardless of its status icon, and only the *standard* icon additionally swaps to #1 — so a selected **broken** fountain keeps its slash and a selected **gold** fountain stays gold, each just gaining the halo.

The threshold `4` is a named constant (tunable). Pins where `ranking_score` is null are treated as non-gold.

### 7.3 Assets (plan task)
Export the chosen variants from `docs/logos/pin-only-logo-sheet.png` as **transparent PNGs at 2–3×** (retina), tip-anchored: `pin-standard` (#3), `pin-selected` (#1), `pin-gold` (#4), and `pin-broken` (#3 + red slash composited). Verify legibility on the **light** basemap; add a subtle outline/shadow if the white/cyan fountain spray washes out. Load via `map.addImage()` (or the style sprite) keyed by state name.

### 7.4 Accessibility
Status is encoded by **shape/glyph, not color alone** (broken = a slash shape; clusters = a count). Maintain WCAG AA contrast for pills, controls, and labels on the light basemap.

**Keyboard access is a requirement, not a consideration.** GL symbol-layer pins are canvas-rendered and not natively tabbable, so the design *must* provide a concrete keyboard/AT path — choosing scale (symbol layers) over DOM markers does not get to drop accessibility. 3a ships a **synchronized, accessible "fountains in view" list**: a DOM list of the same fountains currently loaded in the viewport, kept in sync with the map data, where each item is a real focusable control that **opens the same `/fountains/[id]` route/overlay** a pin tap would, and (when present) the selected list item and the selected pin reflect the same active id. The map's own controls (locate-me, zoom) are real buttons with labels and visible focus. This accessible list's behavior (sync with bbox results, selection mirroring the overlay, keyboard open/close) is **defined here, exercised by component tests (§12), and part of the Definition of Done (§15)** — not deferred.

---

## 8. Detail view content

Rendered from the real `FountainDetail` (`backend/app/schemas.py`): `id`, `location`, `is_working`, `comments` (single optional note), `average_rating`, `rating_count`, `ranking_score`, `created_at`, `last_rated_at`, `dimensions[] {rating_type_id, name, average_rating, vote_count}`.

Layout — **desktop docked side panel / mobile bottom sheet**, over the live map:
- **Title:** generic "Public drinking fountain" (fountains have **no name**) + a status chip: **Working** / **Out of order**.
- **Overall:** gold stars + numeric `average_rating` + "N ratings" (`rating_count`); when `average_rating` is null → "Not yet rated."
- **Per-dimension:** Clarity / Taste / Pressure / Appearance rows from `dimensions[]`, rendered **in the order the API returns** — §4.2 makes the backend order by `sort_order`, so the client does not re-sort — each "★ avg (votes)"; a dimension with no votes → "Not yet rated."
- **Notes:** the `comments` text, shown only when present.
- **Meta:** "Added {created_at}" + "Last rated {last_rated_at}" (when present).
- **Actions (browse-only):** **Directions** (opens the device maps app to the coordinates — public) and **Share** (copies the `/fountains/[id]` URL). A small note: *"Rate this fountain" arrives in Phase 3b.*
- `ranking_score` is **not** surfaced in the panel (it drives the gold pin only; it is a leaderboard-style internal score).

**Unknown / error handling (precise, since the route is indexable):** the RSC reads the public client's `{ data, error, response }` (the `account/page.tsx` pattern) and logs failures with the request id + status (`log()`), never silently. On a 404 from the API, the **standalone hard-load** route calls Next `notFound()` so the page renders the not-found UI **and returns an HTTP 404 status** (correct for SEO/crawlers — an unknown fountain must not 200). The **intercepted soft-nav overlay** renders an in-panel "Fountain not found" state with a close/back affordance (no full-page 404 inside the overlay). Non-404 API errors render a graceful "Couldn't load this fountain" state and are logged.

---

## 9. Web architecture & reuse

- **Public reads** use a **non-authed** client: `getApiClient()` (`web/lib/api.ts`, `resolveApiBaseUrl()` + generated `@fountainrank/api-client`). The authed BFF (`web/lib/server/api.ts`) is for 3b writes — not used here.
- **RSC fetches** (the detail route) follow the established shape in `web/app/account/page.tsx`: `force-dynamic`, a per-request id, graceful error states, structured `log()` (`web/lib/server/log.ts`).
- **Client fetches** (bbox) run in the `MapBrowser` client component using the public base URL (`NEXT_PUBLIC_API_BASE_URL`); errors drive the error state (§6.3).
- **Stack:** Next.js App Router (16.x), React 19, Tailwind CSS v4 (brand colors as arbitrary-value utilities), pnpm + Turborepo, vitest. MapLibre GL JS + the `pmtiles` protocol plugin are **new dependencies** (versions pinned at plan time per the version-research house rule).
- **Homepage metadata:** `web/app/layout.tsx` currently advertises "Launching soon" in its `description`/OpenGraph copy. Since `/` becomes a live product map, update the title/description/OpenGraph copy to match the shipped experience (the hero copy in §2.9) and drop "Launching soon." This is a web task and appears in the DoD (§15).
- **File discipline:** new map code lives in focused modules — e.g. a `MapBrowser` client component, a pure pin-state/icon-selection helper, a pure bbox→query-params + min-zoom/cap helper, a detail-content component shared by the route and the overlay, and the overlay container. Pure logic is separated from the React/MapLibre glue so it is unit-testable without a DOM/WebGL.

---

## 10. Logging & observability

Per the house Logging standard:
- The **detail RSC route** logs (structured, via `log()`): the fetch attempt with the request id + status, and any failure with context — never the raw error swallowed silently.
- **Client map errors** (bbox fetch failure, geolocation error, style/tile load failure) are handled visibly (error/empty/hint states) and logged to the browser console in a structured form; no bare `console.log` noise, no secrets (there are none on the public path).
- No secrets/tokens are involved on the public browse path; nothing to redact, but the no-secret-logging rule still holds for any future addition.

---

## 11. Style guide additions (house rule)

Add to `docs/style-guide.md` as they are built: the **map shell / homepage hero band on `/`**, **map controls** (locate-me, zoom), **pins** (standard / selected / gold / broken-slash) + the **rating pill**, **cluster bubbles**, the **detail overlay** (side panel + bottom sheet), and the **loading / empty / error / "zoom-in" hint** states. Each entry documents purpose, structure, states, accessibility, and an example.

---

## 12. Testing strategy

Mirrors CI (`claude_help/testing-ci.md`); run the full local mirror before the PR.

- **Backend (pytest):** the bbox (and nearby) response includes `ranking_score`; the detail `dimensions[]` come back ordered by `sort_order` (§4.2); existing geo/ranking tests stay green.
- **Web unit (vitest):** pure helpers —
  - pin-icon selection — **explicit cases, since selection is additive (§7.2):** broken (working=false) → `pin-broken` even when `ranking_score > 4` (broken beats gold); gold only when working AND `ranking_score > 4`; null `ranking_score` → not gold → `pin-standard`; unrated working → `pin-standard`; **selected working non-gold → `pin-selected` + halo; selected broken → `pin-broken` + halo (slash preserved); selected gold → `pin-gold` + halo** (selection never erases the status icon).
  - `normalizeBounds` helper (§6.1): clamps latitude to `[-90,90]`; wraps longitude into `[-180,180]`; detects antimeridian crossing (`min_lng > max_lng` after wrap) → returns "skip"; otherwise emits valid `min/max lat/lng` query params.
  - min-zoom gate: returns "don't fetch" below the threshold constant, "fetch" at/above.
  - cap heuristic (§6.1): `rows.length === MAX_BBOX_RESULTS` → show the heuristic "lots here, zoom in" hint; fewer → no hint. A test asserts the mirrored `MAX_BBOX_RESULTS` constant equals the backend's `max_results`.
  - rating-pill formatter: average rounding, **null `average_rating` → "no pill"** (never `null`/`NaN`), and the detail-panel overall/dimension formatting ("Not yet rated" on null, "N ratings" pluralization).
- **Web component (vitest + Testing Library):**
  - detail-content component: working vs. out-of-order, populated vs. null overall, per-dimension with/without votes, note present/absent; the overlay container closes on back/escape; the "Fountain not found" overlay state renders for a 404.
  - the **accessible "fountains in view" list** (§7.4): renders one focusable control per in-view fountain, activating one opens the detail route/overlay, and the active id mirrors between list and map state.
- **Map glue** (the MapLibre/WebGL-bound code) is kept thin and is validated manually (it can't run headless in CI); all branching logic lives in the tested pure helpers above.

A task is done only when its tests pass and the local CI mirror is green (no "should work").

---

## 13. Open items resolved at plan time
- Pin **MapLibre GL JS** + `pmtiles` plugin versions (version-research / Context7).
- Pin the exact **Protomaps style** (Light flavor file) + glyph/sprite hosting layout.
- Choose the **named constants** (and test behavior, not magic values): debounce, min-zoom gate, geolocation timeout, neighborhood zoom, gold threshold (`4`), clustering params (`clusterRadius`, `clusterMaxZoom`), and `MAX_BBOX_RESULTS` (mirrored from backend `max_results`).
- **Verify** the existing backend **CORS** origins in production and add any preview/dev origin (§6.2); **configure basemap-CDN CORS + range headers** (§5.2).
- Export and verify the **pin assets** on the light basemap (§7.3).

---

## 14. Risks & mitigations
- **CORS/range misconfigured** → map shows no pins (API origin) or no tiles (basemap CDN, which needs CORS + range headers) in prod. *Mitigation:* verify the existing API CORS + configure the CDN CORS/range, each with a smoke check from the deployed web origin (§5.2, §6.2).
- **Custom pins wash out on the light basemap** → *Mitigation:* outline/shadow + a legibility check at marker scale during asset prep (§7.3).
- **Large planet pmtiles upload / CDN range-request behavior** → *Mitigation:* verify range requests are served by the Spaces CDN; the owner upload is a one-time runbook step; bandwidth scales with views, not file size.
- **Sparse launch data** → many viewports legitimately empty → *Mitigation:* first-class empty + "zoom in" states so the map never looks broken.
- **Map glue is hard to unit-test** → *Mitigation:* push all logic into pure, tested helpers; keep the WebGL layer thin.

---

## 15. Definition of done (3a)
- Root `/` serves the **hero + live map**; the homepage **metadata** is updated (no "Launching soon", §9).
- **Auto-geolocation + locate control** work with graceful fallback; the map never blocks on the prompt.
- Pins load by **normalized** bbox (lat/lng clamped/wrapped, antimeridian skipped — §6.1) with **clustering**, the pin **status icons** (broken-beats-gold), **additive selection** (slash/gold preserved), and the **rating pill** (hidden when unrated).
- The **cap awareness** hint is heuristic and honestly worded (§6.1); empty/loading/error/"zoom-in" states all render.
- The **detail overlay + standalone `/fountains/[id]` route** work: direct load, refresh, Back, and a 404 that returns HTTP 404 on hard load + an in-panel not-found state on soft-nav.
- A **keyboard-accessible "fountains in view" list** opens fountains without pointer precision (§7.4).
- Backend: **`ranking_score`** is in the bbox + nearby payload and detail **dimensions are ordered by `sort_order`** (§4); the **api-client is regenerated**.
- **API CORS verified** in prod and **basemap-CDN CORS + range headers configured**, each smoke-checked from the web origin (§5.2, §6.2).
- The **style guide** is updated for every new map UI element (§11).
- All tests + the local **CI mirror** are green; the PR is **CI-green AND Codex `VERDICT: APPROVED` AND all comments addressed**; deploy is an owner-gated `v*.*.*` tag.
