# Mobile map UX — logo, 5-item nav, profile-photo tab, address/city search — Implementation Plan

> **For agentic workers:** implement task-by-task with TDD and frequent commits. Steps use checkbox (`- [ ]`) tracking. One task at a time; do not batch unrelated changes.

**Goal:** Ship four mobile map-screen UX improvements (brand logo in the header, a 5-item bottom nav with a centered Add FAB + safe-area fix, the user's photo in the Profile tab, and an address/city search overlay) plus the one backend addition search needs — a public, provider-agnostic geocoding **proxy** endpoint that keeps the API key server-side.

**Spec:** `docs/specs/2026-07-01-mobile-map-ux-search-and-nav-design.md` (Codex-approved 2026-07-01).

**Architecture:** Mobile is Expo/React Native (expo-router, `@maplibre/maplibre-react-native`). The map screen already owns a `flyTo` camera command and a tab→map pub/sub for the Add button; Search mirrors both. The backend is FastAPI + async; the new `GET /api/v1/geocode` endpoint follows the existing `email_webhook` precedent (feature disabled → `503` when unconfigured; a provider dependency injected via `dependency_overrides` in tests) and the `userinfo.py` outbound-httpx guards.

**Tech Stack:** FastAPI, httpx, pydantic-settings, pytest; React Native, expo-router, MapLibre, TanStack Query, Vitest; openapi-typescript generated client.

## Global Constraints (apply to every task)

- **No AI attribution** in any commit or PR; **no time estimates** anywhere.
- **Conventional Commits**; frequent commits; branch `feat/mobile-map-ux-search-nav` → PR → CI green + Codex `VERDICT: APPROVED` + every PR comment addressed → **squash-merge**.
- **Secrets:** the geocoding API key is server-side only — never committed, never logged, never in the app bundle/client. `GEOCODING_API_KEY` is already set in the `production` environment (spec §15); this PR only adds the code wiring.
- **Coordinate naming:** query params are short (`lat`/`lng`, matching `fountains.py`); response bodies use `latitude`/`longitude`. These coordinates never touch PostGIS.
- **Logging standard:** structured logs; never log the raw search query (location PII), the API key, or a full provider URL — redact. No silent 500s.
- **No SSRF surface:** the provider host/path is a hardcoded HTTPS code constant; `follow_redirects=False`; user input only ever fills query-string params.
- **Spend model:** the provider's own no-overage hard quota is the spend guard; the in-process cache/throttle are best-effort UX only (spec §8.3). Do not add per-IP limiting.
- **IaC is read-only locally:** the `deploy.yml`/`backend.yaml` edits are committed as files; `kubectl`/apply runs only in CI.
- **Windows/WSL:** backend checks run in an isolated `UV_PROJECT_ENVIRONMENT`; mobile native render/map/camera behavior is CI-/owner-verified, not asserted in JS unit tests. Follow `claude_help/testing-ci.md`.

## Planned Files

**Backend (new):**
- `backend/app/geocoding.py` — `GeocodeProvider` protocol, `LocationIQProvider` (hardcoded HTTPS host, httpx guards, `follow_redirects=False`, normalization), the in-process TTL/LRU cache + coarse token-bucket throttle, and the `get_geocode_provider` FastAPI dependency factory.
- `backend/app/routers/geocode.py` — `GET /api/v1/geocode`.
- `backend/tests/test_geocode.py` — endpoint + provider + cache/throttle tests (no network).

**Backend (modify):**
- `backend/app/config.py` — `geocoding_*` settings + `geocoding_enabled` property.
- `backend/app/schemas.py` — `GeocodeResult`, `GeocodeResponse`.
- `backend/app/main.py` — `app.include_router(geocode.router)`.
- `.github/workflows/deploy.yml`, `infra/k8s/backend.yaml`, `docs/setup/README.md` — secret wiring (spec §8.4).
- `backend/tests/test_openapi.py` — assert the new endpoint/schema.

**Mobile (new):**
- `mobile/app/(tabs)/search.tsx` — `<Redirect href="/" />` placeholder (mirrors `add.tsx`).
- `mobile/lib/navigation/map-search.ts` — `requestMapSearch`/`subscribeMapSearch` pub/sub (mirrors `add-tab.ts`).
- `mobile/lib/map-search/state.ts` — pure search state (normalize, min-length, monotonic seq/stale-drop, view-state mapping).
- `mobile/lib/map-search/query.ts` — typed `client.GET("/api/v1/geocode")` call + response→list-model mapping.
- `mobile/lib/map-search/state.test.ts`, `mobile/lib/map-search/query.test.ts`, `mobile/lib/navigation/map-search.test.ts`.
- `mobile/components/map/SearchOverlay.tsx` — the overlay UI (input, results list, states, attribution).
- `mobile/components/nav/ProfileTabIcon.tsx` — avatar-or-glyph tab icon.
- `mobile/lib/auth/profile-tab-icon.ts` + `.test.ts` — `profileTabIcon(avatarUrl, focused)` pure decision.

**Mobile (modify):**
- `mobile/app/(tabs)/_layout.tsx` — 5-item nav, safe-area, centered Add, Search button, Profile avatar icon.
- `mobile/app/(tabs)/index.tsx` — header logo swap; subscribe to `map-search`; render `SearchOverlay`; `search-result` source/layer + marker lifecycle.
- `mobile/components/map/FountainMap.tsx` — expose the `search-result` marker source/layer (or accept a `searchMarker` prop), if it can't live purely in the screen.
- `mobile/lib/map/constants.ts` — reuse `PLACE_MIN_ZOOM`; add any search constants.
- `docs/style-guide.md`, `mobile/README.md`.

Keep component files focused; if a planned component stays tiny, keep it local to the route rather than adding a file.

---

## Task List

### Task 1 — Plan review (gate)

- [ ] Write this plan (done) and self-review against the spec: every spec section maps to a task; no invented contracts; coordinate naming, logging redaction, SSRF/no-base-URL-knob, spend model, and secret handling are all reflected.
- [ ] Run the **Codex plan-review loop** (`claude_help/codex-review-process.md`, Loop A): bypass mode, WSL `cwd` `/mnt/d/repos/fountainrank`, repo-relative paths, review file `temp/codex-reviews/2026-07-01-mobile-map-ux-search-and-nav-plan-review-1.md`. Address every finding; loop to `VERDICT: APPROVED`.
- [ ] **Do not implement until the plan verdict is APPROVED.**

---

### Task 2 — Backend: config + response schemas

**Files:** modify `backend/app/config.py`, `backend/app/schemas.py`; test `backend/tests/test_geocode.py` (new, config/schema portion).

- [ ] **Write failing tests:** `Settings()` defaults — `geocoding_provider == "locationiq"`, `geocoding_api_key is None`, `geocoding_enabled is False`; setting a key flips `geocoding_enabled` true. Assert `geocoding_cache_ttl_seconds` and the throttle knobs have sane defaults.
- [ ] Run tests; confirm they fail.
- [ ] Add settings to `config.py` following the email-connector pattern: `geocoding_provider: str = "locationiq"`, `geocoding_api_key: str | None = None`, `geocoding_cache_ttl_seconds: int = 300`, `geocoding_throttle_max_per_window: int`, `geocoding_throttle_window_seconds: int`, and a `geocoding_enabled` property `= bool(self.geocoding_api_key)`. No base-URL setting (host is a code constant — spec §8.2).
- [ ] Add `GeocodeResult { label: str; latitude: float; longitude: float }` and `GeocodeResponse { results: list[GeocodeResult] }` to `schemas.py` (match the existing `Coordinates`/`MeResponse` schema style).
- [ ] Run tests; confirm pass. Commit (`feat(geocode): add geocoding settings + response schemas`).

---

### Task 3 — Backend: provider abstraction + `LocationIQProvider`

**Files:** create `backend/app/geocoding.py`; test in `backend/tests/test_geocode.py`.

- [ ] **Write failing provider tests** using a fake `httpx` transport (mirror `test_userinfo.py`/`test_email_webhook.py` seams — no network):
  - happy path: a synthetic LocationIQ autocomplete JSON array → list of `GeocodeResult` with correct `label`/`latitude`/`longitude` (floats).
  - malformed/incomplete entries (missing `lat`/`lon`/`display_name`) are **skipped**, not surfaced.
  - **SSRF backstop:** a `302` redirect response is **not** followed (assert `follow_redirects=False` — the client raises/does not chase); there is no code path where the query sets host/scheme/path.
  - body over the max-bytes cap → typed error (mirror `userinfo.py`'s streamed cap).
  - `limit` is passed through and the query fills only query-string params; the API key is sent as the provider's key param and never appears in a constructed log string.
- [ ] Run tests; confirm they fail.
- [ ] Implement in `geocoding.py`:
  - `class GeocodeProvider(Protocol)` with `async def search(self, q: str, limit: int, bias: tuple[float, float] | None) -> list[GeocodeResult]`.
  - `LocationIQProvider` with a module-level constant host, e.g. `LOCATIONIQ_URL = "https://us1.locationiq.com/v1/autocomplete"` (HTTPS, fixed). `search` builds params `{ key, q, limit, format: "json" }` (+ `lat`/`lon` when `bias`), calls `httpx.AsyncClient(timeout=5.0, follow_redirects=False)`, streams the body with a max-bytes cap, parses JSON, and normalizes hits (skip malformed). Typed errors (`GeocodeUpstreamError`, `GeocodeQuotaError` for upstream `429`) mirror `UserinfoError`.
- [ ] Run tests; confirm pass. Commit (`feat(geocode): LocationIQ provider with SSRF-safe httpx guards`).

---

### Task 4 — Backend: in-process cache + coarse throttle (pure)

**Files:** extend `backend/app/geocoding.py`; test in `backend/tests/test_geocode.py`.

- [ ] **Write failing tests:**
  - TTL cache: two identical `(normalized_q, limit, rounded_bias)` lookups within TTL return the cached value and call the underlying provider **once**; a third after TTL expiry re-calls. Cache is bounded (LRU eviction past capacity).
  - Cache key normalization: whitespace/case-insensitive `q`, `limit` included, bias rounded to a coarse grid so nearby viewports share a key.
  - Throttle: N calls within the window succeed, the N+1 raises a throttle signal; after the window resets, calls succeed again. Deterministic time via an injected clock (no wall-clock/`Date.now`).
  - Privacy: the cache exposes no accessor that returns raw keys/queries (no `.keys()`-style diagnostic leak path).
  - **Unsupported provider is deterministic (no crash):** `get_geocode_provider` with `geocoding_provider="maptiler"` (or a typo) while a key is set returns a "disabled" marker (endpoint → `503 geocoding_disabled`) and logs a **redacted** config warning (provider name only, never the key) — it does not raise/`500`. A known-providers set gates this; only `"locationiq"` is wired in this PR.
- [ ] Run tests; confirm they fail.
- [ ] Implement a bounded TTL/LRU cache and a token-bucket throttle in `geocoding.py`, both taking an injected `now()` for testability. Wire a `get_geocode_provider(settings=Depends(get_settings))` factory that returns a cache+throttle-wrapped provider when `geocoding_enabled` **and** `geocoding_provider` is a known value; otherwise returns the "disabled" marker (unset key) or logs the redacted unsupported-provider warning and returns disabled. Mirror `get_userinfo_fetcher`/`get_gmail_sender`.
- [ ] Run tests; confirm pass. Commit (`feat(geocode): bounded TTL cache + coarse throttle`).

---

### Task 5 — Backend: `GET /api/v1/geocode` endpoint + wiring + OpenAPI

**Files:** create `backend/app/routers/geocode.py`; modify `backend/app/main.py`; test `backend/tests/test_geocode.py`, `backend/tests/test_openapi.py`.

- [ ] **Write failing endpoint tests** (fake provider via `app.dependency_overrides[get_geocode_provider]`, like `test_email_webhook.py`):
  - happy path → `200` `{ results: [...] }`.
  - **`limit` is clamped, not rejected (spec §8.1):** `limit=0` and `limit=999` both → `200` with the fake provider receiving `limit == 1` and `limit == 10` respectively; a non-integer `limit` (e.g. `abc`) → `422`.
  - validation: `q` empty/<3/>120 → `422`; **bias rule (spec §8.1):** out-of-range `lat` or `lng` → `422` even without its pair; exactly one valid coordinate (no pair) → `200` with bias ignored; both valid → bias applied (assert the fake received the bias).
  - `geocoding_enabled` false (no key) → `503 geocoding_disabled`; **unsupported `geocoding_provider` (e.g. a typo) → `503 geocoding_disabled`** (deterministic, no `500` — see Task 4).
  - fake raises `GeocodeUpstreamError` → `502 geocoding_upstream`; raises `GeocodeQuotaError` (upstream 429) → fail-closed `503 geocoding_unavailable`; no `500`.
  - throttle tripped → `429` + `Retry-After`.
  - **no log leak:** capture logs and assert neither the raw `q` nor the key appears; INFO log carries query **length**, `result_count`, `cache: hit|miss`.
- [ ] Run tests; confirm they fail.
- [ ] Implement `geocode.py`: `router = APIRouter(prefix="/api/v1", tags=["geocode"])`; `@router.get("/geocode", response_model=GeocodeResponse, responses={503:..., 502:..., 429:...})`; params `q: Annotated[str, StringConstraints(strip_whitespace=True, min_length=3, max_length=120)]`, `limit: int = Query(5)` (**unconstrained integer — clamp in the handler with `limit = max(1, min(10, limit))` before calling the provider; do NOT use `ge=/le=`, which would reject rather than clamp**), `lat: float | None = Query(None, ge=-90, le=90)`, `lng: float | None = Query(None, ge=-180, le=180)`; provider via `Depends(get_geocode_provider)`; map disabled/unsupported-provider/errors to the documented statuses; structured logging per the constraints. Add `app.include_router(geocode.router)` in `main.py`.
- [ ] Run tests; confirm pass.
- [ ] Regenerate OpenAPI + assert: run the backend `export_openapi` path; extend `test_openapi.py` to assert `GET /api/v1/geocode` with its params + `GeocodeResponse`. Commit (`feat(geocode): public geocode proxy endpoint + OpenAPI`).

---

### Task 6 — Backend: production secret wiring (files only)

**Files:** modify `.github/workflows/deploy.yml`, `infra/k8s/backend.yaml`, `docs/setup/README.md`.

- [ ] `deploy.yml`: add `GEOCODING_API_KEY: ${{ secrets.GEOCODING_API_KEY }}` to the deploy job env, and `--from-literal=geocoding-api-key="$GEOCODING_API_KEY"` to the `kubectl create secret generic fountainrank-secrets …` block (same path as `logto-email-webhook-token`).
- [ ] `backend.yaml`: add an `env` entry mapping `GEOCODING_API_KEY` → `secretKeyRef { name: fountainrank-secrets, key: geocoding-api-key }` (mirror `LOGTO_EMAIL_WEBHOOK_TOKEN`).
- [ ] `docs/setup/README.md`: add `GEOCODING_API_KEY` to the secret inventory, note LocationIQ, the **5k/day no-overage** quota behavior, and the "verify no overage billing" check (spec §15). Note it is already set in the `production` environment.
- [ ] Verify the diff carries only **secret names, never a value**: `git diff --check`, review the diff, and `git grep -n "GEOCODING_API_KEY\|geocoding-api-key"` to confirm only the env-var/secret-key **names** appear (no literal token anywhere — the real value lives only in the GitHub `production` environment and is never typed, pasted, or searched-for here). Commit (`build(geocode): wire GEOCODING_API_KEY through deploy + k8s`). (No local apply — CI only.)

---

### Task 7 — Mobile: profile-tab-icon decision helper + component + Profile tab avatar

**Files:** create `mobile/lib/auth/profile-tab-icon.ts` (+ `.test.ts`), `mobile/components/nav/ProfileTabIcon.tsx`; modify `mobile/app/(tabs)/_layout.tsx`.

- [ ] **Write failing test** for `profileTabIcon(avatarUrl: string | null | undefined, focused: boolean)` → returns `"image"` when a non-empty `avatarUrl` is present, else `"glyph"`.
- [ ] Run; fails. Implement the pure helper. Run; passes.
- [ ] Implement `ProfileTabIcon` as a **true cache-only read** (spec §5.3 "no stray request"): read with `useQueryClient().getQueryData<MeProfile>(["me"])` — a plain cache lookup, **not** a second `useQuery` (the root `QueryClient` has no `staleTime`, so a second observer would refetch on mount). It renders whatever `NameGate` has already cached; if nothing is cached (anonymous/settling) it renders the `person-circle` glyph. Circular `<Image>` of `avatar_url` (brand-blue ring when `focused`), image-load error falls back to the glyph. Reuse the avatar styling from `account.tsx`.
- [ ] **Add a mocked-client test** asserting that rendering `ProfileTabIcon` (or invoking its data hook) issues **no** `client.GET` call — proving cache-only. (Pure `profileTabIcon` already covers the image-vs-glyph decision.)
- [ ] Swap the `account` tab's `tabBarIcon` to `<ProfileTabIcon focused={...} />`. Commit (`feat(mobile-nav): show user avatar in the Profile tab`).

---

### Task 8 — Mobile: 5-item nav, centered Add FAB, Search button, safe-area

**Files:** modify `mobile/app/(tabs)/_layout.tsx`; create `mobile/app/(tabs)/search.tsx`, `mobile/lib/navigation/map-search.ts` (+ `.test.ts`).

- [ ] **Write failing test** for `map-search.ts` pub/sub (mirror `add-tab.test.ts`): `requestMapSearch()` with no subscriber queues one pending request; a later `subscribeMapSearch(listener)` fires it once; direct `requestMapSearch` with a subscriber fires immediately; unsubscribe stops delivery.
- [ ] Run; fails. Implement `map-search.ts` (copy `add-tab.ts` structure). Run; passes.
- [ ] Create `search.tsx` = `<Redirect href="/" />`.
- [ ] Rework `_layout.tsx`: make `TabsLayout` read `useSafeAreaInsets()`; register tabs in order **index, search, add, leaderboard, account**; give `search` a custom `tabBarButton` (magnifier glyph) that `router.navigate("/")` + `requestMapSearch()` (mirroring the Add button); apply the exact safe-area contract from spec §5.2 (fixed `height = BAR_CONTENT_H + max(insets.bottom, ANDROID_MIN_PAD)`, `paddingBottom`, custom buttons get matching `paddingBottom`, `tabBarLabelStyle` fontSize 10 `numberOfLines=1`). Add is now centered by position.
- [ ] Manual/type check: `pnpm` type-check + lint pass; nav render is owner/CI-verified. Commit (`feat(mobile-nav): 5-item bar with centered Add, Search, safe-area fix`).

---

### Task 9 — Mobile: header brand logo

**Files:** modify `mobile/app/(tabs)/index.tsx` (`MapHeader`).

- [ ] Replace `<Ionicons name="water" …>` (index.tsx:575) with `<Image source={require("../../assets/icon.png")} style={{width:26,height:26}} resizeMode="contain" />` inside the existing header badge. If a header-optimized crop is needed, it is crop/pad/resize of `assets/icon.png` only, committed under `assets/` and documented in the style guide (spec §6).
- [ ] Type-check + lint pass; visual is owner/CI-verified. Commit (`feat(mobile): brand logo in map header`).

---

### Task 10 — Mobile: search pure libs (state + query)

**Files:** create `mobile/lib/map-search/state.ts` (+ `.test.ts`), `mobile/lib/map-search/query.ts` (+ `.test.ts`). Requires Task 5's regenerated api-client type for `/api/v1/geocode`.

- [ ] **Write failing tests** for `state.ts`: trim + min-length (3) gate (below → `idle`, no request); debounce-key derivation; **monotonic sequence: an older-seq response is dropped, a newer one applied**; API result set → `results`/`empty`; error → `error`.
- [ ] Run; fails. Implement `state.ts` (pure reducer/helpers; carries a `seq` counter). Run; passes.
- [ ] **Write failing tests** for `query.ts`: builds `client.GET("/api/v1/geocode", { params: { query: { q, limit, lat?, lng? } } })` and maps the typed response to `{ id, label, latitude, longitude }[]`; maps a `503`/`502`/`429`/network error to the `error` view-state reason. Mock the client (as existing mobile tests do).
- [ ] **Add a test that `GET /api/v1/geocode` is treated as unauthenticated** — assert `isAuthenticatedApiRequest`/`createApiClient` (`mobile/lib/api.ts`) attaches **no** `Authorization` header for the geocode path (the endpoint is public; this guards against a future classifier change silently leaking a bearer token to LocationIQ searches).
- [ ] Run; fails. Implement `query.ts`. Run; passes. Commit (`feat(mobile-search): pure search state + typed geocode query`).

---

### Task 11 — Mobile: search overlay + request wiring (no map marker yet)

**Files:** create `mobile/components/map/SearchOverlay.tsx`; modify `mobile/app/(tabs)/index.tsx`.

- [ ] In `index.tsx`: `subscribeMapSearch` opens the overlay; render `SearchOverlay` above the map with a scrim; Android hardware-back + a close control dismiss it; autofocus input, debounced (~300 ms) calls through `map-search/query` with an `AbortController` cancelling the in-flight request on query change/close.
- [ ] `SearchOverlay` renders the view-states (idle/loading/results/empty/error) reusing `components/states/*` where they fit, plus the **persistent attribution line** "Search by LocationIQ · © OpenStreetMap contributors" (link to `https://locationiq.com/attribution`) whenever results show (spec §12).
- [ ] On result select (this task): dismiss overlay + `setFlyTo({ center: { lat, lng }, zoom: PLACE_MIN_ZOOM })` (recenter only — the marker is Task 12). Pure state/query logic is already tested (Task 10); overlay render is owner/CI-verified. Type-check + lint pass. Commit (`feat(mobile-search): search overlay + recenter`).

---

### Task 12 — Mobile: `search-result` marker + `FountainMap` user-vs-programmatic seam

**Files:** modify `mobile/components/map/FountainMap.tsx`, `mobile/app/(tabs)/index.tsx`; create `mobile/lib/map-search/marker.ts` (+ `.test.ts`).

- [ ] **Widen the region-change seam** so the screen can tell a user gesture from a programmatic fly. Today `FountainMap` `onRegionChange: (bounds: RawBounds, zoom: number) => void` (FountainMap.tsx:51) is called from `onRegionDidChange` (≈:110) and **discards** `e.nativeEvent.userInteraction`. Change the signature to `onRegionChange: (bounds: RawBounds, zoom: number, userInteraction: boolean) => void`, forward `e.nativeEvent.userInteraction`, and update the `index.tsx` call site (and the debounced region handler) to accept the third arg.
- [ ] **Write failing test** for a pure helper `mobile/lib/map-search/marker.ts` → `shouldClearSearchMarker({ userInteraction, cause })`: `true` for a user gesture (`userInteraction === true`) or an explicit `onPress`/new-search/pin-select cause; `false` for a programmatic region change (`userInteraction === false`, e.g. the `setFlyTo` that placed the marker).
- [ ] Run; fails. Implement `marker.ts`. Run; passes.
- [ ] In `index.tsx`: on result select set a **`search-result`** marker in its **own** GeoJSON source/layer (distinct from `fountains`/`draft-fountain`; never clustered, never tappable-to-detail). Clear it via `shouldClearSearchMarker` on region change, map `onPress`, a new search, or a fountain-pin selection — so the placing fly (programmatic, `userInteraction=false`) does not clear it, but the next user pan/zoom does (spec §7.1).
- [ ] Pure marker logic unit-tested; native marker render/lifecycle owner/CI-verified. Type-check + lint pass. Commit (`feat(mobile-search): search-result marker with user-gesture-aware lifecycle`).

---

### Task 13 — Docs: style guide + mobile README

**Files:** modify `docs/style-guide.md`, `mobile/README.md`.

- [ ] Style guide: document the **5-item bottom nav** (centered FAB, safe-area padding, active/inactive states, avatar tab icon + glyph fallback) and the **search overlay** (input, result rows, loading/empty/no-results/unavailable states, the attribution block).
- [ ] `mobile/README.md`: note the new search overlay + geocode dependency and the owner/CI-verification caveat.
- [ ] Commit (`docs: style guide + README for nav + search`).

---

### Task 14 — Local CI mirror, PR, Codex PR review loop

- [ ] Run the full local CI mirror (`claude_help/testing-ci.md`): backend ruff + format + pytest (isolated `UV_PROJECT_ENVIRONMENT`); mobile type-check + lint + Vitest; OpenAPI/client-regen check. Everything green locally.
- [ ] Open the PR (`gh pr create`), monitor CI to green.
- [ ] Run the **Codex PR-review loop** (Loop B): bypass mode, WSL `cwd`, review to `temp/codex-reviews/pr-<N>-review-1.md`, findings posted on the PR; address every finding (Codex + any Copilot/Dependabot/human comment); loop to `VERDICT: APPROVED`.
- [ ] Squash-merge once CI is green, Codex is APPROVED, and every comment is addressed. Then `gh workflow run deploy.yml --ref main` (backend) and the mobile store release workflow (owner-timed).

---

## Self-Review (against the spec)

- **Logo** → Task 9. **5-item nav / centered Add / safe-area** → Task 8. **Profile avatar tab** → Task 7. **Search overlay/recenter** → Task 11; **result marker + user-gesture lifecycle** → Task 12. **Geocode proxy** (endpoint, provider, cache/throttle, config, schemas, OpenAPI, unsupported-provider) → Tasks 2–5. **Secret wiring** → Task 6. **Attribution** → Task 11 + style guide Task 13. **Style guide/README** → Task 13. **Points→Rankings** → already done (no task, per spec). **No-overage invariant** → Task 6 (docs) + carried operationally.
- **Type consistency:** `GeocodeResult{label,latitude,longitude}` (backend) → mapped to `{id,label,latitude,longitude}` (mobile `query.ts`); `map-search/state.ts` seq/stale-drop consumed by the overlay in Task 11; `shouldClearSearchMarker` (Task 12) consumes the widened `onRegionChange(bounds,zoom,userInteraction)` seam; `profileTabIcon` (Task 7) is the only tab-icon helper. `limit` is **clamped** (not `ge/le`-rejected) in Task 5. Query params `q,limit,lat,lng`; endpoint statuses `503 geocoding_disabled` / `503 geocoding_unavailable` / `502 geocoding_upstream` / `429` used consistently across Tasks 5, 10, 11, 12.
- **No placeholders:** each task names exact files, concrete test cases, and a commit. Native-render/map behavior is explicitly owner/CI-verified, not faked in unit tests (per the Windows/WSL constraint).
