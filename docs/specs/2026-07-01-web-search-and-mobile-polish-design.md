# Web header search + mobile UX polish — design

**Status:** owner-approved direction (2026-07-01), pending Codex spec review.
**Driver:** owner testing of the shipped #143 build — four follow-up items:
1. Mobile header **logo** reads as "a box in a circle" — use the transparent pin, drop the circle chrome.
2. Mobile **locate button** dot should be a standard blue "my-location" mark.
3. Mobile **Search** tab not visible on the owner's device (see §5 — shipped in #143; harden + rely on the new build).
4. **Web** has no search — add an **ever-present header search bar** that recenters/zooms the web map.

Extends the geocode proxy from `docs/specs/2026-07-01-mobile-map-ux-search-and-nav-design.md` (already shipped).

---

## 1. Goal & scope
Three small mobile polish fixes + one web feature (header search), plus the one backend enabler the web
zoom-to-granularity needs (a bounding box on geocode results). One follow-up PR.

## 2. Backend — add `bounding_box` to geocode results (enables granularity-aware zoom)
The owner wants: pick a result → **fit the map to the result's extent** (an address zooms in to the
fountain-visible level; a country stays wide). That requires the result's bounding box, which the proxy
currently drops.

- **`backend/app/schemas.py`:** add `class BoundingBox(BaseModel) { south: float; west: float; north: float; east: float }` and `GeocodeResult.bounding_box: BoundingBox | None = None` (optional — not every provider hit has one; existing clients ignore it).
- **`backend/app/geocoding.py` `_normalize_hits`:** LocationIQ returns `boundingbox: [south, north, west, east]` (strings). Parse into `BoundingBox(south, west, north, east)` as floats; on missing/malformed (wrong length, non-numeric) set `bounding_box=None` and still return the result (never drop a result for a bad bbox). Coordinate house convention unchanged (`latitude`/`longitude`; bias stays `(lat, lng)`).
- **OpenAPI regen** so `schema.d.ts` carries the optional field; mobile `query.ts` is unaffected (ignores it); web consumes it (§4).
- Tests (extend `backend/tests/test_geocode.py`): a hit with a valid `boundingbox` → parsed `BoundingBox`; a hit with missing/short/non-numeric `boundingbox` → `bounding_box is None` **and the result is still returned**.

## 3. Mobile polish (`mobile/`)
### 3.1 Header logo (`app/(tabs)/index.tsx` `MapHeader` + `styles.brandMark`)
- Copy `docs/logos/512-pin.png` → `mobile/assets/logo-pin.png` (metro can only bundle assets inside the project); `require("../../assets/logo-pin.png")` in the header. Remove the old `assets/icon.png` header usage.
- **Strip the circle chrome:** `styles.brandMark` currently sets `backgroundColor: "#0E4DA4"`, `borderColor: brandYellow`, `borderWidth: 1`, `borderRadius: 17` (index.tsx:1192-1201). Remove the background, border, and radius so the **transparent pin sits directly on the blue header**. Keep it sized (e.g. width/height ~34, `Image` `resizeMode: "contain"`), no clipping. Web logo is unchanged (owner complaint was mobile-only).

### 3.2 Locate button (`app/(tabs)/index.tsx` ~line 566 + `styles.locateGlyph`)
- Replace the faint `<Text>◎</Text>` glyph with a **standard blue location mark** inside the existing white circle (`styles.locate`): an `Ionicons name="locate"` (the conventional crosshair) at `color={colors.brandBlue}`, size ~22. Keep the white-circle button container as-is. (Drop `styles.locateGlyph` if unused.)

### 3.3 Search tab hardening (`app/(tabs)/_layout.tsx`)
The Search tab **is** shipped in #143 (`_layout.tsx:79-98`, 2nd tab, custom `tabBarButton`), and `search.tsx`
exists. The owner's device didn't show it — most likely the new store build wasn't installed yet, but to
rule out a render quirk we align the Search tab's structure with the working Add tab: add a `tabBarIcon`
(`Ionicons name="search"`) alongside the custom `tabBarButton` (Add already carries both; this is the only
structural difference between the two). No behavior change. On-device visibility is owner/CI-verified via the
new build. If it is still missing after installing the new build, that is a device render bug to investigate
separately (cannot be reproduced headless here).

## 4. Web header search (`web/`)
### 4.1 UI — `web/components/HeaderSearch.tsx` (new, client component)
- Rendered inside `web/components/SiteHeader.tsx` (a server component) between the logo and the points/auth cluster, **ever-present** (both `hero` and `bar` variants). An input ("Search address or city") + a results dropdown.
- Debounced (~300 ms, min 3 chars) call to the **public** `GET /api/v1/geocode` via a browser client built from `web/lib/api.ts` `resolveApiBaseUrl()` (`NEXT_PUBLIC_API_BASE_URL`) — no auth (public endpoint). Reuse a small pure state/query module mirroring mobile's `lib/map-search` (normalize, min-length, stale-drop, map response→list model incl. `bounding_box`).
- Dropdown rows show the `label`; a persistent **attribution line** "Search by LocationIQ · © OpenStreetMap contributors" (link `https://locationiq.com/attribution`) whenever results show (same requirement as mobile, spec §12). Escape / click-away / blur dismiss.

### 4.2 Handoff to the map — URL param (works cross-page + shareable)
The header is global (a non-map page has no map). On select, `HeaderSearch` navigates to the map with the
target encoded in the URL: `router.push("/?flyto=" + encodeURIComponent(JSON.stringify({lng,lat,bbox})))`
(or a compact `?flyto=lng,lat` + `?bbox=w,s,e,n`). This both **recenters on the map page** and **navigates
there from any other page**, mirroring mobile's Search (which navigates to `/` then recenters).

### 4.3 Map consumes it — `web/components/map/MapBrowser.tsx`
- Read the `flyto`/`bbox` param via `useSearchParams()` in an effect keyed on the param. When present:
  - If a **`bounding_box`** is available → `map.fitBounds([[west,south],[east,north]], { maxZoom: FOUNTAIN_ZOOM, padding: 48, duration })`. `FOUNTAIN_ZOOM` is a cap (~15–16, the level where the "Zoom in to see fountains" threshold is satisfied) so an **address zooms in to fountains** while a **country's huge bbox stays wide** — exactly the owner's rule.
  - Else (no bbox) → `map.flyTo({ center: [lng, lat], zoom: NEIGHBORHOOD_ZOOM })` (fallback).
  - Then **clear the param** (`router.replace("/")`, preserving other params) so a manual pan isn't re-hijacked and the fly isn't re-fired on re-render. Guard against re-firing on the same param value.
- Reuse the existing `mapRef`; do not disturb the existing `moveend`/geolocation/`add`-mode logic.

## 5. Testing
- **Backend (local):** `bounding_box` parse/None cases in `test_geocode.py`; OpenAPI check that `GeocodeResult.bounding_box` is present + optional.
- **Web (local, pure + jsdom where infra allows):** the pure search state/query module (normalize, min-length, stale-drop, `bounding_box` mapping); a `deriveFlyToParam`/`parseFlyToParam` round-trip; a `chooseZoom(bbox|null, caps)` helper (bbox present → fitBounds path; absent → fallback zoom). Web has vitest (some render tests are CI-verified; keep the new logic pure + covered). `next build` + tsc via CI.
- **Mobile (local):** tsc + eslint + prettier; existing pure suites still green after the client regen. Logo/locate/nav render = CI/owner-verified (no RN render infra).
- Regenerate the api-client so web + mobile typecheck against the new `bounding_box` field.

## 6. Security / cost
No new endpoint; web reuses the existing public `/api/v1/geocode` (same provider hard-quota spend model, no-overage). The browser calls it directly with **no auth header** (public); no key is ever exposed client-side (the key stays server-side in the proxy). Same LocationIQ/OSM attribution shown on web. CORS already allows the web origins.

## 7. Out of scope / follow-ups
- Mobile search zoom-to-granularity (mobile keeps fixed `PLACE_MIN_ZOOM`; could adopt `bounding_box` later).
- Search history / reverse geocoding / POI search. Gating the mobile SearchOverlay against add-mode (separate polish).

## 8. Delivery
One branch (`fix/web-search-and-mobile-polish`) → PR: backend (bbox + tests + OpenAPI) + mobile (logo asset, locate glyph, nav hardening) + web (HeaderSearch, MapBrowser fly-to, pure libs) + client regen. Codex spec review (this doc) before code; Codex PR review before merge; CI green + comments addressed → squash-merge → deploy web+backend (`deploy.yml`) and a mobile store release. No AI attribution; no time estimates.

## 9. Acceptance criteria
- Mobile header shows the transparent pin (no circle/box); locate button shows a standard blue location mark in the white circle; the Search tab is present in the nav (new build).
- Web header has an ever-present search box; typing shows geocode results with attribution; selecting a result recenters the web map and **zooms to fit the result's extent, capped so an address reaches the fountain-visible zoom while a country stays wide**.
- Geocode API key never reaches the browser; endpoint stays public; provider no-overage spend model intact.
- Backend + web + mobile CI green (except the pre-existing mobile-doctor Expo time-drift); Codex `VERDICT: APPROVED`.
