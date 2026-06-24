# Mobile add-fountain flow (slice 6e-7) Implementation Plan

**Goal:** Add the authenticated mobile flow for creating a new fountain from the
native app: choose a location from GPS or the map, collect required add fields
plus optional initial ratings/attributes/text, submit through the existing
typed API client, handle duplicate-proximity `409`, and route to the created or
existing fountain.

**Spec:** `docs/specs/2026-06-23-mobile-store-testing-distribution-design.md`
slice 6e-7. The mobile UX reuses the already-shipped web add-fountain contract
and duplicate handling from `docs/specs/2026-06-22-web-add-fountain-design.md`,
adapted to React Native and the existing mobile map/add-tab structure.

**Current baseline:** slice 6e-6 is merged on `main` in PR #72. The add tab is
still a scaffold at `mobile/app/(tabs)/add.tsx`. Native signed-in runtime
verification remains owner-gated until the Logto Native app/redirect/device
round trip is confirmed in slice 6e-9, so this slice can only claim compiled and
unit-tested authenticated code paths.

## Constraints

- No backend, DB migration, OpenAPI, infrastructure, or environment-variable
  changes. The deployed contract already exposes:
  - `POST /api/v1/fountains`
  - `GET /api/v1/rating-types`
  - `GET /api/v1/attribute-types`
- All writes use `useApi()` / `createApiClient` and `client.POST(...)`.
- No raw generated client, direct `fetch`, mobile dev-auth bypass, or `X-Dev-*`
  header path.
- Add-fountain UI is available only when `auth.status === "authenticated"`.
  Auth-unavailable, initializing, signed-out, signing-in, and reauth-required
  states must render honest non-writable UI.
- On `AuthSessionError` or HTTP `401`, mark reauth required.
- Do not log tokens, exact coordinates, comments, placement notes, rating
  values, or attribute values.
- Map rendering remains owner-gated to a dev-client/EAS/native build. Local CI
  verifies pure helpers, TypeScript, lint, Vitest, and Expo Doctor only.
- Generated native folders remain out of git.
- Do not edit `CLAUDE.md` or Claude-specific files.

## API Contract

`POST /api/v1/fountains` request body:

- `location: { latitude: number; longitude: number }` - required.
- `is_working: boolean` - required in mobile UI, default true.
- `comments?: string | null`.
- `placement_note?: string | null`, server cap <= 200 chars.
- `ratings?: { rating_type_id: number; stars: number }[]`.
- `observations?: { attribute_type_id: number; value: string }[]`.

Responses:

- `201 FountainDetail` - created. Route to `/fountains/{id}` and invalidate map
  bbox queries.
- `409 DuplicateFountainConflict` - duplicate. Read the typed `error` body and
  route/offer route to `fountain_id`. Missing or malformed `fountain_id` maps to
  a server error, never to a route with an undefined id.
- `401` - unauthenticated/reauth.
- `422` - validation.
- Other HTTP error or internal `Error` - server.
- `TypeError` - network.

Catalogs:

- `GET /api/v1/rating-types` supplies add-time rating dimensions. Do not use
  existing `FountainDetail.dimensions`, because no fountain exists yet.
- `GET /api/v1/attribute-types` supplies add-time attribute observations.
  Boolean attributes render yes/no/unknown. Enum attributes render allowed
  values plus unknown. Unknown is the default and is omitted from the payload.

## UX Shape

The Add tab becomes the primary entry point. The Map tab may also expose a small
authenticated shortcut to the same flow if that can be added without
destabilizing browse interactions, but the Add tab is sufficient for this slice.

The flow is a compact multi-step screen:

1. **Gate:** show the same honest auth states as the 6e-6 contribution panel.
   Signed-out users get a sign-in action. Unconfigured auth does not show a
   writable form.
2. **Location:** use the latest foreground location if available, or let the
   user place/select on a map. The user can:
   - use current GPS location,
   - place at map center,
   - tap the map when supported by the native map event,
   - nudge north/south/east/west for keyboard/assistive access.
3. **Details:** collect working status, optional ratings, optional attributes,
   optional comment, and optional placement note.
4. **Submit:** disable controls while pending. Preserve location and fields on
   validation/server/network errors.
5. **Result:**
   - `201` pushes the created fountain detail route.
   - `409` shows "A fountain already exists here" with a primary action to view
     the existing fountain.

Accessibility requirements:

- Every button/control has a label.
- Result/error messages use a polite live announcement pattern, matching 6e-6.
- The minimum flow is possible without relying only on a pointer map tap:
  current location or place-at-center plus nudge is enough.

## Placement Policy

Mobile can be stricter than desktop because phones usually have foreground GPS,
but the app must still be honest when GPS is denied or unavailable.

- Add constants in mobile map helpers:
  - `BOUND_RADIUS_MIN_M = 150`
  - `ACCURACY_MAX_M = 1000`
  - `PLACE_MIN_ZOOM = 16`
  - `FALLBACK_MAX_SPAN_M = 4000`
  - `NUDGE_STEP_M = 5`
- Add pure placement helpers under `mobile/lib/add-fountain/` or
  `mobile/lib/map/placement.ts`:
  - `haversineMeters`
  - `boundFromFix`
  - `clampToBound`
  - `inBound`
  - `canPlace`
  - `ringFeatureCollection`
  - `pinFeatureCollection`
- If location status is granted and accuracy is usable, use a circle bound
  centered on the fix with radius `max(BOUND_RADIUS_MIN_M, accuracy)`.
- If location is denied/unavailable or accuracy is too poor, use a viewport
  fallback bound and require the visible diagonal to be <=
  `FALLBACK_MAX_SPAN_M`.
- Dropping/nudging outside the bound clamps to the bound instead of silently
  accepting an out-of-bound point.
- The backend create endpoint receives only the chosen fountain coordinates, so
  this remains a client-side UX/data-quality guard, not a security control.

`useForegroundLocation` currently stores only latitude/longitude. This slice
should extend the public hook result with `accuracy` when available, without
logging coordinates.

## Planned Files

- `mobile/app/(tabs)/add.tsx` - replace scaffold with auth-gated add flow.
- `mobile/components/add-fountain/AddFountainForm.tsx` - step UI and submit
  state.
- `mobile/components/add-fountain/AddFountainMap.tsx` - focused placement map
  wrapper around MapLibre layers/sources, or an inline component if it stays
  small.
- `mobile/components/add-fountain/RatingFields.tsx` - add-time rating groups
  using `RatingTypeOut`.
- `mobile/components/add-fountain/AttributeFields.tsx` - add-time attribute
  groups using `AttributeTypeOut`.
- `mobile/lib/add-fountain/payloads.ts` - input validation and typed body
  builder. Reuse the existing `normalizeFountainId`/UUID behavior for duplicate
  `fountain_id` guards instead of adding a divergent id validator.
- `mobile/lib/add-fountain/state.ts` - pure reducer/state transitions and error
  mapping.
- `mobile/lib/add-fountain/placement.ts` - pure placement geometry helpers if
  not placed under `mobile/lib/map/`.
- Tests beside each pure helper.
- `docs/style-guide.md` - document mobile add-fountain screen controls.
- `mobile/README.md` - replace the scaffold note with the implemented 6e-7
  behavior and proof caveat.

Keep component files focused. If a planned component stays tiny, keep it local to
the route instead of creating unnecessary files.

## Task List

### Task 1 - Plan Review

- Write this plan.
- Self-review for invented contracts, auth claims, logging, and UI accessibility.
- Run the Claude plan review loop using Opus 4.8 and write artifacts under
  `temp/claude-reviews/`.
- Do not implement until the plan review verdict is approved.

### Task 2 - Pure Add Payload Helpers

- Add `mobile/lib/add-fountain/payloads.ts`.
- Validate hostile input before any API call:
  - finite lat/lng in range,
  - boolean `is_working`,
  - optional `comments` must be a string and is trimmed/omitted when empty,
  - optional `placement_note` <= 200 after trim,
  - positive integer rating/attribute ids,
  - integer stars 1 through 5,
  - legal attribute values against the live catalog fixture.
- Build `AddFountainRequest`, trimming text and omitting empty optionals,
  empty arrays, and unknown observations.
- Add tests for valid minimal input, invalid coordinates, invalid `is_working`,
  oversized text, bad ratings/observations, unknown omission, and id mapping
  from `RatingTypeOut.id` to `rating_type_id`.

### Task 3 - Pure Placement Helpers

- Extend mobile map constants with placement values.
- Extend `useForegroundLocation` to expose accuracy.
- Add pure placement helpers and tests:
  - usable GPS fix selects circle bound,
  - denied/poor fix selects viewport fallback,
  - clamp leaves in-bound points unchanged,
  - clamp pulls circle outliers to the ring,
  - clamp clamps viewport outliers to the rectangle,
  - `canPlace` rejects low zoom and too-wide fallback viewport,
  - ring/pin GeoJSON feature builders produce stable output.

### Task 4 - Add Flow State And Errors

- Add a pure reducer or state helpers for phases:
  - `idle`
  - `placing`
  - `details`
  - `submitting`
  - `created`
  - `duplicate`
  - `error`
- Preserve user input on validation/server/network errors.
- Map errors consistently with 6e-6:
  - `AuthSessionError`/401 -> unauthenticated
  - 409 with valid UUID -> duplicate
  - 409 malformed -> server
  - 422 -> validation
  - `TypeError` -> network
  - generic `Error` -> server
- Add tests for phase transitions, nudge/clamp behavior, duplicate mapping, and
  malformed duplicate bodies.
- Add an explicit duplicate-phase test proving the resolved `fountain_id` is
  stored before the "View existing" action can route, so the route can never be
  pushed with an undefined id.

### Task 5 - Auth-Gated Add Tab Shell

- Replace `mobile/app/(tabs)/add.tsx` scaffold.
- Use `useAuth()` and `useApi()`.
- Render non-writable auth states honestly:
  - unconfigured
  - initializing
  - signed out
  - signing in
  - reauth required
- Call `auth.signIn()` for sign-in and reauth actions.
- Fetch `rating-types` and `attribute-types` only when authenticated and when
  the details step needs them.
- Keep public map/detail reads unchanged.

### Task 6 - Placement UI

- Build the placement screen using the existing MapLibre dependency.
- Initial camera:
  - user location at neighborhood zoom when available,
  - otherwise the existing default center/zoom.
- Show a chosen pin, optional GPS bound ring, current coordinate readout, and
  placement-gate message.
- Provide current-location, place-at-center, and nudge controls.
- Allow map tap placement where MapLibre RN exposes a reliable press event.
- Disable "Next" until a valid pin and placement gate are satisfied.
- Keep the map unavailable state honest if `basemapStyleUrl` is absent.

### Task 7 - Details UI

- Add working status segmented control, default working.
- Add rating fields from `RatingTypeOut`.
- Add attribute fields from `AttributeTypeOut`, grouped by category/sort order.
- Add comment and placement note inputs with trim behavior; enforce the
  placement note's API cap and do not invent a mobile-only comment cap.
- If rating or attribute catalog fetch fails, show a small non-blocking message
  and allow minimal add to proceed.
- Use mobile theme tokens and update `docs/style-guide.md` in the same task.

### Task 8 - Submit Wiring

- Add a TanStack mutation around:
  `client.POST("/api/v1/fountains", { body })`.
- On success:
  - invalidate `["fountains", "bbox"]`,
  - seed or invalidate detail as appropriate,
  - route to `/fountains/{id}`.
- On duplicate:
  - show the duplicate result,
  - route to `/fountains/{id}` when the user chooses View.
- On auth error:
  - call `auth.markReauthRequired()`.
- Do not clear form state until a successful created/duplicate terminal result.

### Task 9 - Documentation And Focused Verification

- Update `mobile/README.md` with the implemented add flow and owner-gated proof
  caveat.
- Run focused tests for the new helpers.
- Run:
  - `pnpm --filter mobile run typecheck`
  - `pnpm --filter mobile run lint`
  - `pnpm --filter mobile run test`
  - `cd mobile && CI=true pnpm dlx expo-doctor`
  - `git diff --check`
- Before PR, run the full local CI mirror or document the exact local blocker:
  `./run.ps1 check`.

### Task 10 - PR Gate

- Open a PR only after local verification.
- Ensure CI is green.
- Run the Claude PR/code review loop to approval.
- Check all PR comments using `gh pr view <N> --comments` and
  `gh api repos/redducklabs/fountainrank/pulls/<N>/comments`.
- Address every comment before merge.
- Do not deploy locally.

## Testing Matrix

Pure tests:

- Add payload validation/body building.
- Attribute grouping and unknown omission.
- Rating id mapping.
- Placement bound selection, clamping, gate, and GeoJSON builders.
- Add state transitions and error mapping.

Type/lint/build checks:

- Mobile typecheck.
- Mobile lint.
- Mobile Vitest suite.
- Expo Doctor.
- Full repo check before PR when feasible.

Manual/owner-gated later:

- Native auth callback on device.
- Signed-in add-fountain write on device.
- Duplicate-proximity path on device.
- Created/duplicate detail navigation from a dev-client/EAS build.

## Acceptance For This Slice

- Authenticated mobile add-fountain code is implemented and locally verified.
- Signed-out/unconfigured states do not expose a fake writable flow.
- Minimal add and optional fields use the deployed API contract.
- Duplicate `409` routes to the existing fountain id only when the typed body is
  valid.
- Map bbox queries are invalidated after successful create.
- Documentation states the owner-gated proof limits clearly.
- No secrets, `.env` changes, local DB writes, infra mutation, or native generated
  folders are introduced.
