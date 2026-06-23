# Web add-fountain flow (map-pin placement + 409-duplicate + attribute observations) (slice 6b-2) — design (2026-06-22)

> **Slice 6b-2** of the contribution-data + gamification UI track — the **larger half of 6b**: an
> authenticated **add-a-fountain** flow on the web. 6b-1 (deployed) delivered the auth shell and the
> first **writes on an existing** fountain; this slice delivers the first **create**. The umbrella
> design is `docs/specs/2026-06-22-contribution-data-and-gamification-design.md`; the
> authenticated-write pattern this reuses is `docs/specs/2026-06-22-web-auth-ui-and-write-actions-design.md`
> (slice 6b-1); the read panel it lands on is `docs/specs/2026-06-22-web-detail-enrichment-design.md`
> (slice 6a); the map browser it overlays is `docs/specs/2026-06-20-web-map-browsing-design.md`; the
> visual language is `docs/style-guide.md`.
>
> This slice is **web-only**. The backend create endpoint, duplicate detection, contribution events,
> and the attribute-type catalog are all **already live** (`docs/specs/2026-06-22-contribution-data-and-gamification-design.md`);
> there is **no backend, DB-migration, or OpenAPI/client change**.
>
> **Owner decisions captured in brainstorming (2026-06-22):** (a) spec the **full flow**, split the
> **implementation into two PRs** (minimal add, then optional fields); (b) **tap-to-drop + draggable**
> pin placement (with a keyboard-accessible equivalent, §6); (c) a **client-side GPS bound** so honest
> users can't accidentally drop a pin far from where they are, with a **soft-guard + fallback** policy:
> a tight **proximity** bound around a good GPS fix, and — when there is no usable fix — a **precision
> gate** (a deliberate, street-level placement) rather than a proximity bound, because the user's real
> location is unknown by construction without GPS (§6, §11); (d) the flow is an **overlay on the
> existing home map** (not a dedicated route).

## 1. Goal & scope

The web app can browse fountains and (since 6b-1) contribute to **existing** ones, but there is **no
way to add a fountain**. The map is the home page; the natural place to add one is by pointing at the
spot on that map. This slice adds an authenticated add-a-fountain flow layered over the home map, with
nearby-duplicate (**409**) handling and (in the second PR) optional rating / attribute / comment /
placement-note capture built dynamically from the live API.

**In scope:**

1. **Entry affordance** — a floating **"Add a fountain"** control on the home map; signed-out users
   are routed straight to sign-in and returned into the flow.
2. **Placement mode** — the existing home map enters a placement state: **tap to drop** a pin, **drag
   to fine-tune** (plus a keyboard path: "Place at map center" + nudge), with a **client-side GPS
   bound** (soft-guard + precision-gated fallback, §6) and a live coordinate readout.
3. **Details step** — **working status** (the only required field; default *working*), and **(PR 2)**
   optional **rating**, **attribute observations** (built from `GET /attribute-types`), a free-text
   **comment**, and a short **placement note**.
4. **Submit** via a Server Action → `POST /api/v1/fountains`, with typed outcomes: **201** lands the
   user on the new fountain's detail; **409** surfaces the existing nearby fountain (the add→verify
   hook) instead of creating a duplicate.

**Out of scope (explicit non-goals):**

- **Server-enforced add-proximity.** The backend create endpoint receives only the pin `location`, not
  the user's own position, so the GPS bound is a **client-side UX guard, not a security control**
  (§6, §11). True server enforcement (send observed GPS + accuracy; reject/flag) is a **moderation**
  concern → **6g**, and even then GPS is spoofable.
- **Reverse geocoding / address lookup** for the placed point (we store coordinates + an optional
  free-text placement note only).
- **Photos** (no upload endpoint in this track yet), **gamification surfacing** — points/badges/
  first-in-area feedback fire **server-side** on add but are **displayed** in **6d**.
- **Editing/moderating** an existing fountain's location or hiding duplicates → **6g**.
- **Mobile** (Expo) add-fountain → **6e** (reuses this pattern).
- **A dedicated `/fountains/new` route** (owner chose the overlay); **no-JS** progressive enhancement
  (placement is inherently interactive).

## 2. Existing building blocks (already shipped — reused, not rebuilt)

- **Backend create is live:** `POST /api/v1/fountains` (`backend/app/routers/fountains.py:add_fountain`)
  — auth-required, advisory-locked duplicate precheck within `duplicate_threshold_m` (**10 m**, ignoring
  hidden rows) → **409** else **201**; emits `add_fountain` / `first_fountain_bonus` / first-in-area
  contribution events (idempotent via dedup keys). **No change.**
- **Attribute catalog is live:** `GET /api/v1/attribute-types` → `AttributeTypeOut[]` (public, no auth).
- **Generated client already exposes** `AddFountainRequest`, `RatingInput`, `AttributeObservationInput`,
  `AttributeTypeOut`, and `DuplicateFountainConflict` (`packages/api-client/src/schema.d.ts`). **No
  client regen.**
- **Authenticated-write pattern (6b-1):** `web/app/actions/contribute.ts` (`run()` helper — mint
  `requestId`, hostile-input validation, `getAuthedApiClientForAction(requestId)` so the token stays
  server-side, status→typed-error map, structured logging); `web/lib/server/api.ts`
  (`getAuthedApiClientForAction`). This slice **adds a sibling** action module, not a rewrite.
- **Auth gate + return path (6b-1):** `getViewer()` (`web/lib/server/viewer.ts`, fail-closed
  discriminated `anonymous|authed|error`); `signInWithReturn(returnTo)` (`web/app/actions/auth.ts`) +
  `safeReturnPath` (`web/lib/return-path.ts`) — already accepts `/?add=1` (rooted, no
  protocol-relative/backslash/control chars; verified).
- **Map browser (6-map):** `web/components/map/MapBrowser.tsx` (client, MapLibre GL JS v5,
  `MapBrowserLoader` dynamic `ssr:false`), `web/lib/map/*` (`constants`, `bounds`, `layers`, `pins`,
  `style`, `log`, `format`), and the WebGL2 probe `isWebglSupported()`. The map already requests
  geolocation on load and adds a `GeolocateControl`.
- **Reusable forms (6b-1):** `RatingForm` (per-dimension 5-star radio groups) — adapted for the
  details step (§7.2). (Condition statuses are **not** used at add time — add uses the boolean
  `is_working`.)

## 3. API contract (already live; no contract change)

Auth: a Logto **Bearer access token** for `https://api.fountainrank.com` (`Depends(get_current_user)`
→ **401** without it). From the generated client (`@fountainrank/api-client`):

- **`POST /api/v1/fountains`** → **201** `FountainDetail` | **409** `DuplicateFountainConflict`.
  Request `AddFountainRequest`:
  - `location: { latitude: number; longitude: number }` (**required**),
  - `is_working: boolean` (default **true**),
  - `comments?: string | null`,
  - `placement_note?: string | null` (server caps **≤ 200**),
  - `ratings?: RatingInput[]` (`{ rating_type_id: number; stars: 1–5 }`),
  - `observations?: AttributeObservationInput[]` (`{ attribute_type_id: number; value: string }`).
  - **409 body** `DuplicateFountainConflict { detail: "duplicate_fountain"; fountain_id: uuid }` —
    declared in `responses=` so it is part of the typed schema; carries the existing fountain id for
    the add→verify hook.
- **`GET /api/v1/attribute-types`** → **200** `AttributeTypeOut[]` (public). Each:
  `{ id, key, place_type, category, name, description, value_kind: "boolean"|"enum", allowed_values: string[]|null, sort_order }`
  (~13 types across physical / accessibility / access). Observation `value` ∈ `yes|no|unknown` for
  `boolean`, or an `allowed_values` member / `unknown` for `enum`. **The attribute set is built
  dynamically from this endpoint — never hardcoded.**
- **`GET /api/v1/rating-types`** → **200** `RatingTypeOut[]` (public; `{ id, name, description,
  sort_order }`, fountain-scoped, ordered by `sort_order`). This is the **add-time rating-dimension
  source** for PR 2: there is no fountain yet, so the detail page's `FountainDetail.dimensions` (an
  outer join computed *for an existing fountain*) does **not** apply — the add form renders one star
  group per `RatingTypeOut`. Public, parallel to `attribute-types`.
- `ConditionStatus` has no GET — it is **not** used at add time (add uses the boolean `is_working`;
  richer condition reporting stays on the detail page's existing `ConditionForm`, post-add).

## 4. Web — entry affordance & auth gate

A floating **"+ Add a fountain"** button (FAB) is rendered by the map layer (within the client map
container so it can drive map state), bottom area, above the in-view list, visible to **everyone**:

- **WebGL2 unsupported** (`!isWebglSupported()`, the same probe that gates the map): the map cannot
  render, so placement is impossible — the FAB is **hidden** (no dead control). (Note for owner
  verification: your Firefox lacks WebGL2, so the FAB won't appear there — test in a Chromium browser.)
- **Signed out** → the FAB triggers `signInWithReturn("/?add=1")` (one tap → Logto → returns to `/`
  with `?add=1`). Routing straight to sign-in (rather than letting an anonymous user place a pin first)
  avoids losing placement state across the auth redirect.
- **Signed in** → the FAB enters **placement mode** directly.

**Server/client split (explicit).** `web/app/page.tsx` is a **server component**: it calls
`getViewer()` and reads `searchParams.add` (Next 16 App Router — `searchParams` is an **async** prop,
typed `Promise<{ add?: string }>` and **awaited** in the page; the plan pins the exact prop shape),
then passes two props into the client map
(`MapBrowserLoader` → `MapBrowser`): `isAuthenticated` (drives the FAB's signed-in vs sign-in path) and
`autoEnterAdd = (searchParams.add === "1" && viewer.state === "authed")`. The **client** map, on mount,
enters placement mode iff `autoEnterAdd`, then strips the query with `router.replace("/")` so a
refresh/back doesn't re-trigger. If `?add=1` is present but the viewer is not `authed` (sign-in
abandoned), `autoEnterAdd` is false and the client still strips the param — nothing opens.

## 5. Web — flow & state machine

Add-mode is a small state machine layered over the browse map, owned by an isolated
**`useAddFountainMode(map)`** hook + an **`AddFountainPanel`** component. `MapBrowser` gains only a
**thin seam**: a way to enter/exit add-mode and to **suppress browse interactions** while active (pin/
cluster clicks do **not** navigate; the bottom in-view list yields to the panel; bbox pin loading may
continue read-only behind the panel). This containment is deliberate — it keeps the shipped browse
experience low-risk and the add logic independently testable.

```
states: browse → placing → details → submitting → (done | duplicate | error)
        any non-terminal state → (Cancel | Escape) → browse
```

- **placing** — acquire GPS + bound, capture the pin (§6).
- **details** — collect working status (+ optional fields in PR 2) (§7).
- **submitting** — the Server Action is in flight; controls disabled.
- **done** — 201; navigate to the new fountain (§8).
- **duplicate** — 409; surface the existing fountain (§8).
- **error** — validation/unauthenticated/server; inline, **pin and entered fields preserved** for retry.

The panel is an overlay anchored to the bottom of the map (a bottom sheet on narrow screens, a
corner card on wide), never covering the whole map (the user must still see the pin). It has a clear
title, a **Cancel/close** affordance, and a single primary action per step
(*Next: details* → *Add fountain*).

## 6. Web — placement mechanics (tap-to-drop, draggable, GPS-bounded)

On entering **placing**, request the device position **once**
(`navigator.geolocation.getCurrentPosition`, `enableHighAccuracy:false`, reusing
`GEOLOCATE_TIMEOUT_MS`), reading `coords.latitude/longitude/accuracy`:

**Placement-precision gate (both modes).** Dropping a pin requires the map to be at/above a dedicated
`PLACE_MIN_ZOOM` (new constant, **16** — a street-level floor, deliberately **not** `shouldLoadPins`/
`MIN_ZOOM`, which is **z10** and can span miles). Because the on-screen metres a given zoom covers still
vary with display width and latitude, the **fallback** case additionally caps the placement area by
**computed metres, not zoom alone**: it requires the visible viewport's diagonal span (derived from the
live map bounds) to be **≤ `FALLBACK_MAX_SPAN_M`** (new constant, indicative **4000 m**, tunable in the
plan); otherwise the panel shows "Zoom in to place the fountain" and disables the drop. This makes the
fallback gate **screen-size-independent** — a wide monitor can't silently widen it. The GPS case is
governed by its circle bound (below) and clears `PLACE_MIN_ZOOM` naturally.

- **Usable fix** (a position returned **and** `accuracy ≤ ACCURACY_MAX_M`): the bound is a **circle**
  centered on the GPS position, radius `max(BOUND_RADIUS_MIN_M, accuracy)`; draw a **faint bound ring**
  and recenter to the GPS position at/above `PLACE_MIN_ZOOM` (showing the relevant part of the ring —
  not necessarily the whole ring when accuracy is large). This is the **real proximity bound** — the
  on-site mobile case the owner asked for.
- **No usable fix** (denied, unavailable, timed out, or `accuracy > ACCURACY_MAX_M`): **fallback** — no
  ring; the bound is the **current map viewport**, gated to `FALLBACK_MAX_SPAN_M` of diagonal span
  (screen-size-independent, above), and the panel shows explicit copy: *"We couldn't confirm your
  location — make sure the pin is exactly where the fountain is."* **Be explicit about what this does
  and does not do:** without a GPS fix the client
  **cannot** bound to the user's real position — that is impossible by construction, not a gap to paper
  over. The fallback enforces **precision** (a deliberate, zoomed-in placement), **not proximity to the
  user** — a determined desktop user can still pan elsewhere and place there. The owner accepted
  desktop/no-GPS adds when choosing soft-guard+fallback; data-quality for these rests on the **10 m
  duplicate check** and later **moderation (6g)**, and the spec/UX/tests claim nothing stronger.

New constants in `web/lib/map/constants.ts`: `BOUND_RADIUS_MIN_M = 150`, `ACCURACY_MAX_M = 1000`,
`PLACE_MIN_ZOOM = 16`, `FALLBACK_MAX_SPAN_M = 4000` (tunable).

Interaction:

- **Tap/click** the map to drop the pin; **drag** the pin marker to fine-tune. A live **lat/lng
  readout** (and, in the GPS case, distance-from-you) shows in the panel.
- **Keyboard / non-pointer path (PR 1, required for a11y):** a **"Place at map center"** button drops
  the pin at the current map center; the map's built-in keyboard pan/zoom (focusable canvas) moves the
  center, and the panel offers **nudge** controls (small N/S/E/W steps) for fine adjustment. Every step
  is clamped to the bound. The full minimal add is completable with **no pointer canvas click/drag** —
  matching the map-browse a11y precedent (the in-view DOM list exists precisely because GL-layer
  interaction is not accessible on its own).
- **Out-of-bound** placement (GPS case: outside the ring) → **clamp the pin to the boundary** and show
  a gentle inline note ("Place the fountain near where you are") rather than rejecting the gesture. In
  the viewport-fallback case the map click is already within view, so clamping is a no-op there.
- **Pure helpers** (unit-tested, in `web/lib/map/`): `clampToBound(point, bound)` where `bound` is
  either `{ kind:"circle", center, radiusM }` or `{ kind:"viewport", bounds }`, and
  `boundFromFix(fix)` selecting circle-vs-viewport per the policy above. Distance uses a haversine/
  turf-free small helper (no new dependency unless one already exists in `web/lib/map`).
- **"Next: details"** enables only once a valid in-bound pin exists.

The pin/ring render as MapLibre layers/sources added on entering add-mode and removed on exit (no
interference with the browse `fountains` source). The Server Action **independently** validates
lat/lng as hostile (finite; lat ∈ [−90,90]; lng ∈ [−180,180]) — the bound is a client guard only.

## 7. Web — details step

After a valid pin, the panel advances to **details**.

### 7.1 Working status (PR 1 — required)

A clear **"Is it working?"** control — a two-option **Yes / No** (default **Yes**, matching the API
default). Maps to `is_working`. This is the only field required to submit the minimal add.

### 7.2 Rating (PR 2 — optional)

Reuse the 6b-1 **5-star radio pattern** (keyboard-accessible radio groups, not color-only). Dimensions
come from **`GET /api/v1/rating-types`** (`RatingTypeOut { id, name, description, sort_order }`, public,
fountain-scoped, ordered by `sort_order`) — fetched lazily when the details step opens, parallel to the
attribute fetch (§7.3), and cached for the session; **not** from `FountainDetail.dimensions` (which
requires an existing fountain). **Do not force-fit the existing `RatingForm`:** it consumes
`DimensionSummary` (whose id field is **`rating_type_id`**, with **no** `sort_order`) and is wired
straight to `submitRating(fountainId, …)`. Instead **extract a shared, presentational star-group
component** (label + 1–5 radio group emitting `(typeId, stars)`) that both the detail `RatingForm` and
the add form render, **or** give `RatingForm` a form-level submit callback + an explicit
`{ typeId, name, sortOrder }[]` prop. The add form maps **`RatingTypeOut.id → rating_type_id`**; a test
asserts this mapping so an `id`-vs-`rating_type_id` mixup fails. Untouched dimensions are omitted; the
user may rate any subset or none; set dimensions become `ratings:[{rating_type_id, stars}]`. If the
fetch fails, the rating section is skipped gracefully (like attributes) — it never blocks the add.

### 7.3 Attribute observations (PR 2 — optional, built dynamically)

Fetch `GET /api/v1/attribute-types` (public) **lazily** when the details step first opens; cache for
the session. Render toggles **grouped by `category`**, ordered by `sort_order`:

- `value_kind:"boolean"` → a **Yes / No / Unknown** control (default **Unknown**).
- `value_kind:"enum"` → a select of `allowed_values` **plus Unknown** (default **Unknown**).
- Only **non-`unknown`** selections are sent as `observations:[{attribute_type_id, value}]`.

If the fetch fails, the attribute section is **skipped gracefully** (a small "couldn't load attributes"
note) — it never blocks the add. A pure `buildAttributeGroups(types)` helper (group/sort/derive
control kind) is unit-tested from a fixture.

### 7.4 Comment & placement note (PR 2 — optional)

- **Comment** — a free-text textarea → `comments` (general remark).
- **Placement note** — a short single-line input (**≤ 200** chars, live counter) → `placement_note`
  (e.g. "near the north restrooms"). Both trimmed; empty → omitted.

## 8. Web — server action, result mapping & outcomes

A new focused module **`web/app/actions/add-fountain.ts`** (`"use server"`) — add is a distinct
concern from contribute-on-existing, so its own file (one responsibility), mirroring `contribute.ts`'s
shape. **Reminder (6b-1 gotcha):** a `"use server"` module may export **only** async functions —
constants/types shared with the client live in a plain module (e.g. `web/lib/add-fountain.ts`).

```
type AddFountainError = "unauthenticated" | "validation" | "server";
type AddFountainResult =
  | { ok: true; fountainId: string }
  | { ok: false; error: "duplicate"; fountainId: string }
  | { ok: false; error: AddFountainError };

addFountain(input: AddFountainInput): Promise<AddFountainResult>
// AddFountainInput mirrors AddFountainRequest (location, is_working, comments?,
// placement_note?, ratings?, observations?)
```

Steps (mirroring `contribute.ts`):

1. **Hostile-input validation before any API call** — `location.latitude/longitude` finite and in
   range; `is_working` boolean; `placement_note` ≤ 200 after trim; each `ratings[]`
   (`rating_type_id` positive int, `stars` int 1–5); each `observations[]` (`attribute_type_id`
   positive int, `value` non-empty string). Invalid → `{ ok:false, error:"validation" }` (no API call).
2. **Auth** — `getAuthedApiClientForAction(requestId)`; a thrown token/session error →
   `{ ok:false, error:"unauthenticated" }` (split from network failure, per 6b-1).
3. **`POST /api/v1/fountains`** with the assembled body (omit empty optional arrays/strings).
4. **Result map (read the typed bodies the `openapi-fetch` way — destructure `{ data, error, response }`):**
   - **201** → `{ ok:true, fountainId: data.id }` (the returned `FountainDetail`).
   - **409** → read the typed **`error`** side — `openapi-fetch` surfaces non-2xx bodies on `error`,
     **not** `data` — `DuplicateFountainConflict.fountain_id`. If the 409 body is missing/malformed or
     `fountain_id` is not a UUID → treat as **`server`** (never a `duplicate` with an undefined route).
   - **401** → `unauthenticated`; **422** → `validation`; any other non-2xx / thrown → `server`.
5. **Structured logging** — log **only** `requestId`, action, and `outcome`/`status`. **Never** log the
   submitted coordinates, `comments`, `placement_note`, rating/observation values, or the token. (A
   request id already ties to an authenticated write, and an exact fountain coordinate is sensitive; if
   location diagnostics are ever needed, use a coarse/bucketed value behind an explicit debug path,
   never routine logging.)

**Client outcomes** (handled by `AddFountainPanel` via `useActionState`/`useTransition`):

- **done (201)** → `router.push(\`/fountains/${fountainId}\`)` (lands on the new fountain's detail with
  the 6b-1 Contribute section) + a brief `role="status"` "Fountain added" confirmation. Gamification
  events already fired server-side; **surfacing is 6d**.
- **duplicate (409)** → the panel shows "A fountain already exists here" + a primary **"View it"**
  link to `/fountains/${fountainId}` (verify/rate/note there — the add→verify hook). No second pin is
  created; the placement pin can be dismissed.
- **unauthenticated** → "Your session expired — sign in to finish", re-running `signInWithReturn("/?add=1")`.
- **validation / server** → inline message; **pin and entered fields preserved**; controls re-enable.

No `revalidatePath` is required for the create path (the user navigates to a freshly-rendered detail
route). As with 6b-1, a new pin is reflected on the map on the **next map load** (broad map
revalidation on write remains out of scope).

## 9. Architecture & components

- `web/components/map/MapBrowser.tsx` (client) — **thin seam**: receives `isAuthenticated` +
  `autoEnterAdd` props (§4); add-mode enter/exit, browse-interaction suppression while active,
  mount/unmount of the placement pin + bound-ring layers. Renders the FAB and the `AddFountainPanel`.
  The existing browse logic is otherwise unchanged.
- `web/components/map/useAddFountainMode.ts` (client hook) — owns the state machine (§5), GPS
  acquisition + bound derivation (§6), pin capture/drag/clamp, and the submit call; exposes state +
  handlers to the panel. Keeps map-event wiring out of the panel and out of `MapBrowser`'s browse path.
- `web/components/map/AddFountainPanel.tsx` (client) — the step UI (placing → details → result),
  pending/disabled/confirmation/error, a11y (focus management, `Escape`/Cancel, `role="status"`/
  `aria-live` for outcomes, labeled controls). Composes `RatingForm` (PR 2) and the attribute toggles.
- `web/components/map/AttributeObservationFields.tsx` (client, PR 2) — renders
  `buildAttributeGroups(types)`; boolean Yes/No/Unknown + enum select; emits `observations[]`.
- `web/app/actions/add-fountain.ts` (`"use server"`) — the action (§8). Shared constants/types in
  `web/lib/add-fountain.ts` (plain module).
- `web/lib/map/constants.ts` — add `BOUND_RADIUS_MIN_M`, `ACCURACY_MAX_M`, `PLACE_MIN_ZOOM`,
  `FALLBACK_MAX_SPAN_M`.
- `web/lib/map/bounds.ts` (or a focused new `web/lib/map/placement.ts`) — `boundFromFix`,
  `clampToBound`, distance helper (pure, unit-tested).
- `web/app/page.tsx` (server) — `getViewer()` + `searchParams.add`; passes `isAuthenticated` +
  `autoEnterAdd` into `MapBrowserLoader`/`MapBrowser` (§4). The client map strips the query.

## 10. Error handling & edge cases

- **WebGL2 unsupported / map can't render** → FAB hidden; add is unavailable (consistent with browse).
- **GPS denied / unavailable / timed out / `accuracy > ACCURACY_MAX_M`** → viewport-fallback bound, no
  ring; add still works.
- **Below `PLACE_MIN_ZOOM`, or (fallback) viewport diagonal > `FALLBACK_MAX_SPAN_M`** → "Zoom in to
  place the fountain"; the drop is disabled until the map is at street level / within the metre cap
  (§6), forcing deliberate placement (and preventing a wide fallback viewport from being a meaningless
  "bound").
- **Out-of-bound drop/drag** → clamp to boundary + gentle note (§6).
- **Duplicate within 10 m (409)** → existing fountain surfaced; no duplicate created (§8).
- **Session expired mid-flow (401 / token throw)** → `unauthenticated`; re-prompt sign-in to `/?add=1`.
- **Validation (client or 422)** → inline; pin/fields preserved.
- **Network / 5xx** → "Couldn't add the fountain — please try again."; controls re-enable; nothing
  lost.
- **Double-submit** → controls disabled in `submitting`.
- **Attribute-types fetch failure (PR 2)** → attribute section skipped; the rest of the add proceeds.
- **Antimeridian/degenerate viewport** in fallback → reuse `normalizeBounds`; if degenerate, keep the
  prior valid bound.
- **Concurrent adds at the same spot** → backend advisory lock + duplicate precheck serialize; the
  loser receives 409 and is routed to the winner.
- **XSS** — all user text renders as escaped React children; the body is sent as JSON.
- **Accessibility** — placement has a **fully keyboard-accessible path** (PR 1, §6): a "Place at map
  center" button + nudge controls + the map's built-in keyboard pan/zoom, result clamped to the same
  bound — pointer tap/drag is an enhancement, not the only path. A test proves the **minimal add
  completes with no pointer canvas interaction**. The panel controls (working toggle, rating,
  attributes, text) are keyboard-accessible and labeled; outcomes use `role="status"`/
  `aria-live="polite"`; `Escape`/Cancel exits add-mode.

## 11. Security considerations

- **The GPS bound is a client-side UX guard, not a security control.** The create endpoint receives
  only the pin `location`, never the user's position, so it cannot enforce add-proximity; and this is a
  public open-source API — a client can `POST /api/v1/fountains` with arbitrary coordinates, bypassing
  the browser. The bound stops honest-user mistakes (the real-world case); abuse is a **moderation**
  concern (6g). The spec does not claim otherwise.
- **Untrusted Server Action input** — `addFountain` validates every field server-side as hostile before
  the API call (§8); the backend independently re-validates, enforces auth, the duplicate lock, and
  contribution dedup.
- **Token** — fetched/used only in `server-only` modules (`getAuthedApiClientForAction`); never
  serialized to the client; never logged.
- **Open-redirect** — the auth round-trip reuses `signInWithReturn`/`safeReturnPath` with the
  fixed internal `/?add=1` (already hardened + re-validated on read in `/callback`).
- **CSRF / origin** — writes are same-origin Next Server Actions; `experimental.serverActions.allowedOrigins`
  was pinned to the two public hosts in 6b-1 (no change).
- **PII / logging** — log only `requestId`/action/outcome/status; **never** log submitted coordinates,
  `comments`, `placement_note`, rating/observation values, or the token. Exact coordinates are treated
  as sensitive (coarse/bucketed only, behind an explicit debug path, if ever needed).

## 12. Style guide (same-commit prerequisite, not an afterthought)

Per the house rule, the plan's UI tasks update `docs/style-guide.md` with each new element as it ships:
the **Add-fountain FAB** (placement, sizing, signed-out vs signed-in behavior, hidden-when-no-WebGL2),
the **placement panel / bottom sheet** (steps, primary action, Cancel/Escape), the **bound ring + pin
+ coordinate readout + out-of-bound note**, the **keyboard placement controls** ("Place at map center"
button + N/S/E/W nudge controls + their disabled state below `PLACE_MIN_ZOOM` / over
`FALLBACK_MAX_SPAN_M`), the **"We couldn't confirm your location" fallback message**, the
**working-status toggle**, the **attribute Yes/No/Unknown + enum controls** (PR 2), the **comment +
placement-note inputs** (PR 2), and the **duplicate-conflict result** (message + "View it" link).
Reconcile with the shipped 6b-1 form conventions.

## 13. Testing

**Web (vitest + jsdom):**

- `web/lib/map/placement.test.ts` (or `bounds.test.ts` extension): `boundFromFix` selects circle for a
  usable fix and viewport for denied/poor/over-`ACCURACY_MAX_M`; radius = `max(BOUND_RADIUS_MIN_M,
  accuracy)`; `clampToBound` leaves in-bound points unchanged and clamps out-of-bound points to a
  circle edge / viewport rectangle; the placement gate (`canPlace` false below `PLACE_MIN_ZOOM` and,
  in fallback, when the viewport diagonal exceeds `FALLBACK_MAX_SPAN_M`; true otherwise); distance
  helper sanity.
- `web/lib/add-fountain.test.ts`: shared validation/type helpers (range checks, `placement_note` ≤ 200,
  observation/rating shape, `buildAttributeGroups` grouping/sorting/control-kind from a fixture, enum
  vs boolean, **unknown excluded** from the payload).
- `web/app/actions/add-fountain.test.ts`: mocked authed client + token — **201** → `{ok, fountainId:
  data.id}`; **409** reads the typed **`error`** side → `{ok:false, error:"duplicate", fountainId:
  error.fountain_id}`; a **409 with a missing/malformed body** (no/!UUID `fountain_id`) → `server`
  (never `duplicate` with an undefined route); **401** → `unauthenticated`; **422** → `validation`;
  **5xx**/throw → `server`; hostile/malformed serialized payloads (bad lat/lng, out-of-range stars,
  oversized placement note, bad observation) rejected as `validation` **before** any API call;
  coordinates, comment, placement-note, and token never appear in logged fields.
- Component tests: the **FAB** (hidden when `!webglOk`; signed-out triggers `signInWithReturn("/?add=1")`;
  signed-in enters placing); `AddFountainPanel` step transitions (placing→details→done/duplicate/error;
  Next disabled until a valid pin; submit disabled while pending; **pin/fields preserved** on
  validation/server error; duplicate shows the View-it link; outcomes use `role="status"`); the
  **working toggle** default Yes; the **keyboard-only minimal add** (Place-at-center + nudge completes
  the flow with **no pointer canvas click/drag**); below `PLACE_MIN_ZOOM` the drop is gated; (PR 2)
  attribute fields render from a fixture and exclude unknown; the rating form maps **`RatingTypeOut.id
  → rating_type_id`** (an id-vs-`rating_type_id` mixup fails).
- `web/app/page.test.tsx` (extend): `?add=1` + `authed` requests auto-enter and strips the param;
  `?add=1` while not `authed` strips without opening; existing assertions stay green.
- **Build:** because this touches a `"use server"` module + a route, the **full `./run.ps1 check -Web`
  (incl. `next build`)** runs before each PR — not just vitest (the 6b-1 const-in-"use server" gotcha).

**Post-deploy (owner-driven; Claude can't authenticate as the owner):**

- Unauthenticated/automated: home renders the FAB; FAB while signed-out routes to sign-in.
- Signed-in (Chromium — owner Firefox lacks WebGL2): place a pin within bound → submit minimal add →
  lands on the new fountain detail; repeat at the same spot → **409** → "View it" routes to the
  existing fountain. (PR 2) add a rating/attribute/comment/placement-note and confirm they appear on
  the detail.

## 14. Deployment / infra notes

- **No backend, DB-migration, or OpenAPI/client change** (the contract is live; the client already
  exposes every type). **No new web runtime env vars.** `allowedOrigins` already covers Server Actions
  (6b-1).
- Standard web deploy via CI on squash-merge to `main`; verify per §13.

## 15. Implementation sequencing (two PRs)

The owner chose a full-flow spec with the **implementation split into two PRs**, each its own
branch → local checks → Codex Loop B + PR comments → squash-merge → deploy → verify. Each PR's plan
orders discrete, independently-verifiable, TDD steps.

**PR 1 — minimal add (placement + working + 409):**

1. **Style guide** entries for PR-1 UI (FAB, placement panel, bound ring/pin/readout, working toggle,
   keyboard placement controls, fallback "couldn't confirm location" copy, duplicate result).
2. **Pure placement helpers** + constants (`boundFromFix`, `clampToBound`, distance, `canPlace`,
   `BOUND_RADIUS_MIN_M`, `ACCURACY_MAX_M`, `PLACE_MIN_ZOOM`) + tests (§6, §13).
3. **`add-fountain` action** (location + is_working only) + shared module + tests, incl. the
   `openapi-fetch` `error`-side 409 read + malformed-body guard (§8, §13).
4. **`useAddFountainMode` hook + `AddFountainPanel`** (placing → details(working) → result), including
   the **keyboard placement path** (Place-at-center + nudge, clamped) + tests (§6, §13).
5. **`MapBrowser` seam + FAB** (enter/exit, suppress browse, pin/ring layers) + `app/page.tsx` (server)
   passing `isAuthenticated` + `autoEnterAdd`, client strips `?add=1` (§4) + tests.

**PR 2 — optional fields:**

6. **Style guide** entries for PR-2 UI (attribute controls, comment + placement-note inputs).
7. **Attribute observations** — `GET /attribute-types` fetch + `buildAttributeGroups` +
   `AttributeObservationFields` + tests (§7.3).
8. **Rating** (RatingForm reuse) + **comment** + **placement note** wired into the details step;
   **extend the action** to pass `ratings`/`observations`/`comments`/`placement_note` + tests (§7).

## 16. Out of scope / follow-ups

- **6c** — discovery-filter UI; **6d** — gamification surfacing (now meaningfully populated once adds +
  contributions exist: points, badges, first-in-area, local progress); **6e** — mobile add (reuses this
  pattern); **6g** — fountain **moderation** (the `require_admin` endpoints + admin pages, hide/unhide,
  and any **server-side add-proximity / abuse flagging** that would harden the client-only GPS bound).
- Photos, reverse-geocoded addresses, location editing of an existing fountain, and instant map-pin
  refresh on add are deferred.
