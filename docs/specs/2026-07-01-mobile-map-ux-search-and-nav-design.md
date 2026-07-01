# Mobile map UX: brand logo, 5-item nav, profile-photo tab, and address/city search — design

**Status:** owner-approved design (owner-approved 2026-07-01), pending Codex spec/plan review.
**Driver:** owner UX review of the live Android map screen (screenshots in-session). Four changes to the
mobile map experience plus one new backend endpoint that powers search.
**Scope note:** **mobile-only UI** (Android + iOS). The one backend addition — a geocoding **proxy**
endpoint — is provider-agnostic and reusable by web later, but **web UI is untouched** in this work.

---

## 1. Goal

Improve the mobile map screen along four owner-identified axes, and add the backend that one of them
needs:

1. **Real brand logo** in the map header (today it renders a generic Ionicons `water` glyph).
2. **Five-item bottom nav** — `Map · Search · ＋ · Rankings · Profile` — with the `＋` FAB truly
   centered, and a **safe-area fix** so the bar stops crowding the Android system-nav.
3. **Profile tab shows the user's photo** (their `avatar_url`) instead of a generic person glyph.
4. **Address/city search**: a search field that geocodes typed text and recenters the map, backed by a
   hosted geocoding provider **proxied through our FastAPI backend** (API key stays server-side,
   provider swappable without an app release).

Points → Rankings is already wired (`onPointsPress` opens the leaderboard) — **no work**.

## 2. Why search is net-new (not "we already have a map")

Our map is **MapLibre** (`@maplibre/maplibre-react-native`) rendering **self-hosted vector tiles**
(`fountainrank.com/tiles/planet.json`, go-pmtiles; `web/lib/map/style.ts`, `infra/k8s/basemap-tiles.yaml`).
Tiles answer "draw the world at this lat/lng/zoom" — they carry **no address index and no text lookup**.
**Geocoding** (text → coordinate) is a separate search service we never stood up, and because we
self-host tiles we get no geocoder "for free" from a tile vendor. Hence a new provider + proxy.

## 3. What already exists (no rework)

- **Brand logo asset:** `mobile/assets/icon.png` (blue pin + gold crown + water spray). The header just
  isn't using it — `mobile/app/(tabs)/index.tsx` `MapHeader` draws `<Ionicons name="water" …>`
  (index.tsx:575).
- **Camera fly:** `mobile/components/map/FountainMap.tsx` exports `MapFlyTo` and takes a `flyTo` prop that
  calls `cameraRef.flyTo({ center, zoom, padding })`. The map screen already owns the state
  (`const [flyTo, setFlyTo] = useState<MapFlyTo | null>(null)`, index.tsx:104) and drives it from several
  places (place chips, cluster expansion). **Search recenters by calling `setFlyTo`** — no new map plumbing.
- **Tab→map signal pattern:** `mobile/lib/navigation/add-tab.ts` is a tiny pub/sub
  (`requestMapAddMode` / `subscribeMapAddMode`) that lets the tab-bar Add button (in `(tabs)/_layout.tsx`)
  tell the map screen to enter add-mode. **Search mirrors this** with a parallel signal.
- **Placeholder-screen + custom `tabBarButton` pattern:** `(tabs)/add.tsx` is just `<Redirect href="/" />`;
  the real behavior lives in the `tabBarButton` in `_layout.tsx`. **Search mirrors this** with a
  `(tabs)/search.tsx` redirect + a custom button.
- **Avatar already delivered and rendered on the account screen:** backend syncs `picture` from Logto and
  returns `avatar_url` on `GET /api/v1/me` (`app/userinfo.py` `accept_avatar`, `app/schemas.py`
  `MeResponse.avatar_url`); `(tabs)/account.tsx:188` already renders `profile.avatar_url` with a
  `profileInitial` fallback. `MeProfile` (`mobile/lib/auth/profile.ts`) exposes it. The **Profile tab icon**
  is the only place that ignores it.
- **`["me"]` query is already fetched in the tab layout** (the `NameGate` in `_layout.tsx`), so the tab
  icon can read `avatar_url` from the same cache — no extra request.
- **Safe-area context is already a dependency** (`react-native-safe-area-context`, used in
  `components/ScreenContainer.tsx`, `app/_layout.tsx`).
- **Outbound-HTTP-with-guards precedent:** `app/userinfo.py` shows the house pattern for calling an external
  HTTP API — `httpx.AsyncClient(timeout=…)`, streamed body with a max-bytes cap, and a typed error mapped to
  an HTTP status. The geocode provider call follows the same shape.
- **Typed API client:** mobile calls the backend through the generated openapi-fetch client
  (`useApi().client`, `mobile/lib/api.ts`); once the OpenAPI is regenerated, `GET /api/v1/geocode` is typed
  like every other call.

## 4. Owner-approved decisions

1. **Hosted geocoder, proxied through the backend.** The provider API key lives server-side; the app never
   holds it. The backend normalizes provider responses to our own shape so the provider is swappable with a
   backend-only change (no app release).
2. **Default provider: LocationIQ** (5k req/day free tier, OSM-based data consistent with our fountains,
   dedicated autocomplete endpoint). MapTiler is an acceptable drop-in alternative; the proxy is
   provider-agnostic, so the choice is a setup-time decision, not a code fork.
3. **Search is an overlay, not a destination.** Tapping the Search tab opens a search field over the live
   map; picking a result recenters the existing map. It is not a separate browsable screen.
4. **Mobile-only UI, one backend endpoint.** Web chrome is untouched.
5. **One branch → one PR** across backend + mobile (+ OpenAPI regen + style-guide), then one web+backend
   deploy (backend only changes here) and one mobile store release.

## 5. Bottom navigation (`mobile/app/(tabs)/_layout.tsx`)

### 5.1 Layout
Five tabs, in this registration order (expo-router renders tabs in registration order):

| Position | `name` | Kind | Behavior |
|---|---|---|---|
| 1 | `index` | screen | Map |
| 2 | `search` | action button | navigate to `/` + `requestMapSearch()` (new placeholder `(tabs)/search.tsx` = `<Redirect href="/" />`) |
| 3 | `add` | action button | unchanged (`/` + `requestMapAddMode()`), now centered — this is the FAB |
| 4 | `leaderboard` | screen | Rankings |
| 5 | `account` | screen | Profile |

`add` moving from 3rd-of-4 to the literal middle of 5 makes the FAB centered by construction (its existing
`styles.addTabCircle` with `marginTop: -18` stays). Search reuses the same `tabBarButton` + placeholder
pattern as Add, so no new navigation concepts are introduced.

### 5.2 Safe-area fix
The current `tabBarStyle` (`styles.tabBar`) sets a fixed `minHeight: 64` with only `paddingTop` and **no
bottom inset**, so the bar jams against the Android system-nav (the "crowding" the owner flagged). Fix:
compute the tab-bar style from `useSafeAreaInsets().bottom` — bar height `= BASE + insets.bottom`,
`paddingBottom = insets.bottom`. Because `screenOptions` is static in the file today, the layout becomes a
small function component that reads the insets and passes a computed `tabBarStyle` (and keeps
`tabBarActiveTintColor` etc.). With **five** labeled items the per-item width shrinks, so labels render
single-line at a slightly smaller size (`tabBarLabelStyle` fontSize ~10–11, `numberOfLines={1}`) to keep
"Rankings"/"Profile" from truncating.

### 5.3 Profile tab icon = the user's photo
Replace the static `person-circle` glyph for the `account` tab with the avatar, reusing the exact pattern
from `account.tsx:188`:

- Read `avatar_url` from the shared `["me"]` query (already fetched by `NameGate`). A tiny `ProfileTabIcon`
  component subscribes to that query.
- When `avatar_url` is present → a circular `<Image>` sized to the tab icon (`focused` gets a brand-blue
  ring to preserve the active-state affordance). When absent (anonymous, or no photo) → fall back to the
  existing `person-circle` Ionicon (not initials in the tab — a 1-char initial is illegible at tab size;
  initials remain the account-screen fallback).
- Loading/error of the image falls back to the glyph (no broken-image box).

## 6. Header logo (`mobile/app/(tabs)/index.tsx` `MapHeader`)

Replace `<Ionicons name="water" …>` (index.tsx:575) with the brand mark from `assets/icon.png`, rendered as
a small `<Image>` (~24–28px, `resizeMode="contain"`) in the existing header badge. `icon.png` is a
transparent-background square, so it composes cleanly on the blue header. No new art; no other header change
(title, subtitle, points chip stay as-is). If the full app-icon pin reads too busy at header size during
implementation, we trim/pad a header-optimized variant under `assets/` — decided by eye in the plan, not a
blocker here.

## 7. Search UX (mobile)

### 7.1 Interaction
- The Search tab-bar button navigates to the map and fires `requestMapSearch()` (new
  `mobile/lib/navigation/map-search.ts`, structured exactly like `add-tab.ts`).
- The map screen (`(tabs)/index.tsx`) subscribes via `subscribeMapSearch` and opens a **search overlay**
  anchored to the top of the map: a text input (autofocus, "Search address or city") + a results list, over
  a scrim. A close/back control and Android hardware-back both dismiss it.
- **Debounced autocomplete:** on input change, debounce (~300 ms) and, once the trimmed query is ≥ 3 chars,
  call `GET /api/v1/geocode`. Results render as a tappable list (primary label + secondary context).
- **Optional viewport bias:** the request includes the current map center (`lat`/`lng`) so the provider
  biases toward what the user is looking at ("Main St" → the nearby one). Bias is a hint, not a filter.
- **Selecting a result** dismisses the overlay and calls `setFlyTo({ center: { lat, lng }, zoom:
  PLACE_MIN_ZOOM })` (reusing the existing constant the place chips use). A **transient "searched location"
  marker** is dropped at the result and cleared on the next map interaction or a new search (kept separate
  from fountain pins; it is not a fountain).
- **States:** idle/empty (recent-free; no history in v1), loading (spinner in the list), no-results
  ("No matches"), and error/unavailable ("Search is unavailable right now") — reusing existing state
  components where they fit (`components/states/*`).

### 7.2 Client logic (kept pure + unit-tested)
- `mobile/lib/map-search/state.ts` — a pure reducer/helper for the search box: query normalization
  (trim, min-length gate), debounce-key derivation, and mapping an API result set / error into view state
  (`idle | loading | results | empty | error`). No rendering, no network — unit-tested.
- `mobile/lib/map-search/query.ts` — builds the typed `client.GET("/api/v1/geocode", { params })` call and
  maps the typed response to the list model `{ id, label, latitude, longitude }`. The provider is invisible
  to the app; it only sees our normalized shape.
- The overlay component (in `components/map/…`) is thin: it renders state and calls `setFlyTo` on select.

## 8. Backend geocode proxy

### 8.1 Endpoint — `GET /api/v1/geocode` (new `backend/app/routers/geocode.py`)
- **Query params:**
  - `q: str` — required; **trimmed; min 3, max 120 chars** (pydantic `StringConstraints`). Below min or
    empty → `422`.
  - `limit: int = 5` — clamped server-side to `1..10` (never trust the client to bound provider cost).
  - `lat: float | None`, `lng: float | None` — optional viewport-bias hint; validated to real ranges
    (`lat ∈ [-90, 90]`, `lng ∈ [-180, 180]`); both-or-neither (one without the other → ignore bias, do not
    `422`).
- **Response:** `GeocodeResponse { results: list[GeocodeResult] }`, where
  `GeocodeResult { label: str, latitude: float, longitude: float }`. **`latitude`/`longitude` naming matches
  the house API convention** (the API speaks `latitude`/`longitude`; PostGIS `(lon, lat)` ordering is not
  involved here — these coordinates are never persisted and never touch PostGIS; they only feed the map
  camera).
- **Auth:** **public/unauthenticated** — browsing/reads are public in this app, and forcing sign-in to
  search would break that principle. Abuse is handled in §8.3, not by an auth wall.
- **Registration:** included in the app factory alongside the other routers (`app/main.py`), under the same
  `/api/v1` prefix.

### 8.2 Provider abstraction (swap = backend-only)
- A small `GeocodeProvider` protocol: `async def search(q, limit, bias) -> list[GeocodeResult]`.
- One implementation, `LocationIQProvider`, calls the provider's autocomplete endpoint over `httpx`
  following the `userinfo.py` guards (explicit `timeout`, streamed body capped at a max-bytes limit, typed
  errors), reads the API key from settings, sends the required format params, and normalizes each hit into a
  `GeocodeResult` (a human `label` from the provider's display name; `latitude`/`longitude` as floats).
- The router depends on a `get_geocode_provider` factory (FastAPI dependency), so endpoint tests inject a
  **fake provider** (or a fake `httpx` transport) and run with **no network** — same testing seam as
  `get_userinfo_fetcher`.

### 8.3 Cost/abuse protection (public proxy to a metered API)
The endpoint is an open proxy to a rate-limited/paid provider, so it must protect spend:
- **Input bounds** (§8.1): min/max query length and a clamped `limit` cut junk and cap per-call cost.
- **Short-TTL response cache:** an in-process TTL cache keyed by `(normalized_q, limit, rounded_bias)` with
  a small TTL (a few minutes) collapses autocomplete bursts and duplicate queries into one upstream call.
  Bounded size (LRU) so it can't grow unbounded.
- **Rate caps:** a lightweight in-process limiter with **(a)** a global cap (a ceiling on upstream calls per
  window, the hard spend guard) and **(b)** a best-effort per-client cap keyed by the already-established
  request client-ip (the same value the request-logging middleware derives). Over the limit → `429` with a
  short `Retry-After`; the client surfaces the "unavailable" state and backs off. Per-instance limits are
  acceptable for v1 (a coarse spend guard, not a fairness SLA); a shared/distributed limiter is out of scope
  (§11).
- **Provider free-tier headroom:** LocationIQ's 5k/day comfortably covers early usage with the cache in
  front; if we ever approach it, the swap-friendly design lets us change providers or self-host Photon later
  without touching the app.

### 8.4 Config & secrets (`backend/app/config.py`)
Add settings following the **email-connector pattern** (secret defaults `None` → feature disabled, never a
crash):
- `geocoding_provider: str = "locationiq"`
- `geocoding_api_key: str | None = None`
- `geocoding_base_url: str | None = None` (provider default applied when unset)
- `geocoding_cache_ttl_seconds: int`, `geocoding_rate_limit_*` (window + caps) with sane defaults.
- `geocoding_enabled` property = `bool(geocoding_api_key)`.

When `geocoding_enabled` is false (local dev/tests without a key, or a misconfig), the endpoint returns
**`503` `geocoding_disabled`** (never a 500, never a crash), and the client shows the "unavailable" state.

**Secret delivery:** `GEOCODING_API_KEY` is added to the master secret inventory (`docs/setup/README.md`),
provisioned as a GitHub environment secret and mounted as a k8s secret in the backend deployment (per
`claude_help/github-environments.md`). It is **never committed**, never logged, and never sent to the
client.

## 9. Logging & observability (`geocode.py`)

Per the project logging standard:
- **INFO** per geocode request: query **length** (never the raw text — a typed address/city is
  user-controlled location data; treat as PII and redact), `result_count`, `limit`, whether bias was
  applied, `cache: hit|miss`, and upstream latency on a miss. Include the request id already attached by the
  middleware.
- **WARNING/ERROR** on upstream failure with a short machine reason (`timeout`, `provider_status`,
  `too_large`, `malformed`) — **never** the API key or full URL (the key is a query/header param upstream;
  redact). A provider failure maps to `502 geocoding_upstream` (mirrors `userinfo.py`'s `UserinfoError` →
  502), logged, never silent.
- **Rate-limit rejections** logged at INFO (client-ip + which cap) so throttling is diagnosable.
- **Startup:** the resolved geocoding config is logged with the **key redacted** (provider + enabled flag
  only), consistent with the existing redacted-config startup log.

## 10. Style guide (`docs/style-guide.md`)

Document the new/changed UI elements before/with the work:
- **Bottom navigation** (5-item, centered FAB, safe-area padding, active/inactive states, the avatar tab
  icon + its glyph fallback).
- **Search overlay** (input, results list rows, loading/empty/no-results/unavailable states, the attribution
  line — see §12).

## 11. Out of scope (YAGNI)

- Web search UI (the proxy is reusable, but no web work here).
- Search history / recent searches / saved places.
- Reverse geocoding, POI/business search, "search this area" re-query, or filtering results by fountain
  presence.
- A shared/distributed rate limiter or per-account quotas (in-process caps are the v1 guard).
- Self-hosting the geocoder (Photon/Nominatim) — explicitly deferred; the swap-friendly proxy keeps it a
  future backend-only change.
- Avatar upload/editing (the photo comes from Logto; this only *displays* it).

## 12. Attribution & provider ToS

LocationIQ (OSM-derived) requires attribution. The search overlay shows the required credit
(provider + "© OpenStreetMap contributors") in the results area, consistent with how the basemap already
attributes OSM. Confirmed against the provider's current ToS at implementation time; if the chosen provider
demands a specific string/placement, we match it.

## 13. Testing

**Backend (fully CI-verifiable locally):**
- `geocode.py` endpoint via the injected fake provider/transport (no network):
  - happy path → normalized `{ label, latitude, longitude }` list; `limit` clamped to `1..10`;
  - validation matrix — `q` empty/<3/>120 → `422`; `lat` without `lng` (and out-of-range) → bias ignored /
    `422` as specified;
  - `geocoding_enabled` false → `503 geocoding_disabled`;
  - provider error (fake raises) → `502 geocoding_upstream`, logged, no 500;
  - cache hit collapses two identical queries into one upstream call (assert the fake is called once);
  - rate-limit: N calls over the window → `429` with `Retry-After`.
- `LocationIQProvider` normalization unit-tested against captured/synthetic provider JSON (label building,
  float parsing, malformed-entry skipping) — no live network.
- **No log leaks:** a test asserts the geocode logs never contain the raw query text or the API key.
- OpenAPI: `GET /api/v1/geocode` present with the documented params + `GeocodeResponse` (extend
  `test_openapi.py`).

**Mobile (pure-logic local; render/route CI-/owner-verified per the Windows/WSL env note):**
- `lib/map-search/state.ts` — normalization/min-length gate, debounce-key derivation, API-result/error →
  view-state mapping.
- `lib/map-search/query.ts` — params building + typed-response → list-model mapping.
- `lib/navigation/map-search.ts` — pub/sub deliver/pending semantics (mirror `add-tab` tests).
- A pure helper for the **profile tab icon** decision (`avatar_url` present → image, else glyph), unit-tested
  without rendering.
- Regenerate the api-client (`export_openapi` → `openapi-typescript`) so `/api/v1/geocode` is typed.
- Render/overlay/nav-integration and on-device map recentering are CI-/owner-verified (native map + camera
  can't run in the JS unit env) — see `claude_help/testing-ci.md` and the Windows/WSL note.

## 14. Delivery / process

One branch (`feat/mobile-map-ux-search-nav`) → PR: backend (geocode router/provider/schemas/config +
tests) + mobile (nav, header logo, profile tab icon, search overlay + libs + tests) + OpenAPI regen +
style-guide. Codex **spec/plan** review before code and Codex **PR** review before merge (bypass mode, WSL
`cwd` derived from the repo root, repo-relative paths, loop to `VERDICT: APPROVED`); CI green + every PR
comment addressed → **squash-merge**. Owner adds `GEOCODING_API_KEY` to the backend environment before the
search path works in production. Then `gh workflow run deploy.yml --ref main` (backend) and the mobile store
release workflow. No AI attribution; no time estimates.

## 15. Owner dependency (external registration)

Register a geocoding account (**LocationIQ** recommended; MapTiler acceptable), obtain an API key, and add
it as `GEOCODING_API_KEY` to the backend environment secrets (per `docs/setup/README.md` +
`claude_help/github-environments.md`). Until the key is set, the endpoint returns `503 geocoding_disabled`
and the search UI shows "unavailable" — everything else in this work ships and functions without it.

## 16. Acceptance criteria

- The map header shows the FountainRank brand mark (not a generic droplet).
- The bottom nav shows `Map · Search · ＋ · Rankings · Profile` with the `＋` FAB centered, clears the
  Android system-nav (no crowding), and no label truncates.
- The Profile tab shows the signed-in user's photo when they have one, falling back to the person glyph
  otherwise.
- Typing an address or city in the search overlay returns matches and selecting one recenters the map on
  that location; empty/no-results/offline/unavailable states are handled.
- The geocoding API key exists only server-side; it never appears in the app bundle, the client, logs, or
  git. The endpoint enforces input bounds, a clamped `limit`, caching, and rate caps; a missing key yields
  `503`, a provider failure `502` — never a silent 500.
- Backend CI (ruff + format + pytest, OpenAPI check) and mobile CI (type-check + lint + unit tests) are
  green; Codex `VERDICT: APPROVED`; every PR comment addressed.
