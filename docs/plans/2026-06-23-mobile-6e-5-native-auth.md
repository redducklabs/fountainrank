# Mobile Slice 6e-5 - Native Auth Implementation Plan

> **Execution aid (optional, Claude-Code only):** when run by Claude Code,
> `superpowers:subagent-driven-development` or `superpowers:executing-plans`
> can drive this plan task-by-task. This is not a repo standard and not required;
> any agent may implement the tasks below directly. Steps use checkbox
> (`- [ ]`) syntax for tracking.

**Goal:** Add FountainRank mobile native auth using Logto's Expo / React Native
SDK: system-browser auth-code + PKCE, the configured
`com.redducklabs.fountainrank://callback` redirect, SDK-managed native secure
token storage, backend-audience access tokens for
`https://api.fountainrank.com`, sign-in/sign-out/account state, and an
authenticated `GET /api/v1/me` profile read. The code remains honest about proof:
local CI can prove compilation, lint, type-checking, `expo-doctor`, and unit
tests; functional auth is not claimed until a physical-device callback
round-trip is observed against the production Logto/backend stack.

**Architecture:** Keep the mobile split established in 6e-1 through 6e-4:
pure helpers and API-client behavior are unit-tested in Vitest; React Native
provider/screen code stays thin and is covered by TypeScript, ESLint, and
`expo-doctor`; auth state transitions are additionally covered by pure reducer
tests or hook/component tests with a mocked Logto facade. `@logto/rn` owns PKCE,
redirect handling, token persistence, and refresh. The mobile app never
implements custom OAuth and never stores tokens directly. Authenticated API calls
still go through `createApiClient`; the factory adds Bearer auth internally
through the existing `buildAuthHeaders` helper while preserving the
non-bypassable `X-Dev-*` sanitizer and narrowed client facade.

**Tech Stack:** Expo SDK 56, React Native 0.85, React 19.2, TypeScript 6,
Expo Router, `@tanstack/react-query@5.101.0`, `@fountainrank/api-client`,
Vitest 4.1.9, pnpm workspace. New runtime dependencies: `@logto/rn@1.1.0`;
Expo-peer dependencies per the official Logto Expo docs and Expo SDK 56 bundled
versions: `expo-crypto@~56.0.4`, `expo-secure-store@~56.0.4`,
`expo-web-browser@~56.0.5`, and
`@react-native-async-storage/async-storage@2.2.0`.

**Spec:** `docs/specs/2026-06-23-mobile-store-testing-distribution-design.md`
section 15 Phase 5 and section 18 slice 6e-5. Binding constraints also come from
section 8 (public runtime config), section 12/section 19 (Logto/OAuth
owner-gated dependencies), section 20 (deep-link handling and no code/token
logging), and section 21 (auth-unavailable mode and proof levels). The Logto
Native application exists and its public app ID is `oikth3qbmnrhqd9jmkbc8`;
remaining owner-gated proof is confirming the redirect URI is registered and
running a real device callback round-trip. The plan uses
`EXPO_PUBLIC_LOGTO_APP_ID` as the public app-id input only after
`docs/setup/06-logto.md` records owner confirmation of the Native app type, the
public app id variable name, and the exact redirect URI. A lone env var must not
silently flip the app into sign-in mode. No secret or mobile app secret is ever
committed.

**Current-source reference:** Logto's current Expo quick start documents
installing `@logto/rn` plus Expo peer dependencies, wrapping the app with
`LogtoProvider`, using `useLogto().signIn(redirectUri)` and `signOut()`, adding
the API resource under `resources`, and obtaining a backend access token with
`getAccessToken(resource)`: <https://docs.logto.io/quick-starts/expo>.

---

## Global Constraints

- No AI attribution in commits/PRs/docs; no time estimates anywhere. Use
  Conventional Commits, branch -> PR -> CI green + Codex approval + comments
  addressed -> squash-merge.
- Run all shell commands from the repo root. Use WSL/Linux paths and
  repo-relative paths; never Windows absolute paths in Codex prompts.
- Do not create or modify `.env` files. Do not commit secrets, tokens,
  authorization codes, private keys, app secrets, or local credential files.
- Do not log tokens, authorization codes, callback query strings, full JWTs, raw
  profile payloads, or precise sensitive data. Mobile auth code should not add
  diagnostic logging around tokens at all.
- Do not write to any database. `GET /api/v1/me` is read-only; `POST /api/v1/me/sync`
  is intentionally deferred unless a later approved plan adds the opaque
  userinfo-token path safely.
- Do not expose the dev-auth seam. Mobile must authenticate only with
  `Authorization: Bearer <Logto access token>`. Tests must prove the client still
  strips any attempted `X-Dev-*` header, including when auth is configured.
- Do not let partial public config enable sign-in. Auth is configured only after
  the owner-confirmed Logto Native app type, public app id variable name, and
  exact redirect URI are recorded in `docs/setup/06-logto.md`. Until then
  `logtoAppId` remains absent from resolved Expo config and the account tab stays
  in public-read mode, even if a stray `EXPO_PUBLIC_LOGTO_APP_ID` exists in the
  shell.
- Functional auth proof is owner-gated. PR/handoff wording may say the auth code
  compiles, lints, type-checks, and is unit-tested; it may not say sign-in works
  until a physical-device callback round-trip is observed.
- Add mobile dependencies with SDK-compatible versions, run
  `CI=true pnpm install --no-frozen-lockfile`, and commit `mobile/package.json`
  with `pnpm-lock.yaml` in the same task.
- Verify the exact tree before each commit: edit -> `pnpm exec prettier --write`
  touched files -> run the relevant check -> commit without further edits.

---

## Scope

Included:

- Add Logto Expo / React Native SDK and peer dependencies.
- Add gated `EXPO_PUBLIC_LOGTO_APP_ID` wiring in `mobile/app.config.ts`; the app
  id is surfaced into `extra.logtoAppId` only after the confirmation doc is
  updated and implementation deliberately enables native auth config.
- Add a Logto provider wrapper that is mounted only when auth is configured.
- Add an app-local auth facade/hook so the rest of mobile code does not import
  SDK types directly except inside the auth provider implementation.
- Extend `createApiClient` to accept an async token provider, attach Bearer
  headers for generated requests, and keep the sanitizer/facade guarantees.
- Add a dedicated auth/session error discriminant so token-provider failures and
  expired sessions cannot be mistaken for offline/network outages.
- Update `ApiProvider` so authenticated requests use the Logto backend-audience
  token when a user is signed in.
- Replace the account placeholder with public-mode, signed-out, signed-in,
  loading, and error states; provide sign-in/sign-out controls; fetch
  `GET /api/v1/me` after authentication; retry gracefully.
- Update mobile docs/style guide with the auth behavior and proof boundary.

Deferred:

- Contribution/write workflows, including ratings, status reports, attributes,
  notes creation, and add-fountain auth gating: 6e-6 and 6e-7.
- Profile sync via `POST /api/v1/me/sync`: defer unless the mobile SDK exposes a
  safe opaque userinfo token path and a separately reviewed plan covers it.
- Device callback proof, native social-login validation, Android Play SHA-1
  alignment, and store-channel auth checks: owner-gated 6e-9/6e-10 work.
- Custom OAuth implementation, manual token storage, or raw AuthSession plumbing.

---

## File Structure

Pure/unit-tested:

- `mobile/lib/auth/config.ts` (new): build Logto config and callback URL from
  validated `MobileConfig`; no SDK side effects; returns unconfigured unless the
  owner-confirmed native-auth record gate is satisfied.
- `mobile/lib/auth/config.test.ts` (new): configured/unconfigured cases,
  callback URL construction, backend resource inclusion.
- `mobile/lib/auth/state.ts` (new): pure reducer/discriminants for auth facade
  states and sign-in/profile outcomes.
- `mobile/lib/auth/state.test.ts` (new): unconfigured, signed out, sign-in
  success, browser cancel/dismiss, SDK error, token failure, profile 401, and
  reauth-required transitions.
- `mobile/lib/auth/profile.ts` (new): small display helpers for `MeResponse`
  such as safe initial/name/email display.
- `mobile/lib/auth/profile.test.ts` (new): profile display edge cases.
- `mobile/lib/api.ts` (modify): add optional async auth-token provider support
  to `createApiClient` plus a dedicated auth/session error class or discriminant.
- `mobile/lib/api.test.ts` (modify): Bearer attachment, missing-token omission,
  auth/session error behavior, and `X-Dev-*` stripping with auth enabled.
- `mobile/lib/config.test.ts` (modify): assert `EXPO_PUBLIC_LOGTO_APP_ID` style
  values remain optional but valid when present.

React Native shell:

- `mobile/providers/auth-provider.tsx` (new): wraps `@logto/rn` and exposes a
  narrow `useAuth()` surface for sign-in, sign-out, account status, and
  `getBackendAccessToken()`. Screens receive app-level facade methods only; they
  never pass raw SDK options.
- `mobile/providers/api-provider.tsx` (modify): consume `useAuth()` and build
  `createApiClient(config.apiBaseUrl, { getAccessToken })`.
- `mobile/app/_layout.tsx` (modify): mount `AuthProvider` around `ApiProvider`
  only after mobile config parses successfully.
- `mobile/app/(tabs)/account.tsx` (modify): real account screen with
  public-mode, signed-out, sign-in-pending, signed-in profile, profile-error,
  and sign-out states.
- `mobile/app.config.ts` (modify): add `logtoAppId` from
  `process.env.EXPO_PUBLIC_LOGTO_APP_ID` only behind the documented
  owner-confirmed native-auth gate, without a committed fallback unless the owner
  explicitly chooses one.

Docs:

- `mobile/README.md` (modify): native-auth config variables and proof boundary.
- `docs/style-guide.md` (modify): account/auth controls and states.
- `docs/setup/06-logto.md` (modify): record the mobile public variable name and
  redirect URI confirmation checklist, without secret values. This doc update is
  the prerequisite for surfacing `logtoAppId` into resolved Expo config.

---

## Implementation Tasks

### Task 1: Plan review gate

- [ ] Self-review this plan for security, correctness, dependency, and proof
      wording.
- [ ] Run Codex Loop A on this plan and write the review to
      `temp/codex-reviews/2026-06-23-mobile-6e-5-native-auth-plan-review-1.md`.
- [ ] Address every finding and loop until the latest review ends with
      `VERDICT: APPROVED`.

### Task 2: Branch and dependency install

- [ ] Create `feat/mobile-6e-5-native-auth` from up-to-date `origin/main`.
- [ ] Re-check current package metadata immediately before install:
      `pnpm view @logto/rn version peerDependencies dependencies --json`, plus
      Expo SDK 56 bundled/native-compatible versions for the peer dependencies.
      Record any deviation in the PR/handoff before changing dependencies.
- [ ] Add `@logto/rn@1.1.0` and Expo-peer dependencies with the SDK 56 versions
      listed above.
- [ ] Run `CI=true pnpm install --no-frozen-lockfile`.
- [ ] Format `mobile/package.json`, `pnpm-lock.yaml`, and the plan.
- [ ] Run `pnpm --filter mobile exec expo-doctor` or the mobile check if the
      dependency install itself changes native-doctor behavior.
- [ ] Commit dependency and plan changes together.

### Task 3: Auth config helpers

- [ ] Update `docs/setup/06-logto.md` with the owner-confirmed Native app type,
      `EXPO_PUBLIC_LOGTO_APP_ID` variable name, public app id, and exact
      `com.redducklabs.fountainrank://callback` redirect URI before enabling
      sign-in UI. If redirect URI confirmation is unavailable, leave
      `logtoAppId` absent and ship only public-read/auth-unavailable behavior.
- [ ] Add pure helpers that derive `redirectUri` as
      `${authCallbackScheme}://callback` and Logto provider config as
      `{ endpoint, appId, resources: [logtoAudience] }` only when the owner
      confirmation gate is satisfied.
- [ ] Return an explicit unconfigured state when `logtoAppId` is absent or the
      owner-confirmed native-auth gate is not satisfied.
- [ ] Unit-test configured/unconfigured behavior and resource inclusion.
- [ ] Format and run `pnpm --filter mobile exec vitest run lib/auth/config.test.ts`.

### Task 4: Authenticated API client path

- [ ] Extend `createApiClient` with an optional
      `getAccessToken: () => Promise<string | null | undefined>` option.
- [ ] Attach `Authorization: Bearer <token>` through `buildAuthHeaders` before
      requests leave the generated client.
- [ ] Add a dedicated auth/session error class or discriminant for failed token
      acquisition, distinct from `ApiError` and from generic network/offline
      failures.
- [ ] Update view-state/profile mapping so token-provider failures are rendered
      as auth/session problems, never as offline/network outages.
- [ ] Preserve the narrowed facade and sanitizer as the final request boundary.
- [ ] Add tests for Bearer attachment, absent token, auth/session error
      classification, and attempted `X-Dev-*` injection after auth headers are
      present.
- [ ] Format and run `pnpm --filter mobile exec vitest run lib/api.test.ts`.

### Task 5: Auth provider shell

- [ ] Add `AuthProvider` using `LogtoProvider` only when the mobile config is
      auth-configured. In unconfigured mode, expose public-read auth state
      without mounting the SDK.
- [ ] Expose a narrow app auth surface: `status`, `isConfigured`,
      `isAuthenticated`, `signIn()`, `signOut()`, and
      `getBackendAccessToken()`.
- [ ] `signIn()` must expose no raw SDK options to screens and must internally
      call the SDK's string overload, `signIn(redirectUri)`, with the exact
      configured callback URI.
- [ ] Classify sign-in outcomes explicitly: success/return from SDK,
      browser-cancel or dismiss, SDK/auth error, and unconfigured mode. A cancel
      must unwind pending state without showing a hard auth failure.
- [ ] `getBackendAccessToken()` must call `getAccessToken(config.logtoAudience)`
      only when authenticated; it must never expose or log the returned token.
- [ ] On backend 401 or token-provider auth/session error, transition to a
      deterministic `reauthRequired` state and stop/gate authenticated queries.
      Either call the SDK sign-out/clear flow or surface an explicit reauth CTA;
      do not leave `isAuthenticated=true` causing repeated `/me` retries.
- [ ] Wire `AuthProvider` in `app/_layout.tsx` and pass the auth token provider
      into `ApiProvider`.
- [ ] Add tests, with `@logto/rn` mocked or reducer behavior isolated, covering
      unconfigured mode, signed-out mode, exact callback URI passed to sign-in,
      cancel/dismiss, SDK error, sign-out, token retrieval only when
      authenticated, and reauth-required transition.
- [ ] Run mobile type-check and the new auth state/provider tests after the
      provider compiles.

### Task 6: Account screen and profile read

- [ ] Replace the placeholder account screen with production-shaped states:
      public-read mode when auth is unconfigured, signed-out sign-in CTA,
      pending/disabled button states, signed-in profile summary, profile-load
      retry, and sign-out.
- [ ] Fetch `GET /api/v1/me` only when `isAuthenticated` is true; use the
      authenticated API client and `unwrap`.
- [ ] Treat 401 as a session-expired/signed-out state with a sign-in CTA; treat
      network/server failures as retryable profile-load failures.
- [ ] Disable React Query retry for `/me` 401/auth-session failures and make the
      query enabled only while the auth facade reports an authenticated usable
      session.
- [ ] Display only backend profile fields needed on screen
      (`display_name`, displayable `email`, optional avatar, admin label if
      useful). Do not render raw IDs or full profile payloads.
- [ ] Verify disabled controls, loading affordances, accessibility labels,
      dynamic text wrapping, and small-screen text fit against existing mobile
      visual patterns.
- [ ] Add account behavior tests or reducer tests for authenticated `/me` query
      enablement, 401/session-expired handling, retry behavior, and
      token-provider auth errors.
- [ ] Keep contribution/add-fountain actions hidden or unavailable; they land in
      later slices.

### Task 7: Documentation

- [ ] Update `mobile/README.md` with
      `EXPO_PUBLIC_LOGTO_APP_ID`, `EXPO_PUBLIC_LOGTO_ENDPOINT`,
      `EXPO_PUBLIC_LOGTO_AUDIENCE`, and the callback URI. State that the app ID
      is public and no mobile app secret exists.
- [ ] Update `docs/setup/06-logto.md` with the native app ID variable name and a
      redirect-URI confirmation checklist. Do not add secrets.
- [ ] Update `docs/style-guide.md` for account/auth controls and states.
- [ ] Format docs explicitly.

### Task 8: Verification

- [ ] Run focused unit tests changed in this slice.
- [ ] Run `powershell.exe -NoProfile -ExecutionPolicy Bypass -File run.ps1 check -Mobile`.
- [ ] Run the full local mirror before opening the PR:
      `powershell.exe -NoProfile -ExecutionPolicy Bypass -File run.ps1 check`.
- [ ] Verify `git status --short` is clean except intentional files before
      commit/push.
- [ ] Open PR with `gh`, wait for CI green, run Codex Loop B, address all PR
      comments, loop to `VERDICT: APPROVED`, then squash-merge.

---

## Acceptance Criteria

- Mobile app compiles, lints, type-checks, passes unit tests, and passes
  `expo-doctor` through the local mobile check.
- `mobile/package.json` and `pnpm-lock.yaml` include the Logto SDK and required
  Expo peer dependencies.
- `EXPO_PUBLIC_LOGTO_APP_ID` is the only app-id injection point unless the owner
  explicitly chooses a committed public default; no secret is introduced.
- Resolved Expo config omits `logtoAppId` until `docs/setup/06-logto.md` records
  the owner-confirmed Native app type, public app id variable name, and exact
  redirect URI.
- Account tab has honest public-mode, signed-out, pending, signed-in, error, and
  sign-out states.
- Sign-in cancellation/dismissal, SDK errors, unconfigured mode, token-provider
  failures, and `/me` 401 all have explicit non-token-logging UI/state behavior
  covered by tests.
- Authenticated `GET /api/v1/me` uses a Bearer token from
  `getAccessToken(config.logtoAudience)`.
- Token-provider failures use a dedicated auth/session error path and are not
  rendered as offline/network failures.
- `createApiClient` still strips `X-Dev-*`, exposes only HTTP methods, and does
  not expose raw middleware/fetch escape hatches.
- No token, code, JWT, callback query, secret, or full profile payload is logged
  or committed.
- Final PR/handoff wording is bounded to local verification unless device auth
  proof is actually performed.
