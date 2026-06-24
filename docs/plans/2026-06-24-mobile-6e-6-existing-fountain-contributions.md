# Mobile Slice 6e-6 - Existing-Fountain Contributions Implementation Plan

**Goal:** Add authenticated contribution workflows to the mobile fountain detail
screen for existing fountains: rating, operational-status reports, attribute
observations, and note creation. The UI must be honest in auth-unavailable mode:
when native auth is unconfigured or reauth is required, signed-in write controls
are hidden or blocked with a clear sign-in/account path. Successful writes
refresh the detail and notes reads so rating summaries, status, attributes, and
notes reflect the backend response. Local CI can prove type safety, lint,
unit-tested helper behavior, and config health only; signed-in write behavior is
not claimed until owner-gated native auth records and physical-device
verification exist.

**Architecture:** Keep the 6e-1 through 6e-5 split. Pure validation, payload
building, status labels, and mutation-result mapping live under `mobile/lib/`
and are covered by Vitest. React Native components stay thin: they render form
state, call the `createApiClient` facade from `useApi()`, and let React Query
invalidate/refetch public detail reads after success. The generated API client is
used only through `createApiClient`; no raw generated client, no direct `fetch`,
and no mobile dev-auth bypass. Ratings, attributes, conditions, and notes are
POST-only write calls except notes also has the existing public GET list. The UI
must not invent update/delete note actions.

**Tech Stack:** Expo SDK 56, React Native 0.85, React 19.2, TypeScript 6, Expo
Router, `@tanstack/react-query@5.101.0`, `@fountainrank/api-client`, Vitest
4.1.9, pnpm workspace. No dependency change is expected for this slice.

**Spec:** `docs/specs/2026-06-23-mobile-store-testing-distribution-design.md`
section 15 Phase 6, section 17 deployed endpoint facts, section 18 slice 6e-6,
and section 21 auth-unavailable/proof-level rules. This plan also follows
`CLAUDE.md`, `claude_help/development-process.md`,
`claude_help/testing-ci.md`, `claude_help/oauth-sso.md`, and
`docs/design/architecture.md`.

---

## Global Constraints

- No AI attribution in commits/PRs/docs; no time estimates anywhere. Use branch
  -> PR -> CI green + Codex approval + comments addressed -> squash-merge.
- Run shell commands from the repo root. Use WSL/Linux paths and repo-relative
  paths in Codex.
- Do not create or modify `.env` files. Do not commit secrets, tokens,
  authorization codes, private keys, app secrets, or local credential files.
- Do not log tokens, authorization codes, full JWTs, raw profile payloads, or
  full API payloads. This slice should not add diagnostic logging around
  contribution bodies.
- Do not write to a database outside the app's intended authenticated API POSTs.
  Local verification remains unit/type/lint/doctor unless owner-gated auth/device
  testing is explicitly performed.
- Mobile write calls must use the existing `createApiClient` facade from
  `useApi()`. Never emit `X-Dev-*` headers, never add mobile dev-auth, and never
  use raw `makeClient` at call sites.
- Public reads remain public. Detail and notes GETs must keep working when auth
  is unconfigured or token acquisition fails.
- Auth-unavailable mode is binding. If `auth.status` is `unconfigured`,
  `initializing`, `signedOut`, `signingIn`, or `reauthRequired`, write controls
  must not pretend writes are usable.
- Proof wording is strict. PR/handoff wording may say contribution code
  compiles, lints, type-checks, and is unit-tested; it may not say authenticated
  mobile contributions work until a physical-device native auth round trip and at
  least one authenticated write have actually been observed.

---

## Scope

Included:

- Add pure helpers for contribution payload validation and response/error
  classification.
- Add a detail-screen contribution panel for authenticated users with:
  - rating form using the `detail.dimensions` labels/ids already returned by
    `GET /api/v1/fountains/{id}`;
  - operational status verify/report form for the deployed condition statuses;
  - attribute observation form using the public `GET /api/v1/attribute-types`
    catalog. The existing `detail.attributes` array is consensus/read-side data
    only and contains only previously observed attributes, so it must not be the
    form source;
  - create-only note form using `POST /api/v1/fountains/{id}/notes`.
- Show pending, success, validation/not-found/auth/server/network/session-error
  states clearly with `accessibilityRole="button"` and `role/status` equivalents
  where React Native supports them.
- Clear form state where appropriate after success and refresh detail + notes
  reads.
- Mark auth session failures as `reauthRequired` and avoid repeated protected
  mutation retries.
- Update `docs/style-guide.md` and `mobile/README.md` with mobile contribution
  states and the proof boundary.

Deferred:

- Add-fountain capture and duplicate-proximity handling: slice 6e-7.
- Photo upload, note edit/delete, per-user previous-value prefill, and rich
  contribution history surfaces.
- Owner-gated physical-device auth/write verification and store builds:
  6e-9/6e-10.
- Any backend, schema, generated API client, or web behavior change.

---

## File Structure

Pure/unit-tested:

- `mobile/lib/contributions/state.ts` (new): contribution mutation result types,
  HTTP/auth error mapping, status labels, and auth gating helpers.
- `mobile/lib/contributions/state.test.ts` (new): status mapping, auth-session
  classification, auth gating, and condition-label coverage.
- `mobile/lib/contributions/payloads.ts` (new): validators/builders for rating,
  condition, attribute-observation, and note bodies.
- `mobile/lib/contributions/payloads.test.ts` (new): UUID validation, rating
  star bounds, non-empty payloads, note trimming/length, allowed attribute values,
  enum attribute values, and condition status validation.

React Native shell:

- `mobile/components/fountain/ContributePanel.tsx` (new): top-level auth-gated
  panel composed into the detail body.
- `mobile/components/fountain/RatingContributionForm.tsx` (new): rating inputs
  from `detail.dimensions`; excludes unset dimensions from payload.
- `mobile/components/fountain/ConditionContributionForm.tsx` (new): working
  confirmation plus problem report choices.
- `mobile/components/fountain/AttributeContributionForm.tsx` (new): yes/no/unknown
  controls for boolean attributes and allowed-value-plus-unknown controls for
  enum attributes, using `AttributeTypeOut[]` from `/api/v1/attribute-types`;
  excludes unset rows from payload.
- `mobile/components/fountain/NoteContributionForm.tsx` (new): create-only note
  input; no edit/delete UI.
- `mobile/components/fountain/FountainDetail.tsx` (modify): accept an optional
  contribution element and render it after read-only community content, before
  footer/directions.
- `mobile/app/fountains/[id].tsx` (modify): wire auth state, mutations, query
  invalidation/refetch, and reauth handling.

Docs:

- `docs/style-guide.md` (modify): document mobile contribution forms and
  auth-unavailable states.
- `mobile/README.md` (modify): document proof boundary and owner-gated signed-in
  verification for contribution writes.

No backend, web, generated schema, dependency, CI, Terraform, Kubernetes, or
database-migration changes.

---

## API Contract

All write calls are authenticated through `createApiClient`:

- `POST /api/v1/fountains/{fountain_id}/ratings`
  - Body: `{ ratings: [{ rating_type_id, stars }] }`
  - Return: `FountainDetail`
- `POST /api/v1/fountains/{fountain_id}/conditions`
  - Body: `{ status, is_proximate: false }`
  - Return: `FountainDetail`
- `POST /api/v1/fountains/{fountain_id}/attributes`
  - Body: `{ observations: [{ attribute_type_id, value }] }`
  - Return: `FountainDetail`
- `POST /api/v1/fountains/{fountain_id}/notes`
  - Body: `{ body }`
  - Return: `NoteOut`

HTTP mapping:

- `2xx`: success.
- `401` or `AuthSessionError`: auth/session state requiring reauth.
- `404`: fountain not found.
- `422`: validation failure.
- non-HTTP network failure: network error.
- everything else: server error.

On success, the screen refreshes:

- `["fountain", fountainId]`
- `["fountain", fountainId, "notes"]`
- public map pin query families using the established `["fountains", "bbox", ...]`
  namespace from `mobile/lib/map/filters.ts`.

Attribute catalog read:

- `GET /api/v1/attribute-types` is a public read with query key
  `["attribute-types"]`.
- The route fetches it through `createApiClient`/`useApi()` like other reads, but
  it must not require or acquire an auth token.
- The query is enabled only when the authenticated contribution panel can render
  the attribute form; anonymous/public detail views should not fetch a catalog
  they cannot use.
- The backend returns only active fountain-scoped rows; the attribute form may
  still defensively filter the catalog to `place_type === "fountain"`, but that
  client filter is not load-bearing.
- Boolean attributes render `yes`/`no`/`unknown`. Enum attributes render each
  `allowed_values` member plus `unknown`. The backend accepts `unknown` for any
  attribute, accepts `yes`/`no` only for boolean attributes, and accepts only
  allowed enum values for enum attributes.
- If the catalog read is loading, show a compact loading state for that form. If
  it fails or returns no fountain attributes, show an honest non-submittable
  state; do not render a submit control that can only 422.

---

## Implementation Tasks

### Task 1: Plan review gate

- [ ] Self-review this plan for security, correctness, auth gating, generated
      client usage, proof wording, and missing tests.
- [ ] Run the Claude review workflow from `AGENTS.md` on this plan and write the
      review to
      `temp/claude-reviews/2026-06-24-mobile-6e-6-existing-fountain-contributions-plan-review-1.md`.
- [ ] Address every finding and loop until the latest review ends with
      `VERDICT: APPROVED`.

### Task 2: Branch and plan commit

- [ ] Create `feat/mobile-6e-6-contributions` from up-to-date `origin/main`.
- [ ] Format the plan and commit it before implementation.
- [ ] Do not begin implementation until the review gate above is approved.

### Task 3: Pure contribution state helpers

- [ ] Add mutation result/error types and user-facing labels in
      `mobile/lib/contributions/state.ts`.
- [ ] Add auth gating helpers that classify `unconfigured`, `initializing`,
      `signedOut`, `signingIn`, `reauthRequired`, and `authenticated`.
- [ ] Add condition status labels for all deployed
      `ConditionReportRequest["status"]` values.
- [ ] Add tests for every status and error branch.
- [ ] Run
      `corepack pnpm --filter mobile exec vitest run lib/contributions/state.test.ts`.

### Task 4: Pure payload builders

- [ ] Add UUID, ratings, condition, attributes, and note validators/builders in
      `mobile/lib/contributions/payloads.ts`.
- [ ] Reject empty ratings and observations before any API call.
- [ ] Accept only integer rating type ids greater than zero and stars 1 through 5.
- [ ] Accept only deployed condition statuses.
- [ ] Validate attribute observations against catalog metadata: `unknown` is
      always legal; `yes`/`no` are legal only for boolean attributes; enum values
      must be present in that attribute type's `allowed_values`.
- [ ] Trim note bodies; reject empty notes and notes over the backend limit used
      by web (`1000` characters). The client-side count is a guardrail only; the
      backend remains the final authority for Unicode/code-point boundary cases.
- [ ] Add tests covering hostile input and successful payloads.
- [ ] Add enum attribute tests: a legal enum value, illegal `yes` for an enum
      attribute, and `unknown` as legal for an enum attribute.
- [ ] Run
      `corepack pnpm --filter mobile exec vitest run lib/contributions/payloads.test.ts`.

### Task 5: Rating and condition UI

- [ ] Add `RatingContributionForm` using compact 1-5 controls per dimension from
      `detail.dimensions`.
- [ ] Exclude dimensions with no selected value from the submit payload.
- [ ] Show disabled/pending state during mutation and a success/error message
      afterward.
- [ ] Add `ConditionContributionForm` with a direct "working" confirmation and
      explicit problem choices.
- [ ] Ensure both forms call mutation callbacks passed by the route, not raw API
      clients.
- [ ] Run mobile type-check and lint after wiring these components.

### Task 6: Attribute and note UI

- [ ] Add a public `GET /api/v1/attribute-types` query with key
      `["attribute-types"]`, enabled only when the authenticated attribute form
      can render.
- [ ] Add `AttributeContributionForm` using `AttributeTypeOut[]` labels/ids,
      `value_kind`, and `allowed_values`; do not source the form from
      `detail.attributes`.
- [ ] Render boolean attributes as yes/no/unknown and enum attributes as
      allowed-values-plus-unknown.
- [ ] Show loading/error/empty catalog states without presenting a broken submit
      path.
- [ ] Exclude unset attributes from the submit payload; reject empty submit
      before an API call.
- [ ] Add `NoteContributionForm` with create-only semantics. Do not show edit or
      delete controls.
- [ ] Trim note body before submit and clear it only after success.
- [ ] Show pending/success/error states for both forms.
- [ ] Run mobile type-check and lint after wiring these components.

### Task 7: Detail route mutations and cache refresh

- [ ] Wire contribution mutations in `mobile/app/fountains/[id].tsx` using
      `useMutation` and `client.POST(...)` through `useApi()`.
- [ ] Use `unwrap()` for HTTP response handling and the pure error mapper for
      UI messages.
- [ ] On `AuthSessionError` or `401`, call `auth.markReauthRequired()` and stop
      presenting authenticated write controls.
- [ ] On successful rating/condition/attribute writes, update or refetch the
      detail query.
- [ ] On successful note creation, refetch notes and keep detail refresh
      behavior consistent.
- [ ] Invalidate the map pin query namespace `["fountains", "bbox"]` after
      successful rating, condition, or attribute writes so visible pins can
      refresh their rating/status summaries.
- [ ] Submit condition reports with `is_proximate: false` in this slice because
      proximity/device-location verification is deferred to add-fountain/device
      flows; this records a conservative non-proximate report rather than
      pretending the app verified the user is at the fountain.
- [ ] Confirm public detail/notes GETs still do not require a token.

### Task 8: Compose auth-gated contribution panel

- [ ] Add `ContributePanel`.
- [ ] Render a public/auth-unavailable state when auth is unconfigured.
- [ ] Render a sign-in/account CTA when signed out or reauth is required.
- [ ] Render initializing/signing-in pending states.
- [ ] Render write forms only when `auth.status === "authenticated"`.
- [ ] Compose the panel into `FountainDetail` without moving or weakening the
      existing read-only detail sections.
- [ ] Keep long labels and button text wrapping on narrow screens.

### Task 9: Documentation

- [ ] Update `docs/style-guide.md` under the mobile section with contribution
      panel layout, control states, and auth-unavailable behavior.
- [ ] Update `mobile/README.md` to document that contribution code is locally
      verified only until owner-gated native auth/device write verification
      exists.
- [ ] Note that mobile contribution diagnostics are user-visible states rather
      than logs; do not add logging of note bodies, attribute observations, or
      other contribution payloads.
- [ ] Format docs explicitly.

### Task 10: Verification

- [ ] Run focused Vitest for contribution helpers:
      `corepack pnpm --filter mobile exec vitest run lib/contributions/state.test.ts lib/contributions/payloads.test.ts`.
- [ ] Run `corepack pnpm --filter mobile run typecheck`.
- [ ] Run `corepack pnpm --filter mobile run lint`.
- [ ] Run `corepack pnpm --filter mobile run test`.
- [ ] Run `cd mobile && CI=true corepack pnpm dlx expo-doctor`.
- [ ] Run `git diff --check`.
- [ ] Before opening a PR, run the full repo mirror when WSL/Windows dependency
      state permits:
      `powershell.exe -NoProfile -ExecutionPolicy Bypass -File run.ps1 check`.

### Execution Status

- Completed: Claude plan review loop, implementation tasks 3 through 9, focused
  contribution helper tests, mobile type-check, mobile lint, mobile test suite,
  Expo Doctor, and `git diff --check`.
- Not done: no commit was created because this session did not include an
  explicit commit request.
- Not run: full repo mirror `run.ps1 check`; this should run before opening a
  PR if the local Windows/WSL dependency state permits.

---

## Acceptance Criteria

- The mobile detail screen presents contribution actions only in authenticated
  state and remains honest in auth-unavailable/reauth states.
- Rating, condition, attribute, and note-create mutations use
  `createApiClient`; no raw client, direct fetch, or `X-Dev-*` header path is
  introduced.
- Public detail and notes reads still work without auth and do not acquire
  tokens.
- Successful mutations refresh the relevant detail/notes data.
- Validation prevents empty/malformed payloads before API calls.
- Attribute observation UI is sourced from `/api/v1/attribute-types`, handles
  enum and boolean attributes correctly, and does not depend on existing
  consensus rows.
- Note UI is create-only; no edit/delete affordance exists.
- Local mobile tests/type-check/lint/expo-doctor pass on the final tree, or any
  skipped/blocked verification is reported exactly.
- Final wording does not claim signed-in mobile contributions work on device
  unless that owner-gated verification actually happened.
