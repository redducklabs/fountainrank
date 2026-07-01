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
- **`backend/app/geocoding.py` `_normalize_hits`:** LocationIQ returns `boundingbox: [south, north, west, east]` (strings). Parse into `BoundingBox(south, west, north, east)` as floats. **The provider is untrusted input — validate geographically before exposing it:** `bounding_box=None` (and still return the result — never drop a result for a bad bbox) when the value is missing, wrong length, non-numeric, **non-finite (NaN/±inf), out of range (`south`/`north` ∉ [-90,90], `west`/`east` ∉ [-180,180]), inverted (`south >= north` or `west >= east`), or zero-area**. Only a fully valid, positive-area box is emitted. Coordinate house convention unchanged (`latitude`/`longitude`; bias stays `(lat, lng)`).
- **OpenAPI regen** so `schema.d.ts` carries the optional field; mobile `query.ts` is unaffected (ignores it); web consumes it (§4).
- Tests (extend `backend/tests/test_geocode.py`): valid `boundingbox` → parsed `BoundingBox`; each invalid case (missing / short / non-numeric / NaN / out-of-range / inverted / zero-area) → `bounding_box is None` **and the result is still returned**.

## 3. Mobile polish (`mobile/`)
### 3.1 Header logo (`app/(tabs)/index.tsx` `MapHeader` + `styles.brandMark`)
- Copy `docs/logos/512-pin.png` → `mobile/assets/logo-pin.png` (metro can only bundle assets inside the project); `require("../../assets/logo-pin.png")` in the header. Remove the old `assets/icon.png` header usage.
- **Strip the circle chrome:** `styles.brandMark` currently sets `backgroundColor: "#0E4DA4"`, `borderColor: brandYellow`, `borderWidth: 1`, `borderRadius: 17` (index.tsx:1192-1201). Remove the background, border, and radius so the **transparent pin sits directly on the blue header**. Keep it sized (e.g. width/height ~34, `Image` `resizeMode: "contain"`), no clipping. Web logo is unchanged (owner complaint was mobile-only).

### 3.2 Locate button (`app/(tabs)/index.tsx` ~line 566 + `styles.locateGlyph`)
- Replace the faint `<Text>◎</Text>` glyph with a **standard blue location mark** inside the existing white circle (`styles.locate`): an `Ionicons name="locate"` (the conventional crosshair) at `color={colors.brandBlue}`, size ~22. Keep the white-circle button container as-is. (Drop `styles.locateGlyph` if unused.)

### 3.3 Search tab render bug — root-caused + fixed (`app/(tabs)/_layout.tsx`)
**Confirmed a real bug** (owner verified the Search tab is absent on the LATEST installed build — not a stale
build). Root cause (Codex, against the installed expo-router 56.2.11 vendored bottom-tabs source): the Search
tab used a **custom zero-argument `tabBarButton: () => (…)`** that replaced the standard tab renderer and
discarded the computed tab-button props/children the renderer supplies (`BottomTabItem.js:99`,
`BottomTabBar.js:288`) — so the Search slot rendered nothing. (The Add tab "works" because its custom
`tabBarButton` draws a large lifted FAB that shows regardless; Search's small flex-dependent content
collapsed.) **Fix (already committed `cb5bd5a`):** make Search a **standard tab** — a normal
`tabBarIcon: ({color,size}) => <Ionicons name="search" …>` (identical pattern to Map/Rankings/Profile, which
all render) plus a `listeners.tabPress` handler that `event.preventDefault()` then `router.navigate("/") +
requestMapSearch()` — preserving the search-trigger behavior without a custom button. This is a cleaner
pattern than the original and renders by construction (same as the three working standard tabs). tsc + eslint
pass. **On-device verification is owner/emulator-confirmed on the next build** (the emulator could not be
driven from this Windows/WSL environment — `adb` unreachable). Add keeps its custom `tabBarButton` (it needs
the special lifted-FAB visual, which a standard `tabBarIcon` can't produce).
- **Style-guide update required (the old pattern is documented and can regress):** `docs/style-guide.md`
  (the bottom-navigation section, ~lines 1340-1365) still describes Search as a **custom `tabBarButton`**
  that renders its own glyph/label and tracks `TAB_INACTIVE_COLOR` — i.e. the exact pattern that caused this
  device-visible bug. Update that section so it states **Search is now a standard tab (`tabBarIcon` +
  a `listeners.tabPress` preventDefault → navigate/`requestMapSearch`)**, and **Add is the only custom
  lifted-FAB `tabBarButton`**, so the guidance can't reintroduce the regression.

## 4. Web header search (`web/`)
### 4.1 UI — `web/components/HeaderSearch.tsx` (new, client component)
- Rendered inside `web/components/SiteHeader.tsx` (a server component) between the logo and the points/auth cluster, **ever-present** (both `hero` and `bar` variants). An input ("Search address or city") + a results dropdown.
- Debounced (~300 ms, min 3 chars) call to the **public** `GET /api/v1/geocode` via a browser client built from `web/lib/api.ts` `resolveApiBaseUrl()` (`NEXT_PUBLIC_API_BASE_URL`). Reuse a small pure state/query module mirroring mobile's `lib/map-search` (normalize, min-length, stale-drop, map response→list model incl. `bounding_box`).
- **Public-client boundary (no auth leak):** the browser call uses the generated client with **no `Authorization` header and no token provider** — the header area already has server auth plumbing, so the geocode call must be explicitly unauthenticated (the endpoint is public; the provider key stays server-side in the proxy). A small `geocodeClient` helper isolates this, and a test asserts no auth header is attached (mirrors mobile's `api.test.ts` guard). `NEXT_PUBLIC_API_BASE_URL` is the only browser-exposed config.
- Dropdown rows show the `label`; a persistent **attribution line** "Search by LocationIQ · © OpenStreetMap contributors" (link `https://locationiq.com/attribution`) whenever results show (same requirement as mobile, spec §12). Escape / click-away / blur dismiss.
- **Responsive layout:** `SiteHeader` is one flex row (logo left; points/auth right; hero adds a subtitle). The search sits in the **center with a bounded width** (e.g. `max-w-md flex-1`), and on **small screens wraps to its own full-width row below** the logo/points row (so it never squeezes out points/auth or the hero subtitle). Desktop: inline center; mobile: second row. Define exact breakpoints/classes in the style guide (below).
- **Style guide (`docs/style-guide.md`) — required before/with the UI:** document the **web header search** element (input, results dropdown rows, loading/empty/no-results/unavailable states, the attribution line, keyboard/click-away behavior, and the desktop-inline vs mobile-second-row responsive layout), per the mandatory style-guide rule in `CLAUDE.md`.

### 4.2 Handoff to the map — one canonical URL contract (works cross-page + shareable)
The header is global (a non-map page has no map). On select, `HeaderSearch` navigates to the map with the
target encoded in the URL, so it both **recenters on the map page** and **navigates there from any other
page** (mirroring mobile's Search). **Exactly one wire format — no alternatives:**
- **`flyto=lng,lat`** (required) and **`bbox=west,south,east,north`** (optional) — all **finite decimal
  numbers** (comma-separated, no JSON).
- **Validation (identical on the writer and the reader):** `lng ∈ [-180,180]`, `lat ∈ [-90,90]`; for bbox
  `west,east ∈ [-180,180]`, `south,north ∈ [-90,90]`, `south < north`, `west < east`. A **pure
  `parseFlyToParam(searchParams)`** helper returns `{ center:[lng,lat], bbox?:[w,s,e,n] } | null`: an invalid
  **bbox** is dropped (fall back to a center fly); an invalid/absent **center** yields `null` (do nothing but
  clear). URL params are user-controllable, so this validation is a security boundary, not just UX.
- **Writer** (`HeaderSearch`): `router.push("/?flyto=" + lng+","+lat + (bbox ? "&bbox="+w+","+s+","+e+","+n : ""))`
  (the map-relative path `/` so it works from any page).
- **Reader/clear** (`MapBrowser`, §4.3): after consuming, **remove only `flyto` and `bbox`** from the current
  query string via `router.replace(urlWithoutThoseTwoParams, { scroll: false })` — preserving any unrelated
  params (e.g. `add`, `debug`) — and record the consumed raw param string in a ref so the effect **cannot
  re-fire during the `replace`** or hijack a subsequent manual pan.

### 4.3 Map consumes it — `web/components/map/MapBrowser.tsx`
- Read the params via `useSearchParams()` in an effect keyed on the raw `flyto`/`bbox` strings; parse with the
  shared `parseFlyToParam` (§4.2). When it returns non-null, apply a **pure `deriveCameraAction(parsed)`**
  helper that chooses between two camera moves (and is the unit-tested seam — it decides the action, MapBrowser
  just executes it on `mapRef`):
  - **bbox present** → `{ kind:"fit", bounds:[[west,south],[east,north]], maxZoom: PLACE_MIN_ZOOM, padding: 48 }`
    → `map.fitBounds(bounds, { maxZoom, padding, duration })`. `PLACE_MIN_ZOOM` is the **existing**
    `web/lib/map/constants.ts` constant (16 — the add/fountain-precision threshold); using it as the `maxZoom`
    cap means an **address zooms in to the fountain-visible level** while a **country's huge bbox stays wide**
    (fitBounds naturally won't exceed the cap) — exactly the owner's rule. Do **not** introduce a new
    `FOUNTAIN_ZOOM`.
  - **no bbox** → `{ kind:"fly", center:[lng,lat], zoom: NEIGHBORHOOD_ZOOM }` → `map.flyTo(...)`.
    `NEIGHBORHOOD_ZOOM` is the **existing** constant (14).
- **Clearing is unconditional when a param is present:** if either raw `flyto` **or** raw `bbox` is present,
  the effect clears **both** (per §4.2, `router.replace(..., { scroll:false })`) after parsing — **even when
  `parseFlyToParam` returns `null`** (invalid params), so bad user-controlled params can't linger in the URL
  or keep the effect alive. If neither param is present, the effect does nothing. It records the consumed raw
  param in a ref so it can't re-fire on the `replace` or hijack a later manual pan. (A valid parse also
  applies the camera action before clearing; an invalid one clears without moving the map.)
- Reuse the existing `mapRef`; do not disturb the existing `moveend`/geolocation/`add`-mode logic.

## 5. Testing
- **Backend (local):** `bounding_box` parse/None cases in `test_geocode.py`; OpenAPI check that `GeocodeResult.bounding_box` is present + optional.
- **Web (local, pure + jsdom where infra allows):** the pure search state/query module (normalize, min-length, stale-drop, `bounding_box` mapping); **`parseFlyToParam`** — round-trip + every rejection case (missing/partial/non-finite/out-of-range center → null; invalid/inverted/zero-area/out-of-range bbox dropped to a center fly); **`deriveCameraAction(parsed)`** — bbox present → `{kind:"fit", maxZoom: PLACE_MIN_ZOOM, padding}`; absent → `{kind:"fly", zoom: NEIGHBORHOOD_ZOOM}`; and the **no-auth-header** test on the geocode client helper. Web has vitest (some render tests are CI-verified; keep the new logic pure + covered). `next build` + tsc via CI.
- **Mobile (local):** tsc + eslint + prettier; existing pure suites still green after the client regen. The Search-tab fix (§3.3, committed `cb5bd5a`) passes tsc/eslint; its on-device render is **owner/emulator-verified on the next build**. Logo/locate render = CI/owner-verified (no RN render infra).
- Regenerate the api-client so web + mobile typecheck against the new `bounding_box` field.

## 6. Security / cost
No new endpoint; web reuses the existing public `/api/v1/geocode` (same provider hard-quota spend model, no-overage). The browser calls it directly with **no auth header** (public); no key is ever exposed client-side (the key stays server-side in the proxy). Same LocationIQ/OSM attribution shown on web. CORS already allows the web origins.

## 7. Out of scope / follow-ups
- Mobile search zoom-to-granularity (mobile keeps fixed `PLACE_MIN_ZOOM`; could adopt `bounding_box` later).
- Search history / reverse geocoding / POI search. Gating the mobile SearchOverlay against add-mode (separate polish).

## 8. Delivery
One branch (`fix/web-search-and-mobile-polish`) → PR: backend (bbox + tests + OpenAPI) + mobile (logo asset, locate glyph, Search-tab fix already committed) + web (HeaderSearch, MapBrowser camera, pure libs, style guide) + client regen. Codex spec review (this doc) before code; Codex PR review before merge; **all required CI checks green** + every comment addressed → squash-merge → **trigger the CI deploy workflow** (`deploy.yml`, web+backend) and **run the mobile store-release workflow** (both are CI/workflow-driven; never a local deploy). No AI attribution; no time estimates.

## 9. Acceptance criteria
- Mobile header shows the transparent pin (no circle/box); locate button shows a standard blue location mark in the white circle; the Search tab is present in the nav (new build).
- Web header has an ever-present search box; typing shows geocode results with attribution; selecting a result recenters the web map and **zooms to fit the result's extent, capped so an address reaches the fountain-visible zoom while a country stays wide**.
- Geocode API key never reaches the browser (no `Authorization` header on the web geocode call); endpoint stays public; provider no-overage spend model intact.
- **All required CI checks green** and Codex `VERDICT: APPROVED`. (The `mobile-doctor` Expo-patch check is a known, pre-existing supply-chain-policy time-drift affecting `main`; it is handled through the normal project process — it self-resolves as the patches age past the `minimumReleaseAge` window, and merging while it is red remains an explicit owner decision, not an acceptance-criterion carve-out here.)
