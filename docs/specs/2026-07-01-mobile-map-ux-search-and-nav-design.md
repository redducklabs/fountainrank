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

### 5.2 Safe-area fix — exact layout contract
The current `tabBarStyle` (`styles.tabBar`) sets a fixed `minHeight: 64` with only `paddingTop` and **no
bottom inset**, so the bar jams against the Android system-nav (the "crowding" the owner flagged). Because
`screenOptions` is static in the file today, `TabsLayout` becomes a small function component that reads
`useSafeAreaInsets()` and passes a computed `tabBarStyle`. Exact contract (so it doesn't churn in the plan):

- Define `const BAR_CONTENT_H = 56` (icon+label content height) and `const BOTTOM_PAD = Math.max(insets.bottom,
  ANDROID_MIN_PAD)` where `ANDROID_MIN_PAD = 8` — Android 3-button nav often reports `insets.bottom === 0`,
  so the fallback keeps the bar off the system chrome even then.
- Tab bar uses a **fixed `height = BAR_CONTENT_H + BOTTOM_PAD`** (not `minHeight`, which lets content
  reflow) and **`paddingBottom = BOTTOM_PAD`**, `paddingTop = spacing.xs`.
- The **custom `tabBarButton`s (Search + Add)** must receive the *same* vertical contract as the native tab
  buttons: their container gets `paddingBottom: BOTTOM_PAD` (mirroring the native button) so the yellow Add
  FAB and the Search glyph sit on the same baseline as Map/Rankings/Profile. The Add FAB's existing
  `marginTop: -18` lift is preserved relative to that baseline.
- With **five** labeled items the per-item width shrinks, so labels render single-line at a slightly smaller
  size (`tabBarLabelStyle` `fontSize` 10, `numberOfLines={1}`) to keep "Rankings"/"Profile" from truncating.

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
- **Data-access rule (no stray request):** `ProfileTabIcon` reads the `["me"]` query **cache-only** using
  the *same* `enabled: shouldEnableProfileQuery(auth.status)` + retry policy that `NameGate` already uses, so
  it never triggers a profile fetch while signed out or while auth is still settling. When the query is
  disabled/empty (anonymous, error, loading) it renders the glyph with **no network request** — the icon is
  a pure read of whatever `NameGate` has already cached. A tiny pure helper
  (`profileTabIcon(avatarUrl, focused)` → `"image" | "glyph"`) holds the decision for unit testing.

## 6. Header logo (`mobile/app/(tabs)/index.tsx` `MapHeader`)

Replace `<Ionicons name="water" …>` (index.tsx:575) with the brand mark from `assets/icon.png`, rendered as
a small `<Image>` (~24–28px, `resizeMode="contain"`) in the existing header badge. `icon.png` is a
transparent-background square, so it composes cleanly on the blue header. No new art; no other header change
(title, subtitle, points chip stay as-is). If the full app-icon pin reads too busy at header size, any
header variant is limited to **crop/pad/resize of the existing `assets/icon.png` source only** (no new
illustration, no recolor) so the brand mark stays identical; if a distinct header asset file is added it is
committed under `assets/` and **documented in `docs/style-guide.md`**.

## 7. Search UX (mobile)

### 7.1 Interaction
- The Search tab-bar button navigates to the map and fires `requestMapSearch()` (new
  `mobile/lib/navigation/map-search.ts`, structured exactly like `add-tab.ts`).
- The map screen (`(tabs)/index.tsx`) subscribes via `subscribeMapSearch` and opens a **search overlay**
  anchored to the top of the map: a text input (autofocus, "Search address or city") + a results list, over
  a scrim. A close/back control and Android hardware-back both dismiss it.
- **Debounced autocomplete:** on input change, debounce (~300 ms) and, once the trimmed query is ≥ 3 chars,
  call `GET /api/v1/geocode`. Results render as a tappable list (primary label + secondary context).
- **Stale-response guarding (no out-of-order overwrite):** each dispatched request carries a monotonically
  increasing sequence id; a response is applied **only if** its id is the latest dispatched (older, slower
  responses are dropped), and the in-flight request is aborted (`AbortController`) when the query changes or
  the overlay closes. This prevents a slow response for an older query from overwriting newer results or
  leaving a selectable stale coordinate. The rule lives in the pure state helper (§7.2) and is unit-tested.
- **Optional viewport bias:** the request includes the current map center (`lat`/`lng`) so the provider
  biases toward what the user is looking at ("Main St" → the nearby one). Bias is a hint, not a filter.
- **Selecting a result** dismisses the overlay and calls `setFlyTo({ center: { lat, lng }, zoom:
  PLACE_MIN_ZOOM })` (reusing the existing constant the place chips use).
- **Transient "searched location" marker.** The result gets its **own dedicated GeoJSON source + symbol
  layer** (`search-result`), distinct from both the `fountains` source and any `draft-fountain` add-mode
  source — it is not a fountain and must never be clustered or tapped-through to a fountain detail. Lifecycle,
  made explicit because `FountainMap` emits `onRegionDidChange` after *programmatic* flights too: the marker
  is **not** cleared by the `setFlyTo` that places it (the screen already distinguishes a programmatic fly
  from a user gesture — the fly is issued by our own `setFlyTo`, so the immediately-following region change is
  ignored for clear purposes). It **is** cleared by (a) a subsequent *user-initiated* map gesture (pan/zoom —
  i.e. a region change with `isUserInteraction`/gesture origin, or an `onPress` on the map), (b) starting a
  new search, or (c) selecting a fountain pin. If the map library can't cleanly distinguish programmatic vs
  user region changes on this RN/maplibre version, the fallback is a short "ignore region-change clears for N
  ms after our own fly" guard keyed off the `flyTo` dispatch — specified here so it isn't rediscovered mid-plan.
- **States:** idle/empty (recent-free; no history in v1), loading (spinner in the list), no-results
  ("No matches"), and error/unavailable ("Search is unavailable right now") — reusing existing state
  components where they fit (`components/states/*`).

### 7.2 Client logic (kept pure + unit-tested)
- `mobile/lib/map-search/state.ts` — a pure reducer/helper for the search box: query normalization
  (trim, min-length gate), debounce-key derivation, monotonic request-sequence tracking (apply a result only
  when its seq is the latest; drop stale), and mapping an API result set / error into view state
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
  - `lat: float | None`, `lng: float | None` — optional viewport-bias hint. **Range is validated whenever a
    value is present** (`lat ∈ [-90, 90]`, `lng ∈ [-180, 180]`) via `Query(ge=…, le=…)` — an out-of-range
    value is a **`422`** even if its pair is missing (a client sending `lat=999` is buggy, not "biasing").
    Bias is **applied only when both are present and valid**; exactly one valid coordinate without its pair
    → bias silently **ignored** (not a `422` — a partial hint is just dropped). This single rule is the one
    tested (no "ignored / 422" ambiguity).
- **Response:** `GeocodeResponse { results: list[GeocodeResult] }`, where
  `GeocodeResult { label: str, latitude: float, longitude: float }`. **`latitude`/`longitude` naming matches
  the house API convention** (the API speaks `latitude`/`longitude`; PostGIS `(lon, lat)` ordering is not
  involved here — these coordinates are never persisted and never touch PostGIS; they only feed the map
  camera).
- **Auth:** **public/unauthenticated** — browsing/reads are public in this app, and forcing sign-in to
  search would break that principle. Abuse is handled in §8.3, not by an auth wall.
- **Registration:** included in the app factory alongside the other routers (`app/main.py`), under the same
  `/api/v1` prefix.

### 8.2 Provider abstraction (swap = backend-only) — no SSRF surface
- A small `GeocodeProvider` protocol: `async def search(q, limit, bias) -> list[GeocodeResult]`.
- One implementation, `LocationIQProvider`. **The provider host/base URL is a hardcoded per-provider code
  constant** (e.g. `https://us1.locationiq.com/v1/autocomplete`), **not** an operator-configurable setting —
  this removes the SSRF/misrouting footgun entirely (there is no `GEOCODING_BASE_URL` env knob; §8.4). The
  user query and the (validated) bias only ever fill **query-string params**; they never influence the host,
  scheme, or path.
- The outbound call follows the `userinfo.py` guards, hardened for a public endpoint: **HTTPS-only** (the
  constant is `https://`), **`follow_redirects=False`** (a redirect is a provider/misconfig error, never
  chased — this is the anti-SSRF backstop), explicit `timeout`, streamed body capped at a max-bytes limit,
  and typed errors. The API key is read from settings and passed as the provider's key param/header; it is
  **never** placed in a logged URL (§9).
- Normalization: each hit → `GeocodeResult` (`label` from the provider's display name; `latitude`/`longitude`
  parsed as floats; malformed/incomplete entries skipped, not surfaced).
- The router depends on a `get_geocode_provider` factory (FastAPI dependency), so endpoint tests inject a
  **fake provider** (or a fake `httpx` transport) and run with **no network** — same testing seam as
  `get_userinfo_fetcher`. A provider-level test asserts a redirect response is **not** followed and that no
  code path lets the query control host/scheme/path.

### 8.3 Cost/abuse model (public proxy to a metered API)
The endpoint is an open, unauthenticated proxy to a metered provider, so the design must make the **worst-case
spend bounded and non-surprising**. The honest topology matters: DOKS runs **multiple backend replicas**, each
with its own memory, so any in-process counter/cache is **per-pod** — a global in-process cap of *C* actually
permits `C × replica_count` upstream calls and resets on restart/rollout. Therefore an in-process limiter is
**not** the hard spend guard, and we do not pretend it is.

**The hard spend guard is the provider account itself, on a no-overage tier.** v1 runs on a plan whose quota
is a **hard cap with no overage billing** (LocationIQ's free tier: 5k requests/day, requests beyond it are
`429`'d by the provider, *not* billed). So the maximum possible cost is fixed by the plan regardless of
replica count, cache behavior, or abuse volume — the provider stops serving rather than spending our money.
This is stated as an **operational constraint**: we do not move `GEOCODING_API_KEY` onto an overage-billed
tier without first adding a shared/distributed limiter (§11). When the provider returns quota-exhausted/`429`,
the endpoint **fails closed** to `503 geocoding_unavailable` (never a retry storm), logs it (§9), and the
client shows the "unavailable" state.

Layered in front of that hard cap, purely to reduce upstream calls and shield users from provider throttling
(**best-effort UX, explicitly not the cost ceiling**):
- **Input bounds** (§8.1): min/max query length and a `limit` clamped to `1..10` cut junk and cap per-call
  fan-out.
- **Short-TTL, in-process response cache** keyed by `(normalized_q, limit, rounded_bias)`, small TTL (a few
  minutes), bounded LRU size. Per-pod and **process-local only** (never shared, never persisted). **Privacy
  posture:** the key contains the normalized query, which is user-typed location data (PII) — so the cache is
  memory-only, short-lived, bounded, and its keys/contents are **never** exposed in logs, metrics, or any
  diagnostics endpoint (§9 already forbids logging the raw query).
- **Coarse in-process throttle:** a lightweight per-pod global token bucket to smooth bursts. It is a
  politeness/UX guard, **not** a security or spend boundary, and the spec does not claim otherwise.
  Over-limit → `429` + short `Retry-After`; the client backs off.
- **No per-client-IP limiting in v1 — deliberately.** The request-logging middleware derives the client from
  `scope.client[0]` (`backend/app/middleware.py`), which **behind ingress-nginx/DOKS is the ingress/LB peer,
  not the end user**, and client-supplied `X-Forwarded-For` is spoofable. A per-IP limit built on that would
  either collapse all users to one key or be trivially bypassed — worse than useless. A *correct* per-client
  limit needs a trusted-proxy policy (which forwarded header, how many trusted hops, reject spoofed values) +
  a shared store; that is **out of scope (§11)** and not required because the provider hard cap already bounds
  spend. We do **not** rely on it.
- **CORS is not an abuse boundary.** `cors_allow_origins` gates *browser* origins only; it does nothing
  against server-to-server or native-client calls, so it is not part of the abuse model — the provider hard
  cap is. CORS config is unchanged; the native app is not origin-gated (it sends no `Origin`).

### 8.4 Config & secrets (`backend/app/config.py`)
Add settings following the **email-connector pattern** (secret default `None` → feature disabled, never a
crash). **Only the API key is a secret; everything else is a code default** (no host/URL knob — the base URL
is a per-provider code constant, §8.2 — so there is no SSRF-configurable surface):
- `geocoding_provider: str = "locationiq"` — selects the code-level provider impl (+ its hardcoded host).
- `geocoding_api_key: str | None = None` — **the only secret.**
- `geocoding_cache_ttl_seconds: int`, `geocoding_throttle_*` (window + burst) — code defaults, tunable via
  plain (non-secret) env if ever needed.
- `geocoding_enabled` property = `bool(geocoding_api_key)`.

When `geocoding_enabled` is false (local dev/tests without a key, or a misconfig), the endpoint returns
**`503 geocoding_disabled`** (never a 500, never a crash), and the client shows the "unavailable" state.

**Production secret delivery — the exact files that must change** (miss any one and prod stays permanently
`503 geocoding_disabled` even after the owner creates the GitHub secret):
1. `docs/setup/README.md` — add `GEOCODING_API_KEY` to the master secret inventory (owner runbook).
2. GitHub **environment secret** `GEOCODING_API_KEY` (owner-created; §15).
3. `.github/workflows/deploy.yml` — surface it into the deploy job's env (`GEOCODING_API_KEY: ${{
   secrets.GEOCODING_API_KEY }}`) **and** add it to the imperative
   `kubectl create secret generic fountainrank-secrets … --from-literal=geocoding-api-key="$GEOCODING_API_KEY"`
   block (this is how `fountainrank-secrets` is actually built today — same path as
   `logto-email-webhook-token`).
4. `infra/k8s/backend.yaml` — add an `env` entry mapping `GEOCODING_API_KEY` →
   `secretKeyRef { name: fountainrank-secrets, key: geocoding-api-key }` (mirrors the existing
   `LOGTO_EMAIL_WEBHOOK_TOKEN`/`GOOGLE_SERVICE_ACCOUNT_JSON` entries).

The key is **never committed, never logged, never sent to the client**. (These are IaC/deploy *files* edited
in the PR; the actual `kubectl`/apply runs only in CI — no local cluster mutation, per `kubernetes-infra.md`.)

## 9. Logging & observability (`geocode.py`)

Per the project logging standard:
- **INFO** per geocode request: query **length** (never the raw text — a typed address/city is
  user-controlled location data; treat as PII and redact), `result_count`, `limit`, whether bias was
  applied, `cache: hit|miss`, and upstream latency on a miss. Include the request id already attached by the
  middleware.
- **WARNING/ERROR** on upstream failure with a short machine reason (`timeout`, `provider_status`,
  `too_large`, `malformed`, `redirect_blocked`) — **never** the API key or full URL (the key is a
  query/header param upstream; redact). A transport/parse failure maps to `502 geocoding_upstream` (mirrors
  `userinfo.py`'s `UserinfoError` → 502); a provider **quota-exhausted / upstream `429`** maps to fail-closed
  `503 geocoding_unavailable` (§8.3) — both logged, never silent.
- **Throttle rejections** logged at INFO (which cap tripped) so throttling is diagnosable. The per-request
  client value the middleware already records is best-effort (`scope.client[0]`, ingress peer behind DOKS)
  and is **not** used as a limit key (§8.3).
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
- A shared/distributed rate limiter, accurate per-client-IP limiting (needs a trusted-proxy policy), or
  per-account quotas. These are the **prerequisite** for ever moving `GEOCODING_API_KEY` onto an
  overage-billed tier; in v1 the provider's hard, no-overage quota is the spend guard (§8.3), so they aren't
  needed.
- Self-hosting the geocoder (Photon/Nominatim) — explicitly deferred; the swap-friendly proxy keeps it a
  future backend-only change.
- Avatar upload/editing (the photo comes from Logto; this only *displays* it).

## 12. Attribution & provider ToS (decided now, not deferred)

LocationIQ's data is OpenStreetMap-derived (ODbL 1.0) plus GeoNames/OpenAddresses/Who's-On-First
(`https://locationiq.com/attribution`), so both an OSM credit and a provider credit are required. **Committed
design (so the UI/style-guide don't churn):** whenever geocoding results are shown, the search overlay
displays a small, persistently-visible attribution line in the results area:

> **Search by LocationIQ** · © OpenStreetMap contributors

- "Search by LocationIQ" links to `https://locationiq.com/attribution`; the OSM credit matches the ODbL
  phrasing already used for the basemap. This is a design commitment now — the style guide (§10) documents
  this exact block, and it renders in the results state.
- **MapTiler fallback** (if chosen at setup): the credit becomes `© MapTiler · © OpenStreetMap contributors`
  (MapTiler → `https://www.maptiler.com/copyright/`). Same placement/visibility contract; only the strings/
  links differ, and swapping providers already touches only the backend + this one attribution constant.
- Implementation matches the provider's exact current ToS string/placement if it mandates a specific variant;
  the placement contract (persistent, in the results area, tappable link) is fixed here regardless.

## 13. Testing

**Backend (fully CI-verifiable locally):**
- `geocode.py` endpoint via the injected fake provider/transport (no network):
  - happy path → normalized `{ label, latitude, longitude }` list; `limit` clamped to `1..10`;
  - validation matrix — `q` empty/<3/>120 → `422`; **bias rule (§8.1): out-of-range `lat` or `lng` → `422`
    even when its pair is absent; exactly one valid coordinate (no pair) → `200` with bias ignored; both
    valid → bias applied**;
  - `geocoding_enabled` false → `503 geocoding_disabled`;
  - provider transport error (fake raises) → `502 geocoding_upstream`, logged, no 500;
  - **provider quota-exhausted / upstream `429` → fail-closed `503 geocoding_unavailable`** (no retry storm),
    logged;
  - cache hit collapses two identical queries into one upstream call (assert the fake is called once);
  - throttle: N calls over the window → `429` with `Retry-After`.
- `LocationIQProvider` unit-tested against captured/synthetic provider JSON (label building, float parsing,
  malformed-entry skipping) — no live network. **SSRF backstop:** a fake transport returning a 3xx redirect
  is **not** followed (`follow_redirects=False`), and there is no code path where `q`/bias can set the host,
  scheme, or path (the base is a constant).
- **No log leaks:** a test asserts the geocode logs never contain the raw query text or the API key, and that
  the cache exposes neither in any diagnostic path.
- OpenAPI: `GET /api/v1/geocode` present with the documented params + `GeocodeResponse` (extend
  `test_openapi.py`).

**Mobile (pure-logic local; render/route CI-/owner-verified per the Windows/WSL env note):**
- `lib/map-search/state.ts` — normalization/min-length gate, debounce-key derivation, API-result/error →
  view-state mapping, **and stale-response dropping** (an older seq id never overwrites a newer result).
- `lib/map-search/query.ts` — params building + typed-response → list-model mapping.
- `profileTabIcon(avatarUrl, focused)` decision helper (§5.3): image when present, glyph otherwise.
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
  git. Worst-case spend is bounded by the provider's own no-overage hard quota (§8.3), not by in-process
  counters. The endpoint enforces input bounds, a clamped `limit`, a process-local cache, and a coarse
  throttle; the provider host/path is a fixed HTTPS constant with redirects disabled (no SSRF surface). A
  missing key yields `503 geocoding_disabled`, provider quota-exhaustion `503 geocoding_unavailable`, a
  transport failure `502 geocoding_upstream` — never a silent 500.
- Backend CI (ruff + format + pytest, OpenAPI check) and mobile CI (type-check + lint + unit tests) are
  green; Codex `VERDICT: APPROVED`; every PR comment addressed.
