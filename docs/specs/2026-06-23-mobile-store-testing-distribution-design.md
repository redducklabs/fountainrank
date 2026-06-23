# FountainRank — Mobile Store Testing Distribution Design

**Status:** Umbrella design spec — sliced for implementation · **Date:** 2026-06-23
**Scope:** Prepare a fully usable Expo / React Native mobile beta for
installable iOS and Android test distribution through Apple TestFlight and
Google Play testing tracks.

> **This is an umbrella spec, not a single slice.** It spans the whole mobile
> app *and* its store-distribution path. Implementation is broken into small,
> independently shippable slices — each its own plan → Codex review → branch →
> CI + Codex PR review → squash-merge → deploy/verify, per
> `claude_help/development-process.md` and `claude_help/codex-review-process.md`.
> See **§18 (slice breakdown)** and **§19 (Claude-actionable vs owner-gated
> execution split)**. A large fraction of the store-distribution work is
> **owner-gated** and cannot be executed by an automated agent.

---

## 1. Summary

FountainRank already has a deployed production web/API/auth footprint on
`fountainrank.com`, and the repo already contains a native Expo / React Native
mobile workspace in `mobile/`. The current mobile app is still a walking
skeleton: it can run through Expo tooling, but it is not yet configured for
store-distributed builds.

This spec defines the path from the current mobile skeleton to a fully usable
store-backed test app:

- iOS testers install from **TestFlight**.
- Android testers install from **Google Play internal or closed testing**.
- Builds are produced with **EAS Build** and uploaded with **EAS Submit**.
- The mobile app talks to the deployed FountainRank API/auth stack, not a local
  development backend.
- The app supports the core FountainRank mobile workflows: map-based discovery,
  fountain detail, sign-in, contribution actions, and add-fountain capture.

The result is not a public App Store / Play Store launch. It is a repeatable beta
distribution path that can later promote the same app identity toward production.

## 2. Goals

- Produce signed iOS and Android mobile builds installable through the official
  store testing channels.
- Keep one stable native app identity across Expo, Apple, Google, Logto, and
  OAuth configuration.
- Configure the mobile app to use the deployed FountainRank production services:
  `https://fountainrank.com`, `https://api.fountainrank.com`, and
  `https://auth.fountainrank.com`.
- Keep secrets out of the repo. Store credentials remain in Expo/EAS, Apple,
  Google, Logto, GitHub environments, or the owner's password manager as
  appropriate.
- Preserve the current CI discipline: type-check, lint, `expo-doctor`, and full
  repo checks before release work is considered ready.
- Ship the first store-testing release as a real mobile beta, not a walking
  skeleton: testers must be able to find fountains, inspect details, sign in,
  contribute, and add a fountain from a physical device.

## 3. Non-goals

- Public production App Store or Play Store release.
- Offline-first sync.
- Push notifications, APNs, or FCM.
- Deep redesign of the mobile product UI.
- Full web feature parity beyond the mobile beta scope in this spec.
- Public leaderboards, rich profiles, badges, and admin moderation UI unless
  those are already implemented before the mobile beta cut.
- Photo upload unless the backend/web photo slice has already shipped and the
  mobile implementation can consume the same API safely.
- Local Terraform, Kubernetes, or database state mutation.
- Committing store credentials, private keys, service-account JSON, signing
  material, provisioning profiles, or `.env` files.

## 4. Current repo state

- `mobile/package.json` is Expo SDK 56 / React Native 0.85 with scripts for
  `start`, `android`, `ios`, `lint`, and `typecheck`.
- `mobile/app.json` currently has only `name`, `slug`, `version`, and
  `platforms`.
- No `mobile/eas.json` exists yet.
- No checked-in `ios/` or `android/` native project exists, which is correct for
  managed Expo unless a native dependency requires prebuild.
- `mobile/App.tsx` currently uses `http://localhost:3021`, which is valid only
  for local dev and must not ship in a store testing build.
- `docs/setup/04-apple-and-app-stores.md`,
  `docs/setup/03-google-cloud.md`, and `docs/setup/06-logto.md` already capture
  the account, OAuth, and Logto setup surfaces this work must align with.

## 5. Functional mobile beta target

Store testing is not complete just because the app installs. The first
TestFlight / Google Play testing release must be useful enough for a tester to
exercise FountainRank in the field.

Minimum functional scope:

| Area | Required beta behavior |
|---|---|
| App shell | Native app launches to the FountainRank product experience, handles loading/error/offline states, and exposes app version/build info in a low-friction diagnostic surface. |
| Production API | All release builds use `https://api.fountainrank.com`; no store-testing build depends on localhost, LAN IPs, or dev tunnels. |
| Map discovery | User can view a native map, grant/deny location permission, center on current location, browse the deployed basemap, and see fountain pins from the production bbox/nearby APIs. |
| Pin/detail navigation | Tapping a fountain opens a native detail view with rating summary, operational status, access attributes, notes, and enough context to decide whether to visit it. |
| Search/filter basics | User can narrow visible fountains by the filters already supported by the production API where those filters have shipped, at minimum working status and rating threshold when available. |
| Auth | User can sign in and sign out through Logto using the native app redirect flow; token storage uses native secure storage through the selected SDK path. |
| Existing-fountain contributions | Signed-in user can rate an existing fountain, verify/report operational status, **add** notes (create-only — the notes API is list/create; there is no update/delete operation), and set available access/attribute observations where the corresponding APIs have shipped. |
| Add fountain | Signed-in user can add a fountain using current GPS location and a map-selected location, submit required fields/initial rating, handle 409 duplicate-proximity responses, and navigate to the resulting or existing fountain. |
| User feedback | Mutations show clear pending/success/error states and never silently drop writes. |
| Cross-platform parity | iOS and Android expose the same beta workflows unless a platform-specific store or OS restriction is explicitly documented. |

Feature gating rule: if a backend/API slice is not yet deployed, the mobile UI
must not present that action as working. It should either omit the action or show
a deliberate disabled state only when the surrounding screen still makes sense.

The first store-testing beta may defer photos, public leaderboards, badges,
profile polish, and admin moderation. It must not defer map discovery, detail,
auth, contribution writes on existing fountains, or add-fountain capture unless
the owner explicitly narrows the beta goal before implementation planning.

## 6. Distribution decision

Use EAS Build and EAS Submit as the primary release path.

Expo documents EAS Build as the path for creating store-ready Android and iOS
binaries, and EAS Submit as the upload path to Google Play and Apple App Store
Connect. EAS Submit also supports iOS upload from Windows/Linux workflows, which
fits this repo's WSL-based development environment.

**Why EAS specifically (and what it costs).** The Expo SDK + CLI this repo
already uses are free and open-source — there is no Expo "license." EAS is the
*optional hosted cloud* for builds/submits, and it is the right tool **because
this is a Windows + WSL environment with no Mac**: an iOS App Store binary must
be built and signed on macOS (Xcode), and EAS Build runs cloud macOS machines,
so it produces a signed `.ipa` **without owning a Mac**. The decision is to use
the **EAS free tier** (currently 15 iOS + 15 Android builds/month, $0); a paid
EAS plan is **not** assumed and is only revisited if the free build quota proves
tight. The unavoidable platform fees are Apple's and Google's, not Expo's —
Apple Developer Program and Google Play Console — and the owner already holds
both. A no-EAS fallback (Android built locally, iOS via a Mac + Xcode, manual
store uploads) exists but is rejected here precisely because there is no Mac.

References:

- Expo EAS Build: <https://docs.expo.dev/build/setup/>
- Expo EAS Submit: <https://docs.expo.dev/submit/introduction/>
- Expo submit to app stores: <https://docs.expo.dev/deploy/submit-to-app-stores/>
- Expo build for app stores: <https://docs.expo.dev/deploy/build-project/>

For testers:

- Apple TestFlight supports internal and external beta testing through App Store
  Connect. Apple documents up to 100 internal testers and up to 10,000 external
  testers, with external beta review requirements.
- Google Play internal testing is the first Android target because Google
  documents it as the fast path for initial QA with up to 100 testers. Closed
  testing is the next track when a wider or policy-required test group is needed.

References:

- Apple TestFlight: <https://developer.apple.com/testflight/>
- App Store Connect TestFlight overview:
  <https://developer.apple.com/help/app-store-connect/test-a-beta-version/testflight-overview/>
- Google Play testing tracks:
  <https://support.google.com/googleplay/android-developer/answer/9845334>
- Google Play release rollout:
  <https://support.google.com/googleplay/android-developer/answer/9859348>

## 7. App identity

Use one stable reverse-DNS identity everywhere:

| Surface | Value |
|---|---|
| Expo slug | `fountainrank` |
| iOS bundle identifier | `com.redducklabs.fountainrank` |
| Android package name | `com.redducklabs.fountainrank` |
| Native URL scheme | `com.redducklabs.fountainrank` |
| Logto native redirect URI | `com.redducklabs.fountainrank://callback` |

If the owner chooses a different bundle/package id, update this table before any
store, OAuth, or Logto records are created. Changing native identity after store
records and OAuth clients exist is avoidable churn and can break sign-in.

## 8. Mobile runtime configuration

The mobile app must stop hard-coding `http://localhost:3021` for release builds.
Use Expo public configuration for non-secret client settings:

| Setting | Release value | Secret? |
|---|---|---|
| API base URL | `https://api.fountainrank.com` | No |
| Logto endpoint | `https://auth.fountainrank.com` | No |
| Logto native app ID | From Logto Native application | No |
| Logto backend resource / audience | `https://api.fountainrank.com` | No |
| Native callback URL | `com.redducklabs.fountainrank://callback` | No |

These values can live in Expo config as `extra` values or `EXPO_PUBLIC_*`
variables. They are public client configuration, not secrets. Do not use a
mobile app secret; Logto native apps are public clients.

Development builds may still support local overrides, but release and store
testing profiles must use the deployed production services.

## 9. EAS project and build profiles

> **Prerequisite — Expo / EAS account (owner-gated, NOT yet satisfied).** The
> owner currently has an Apple Developer Program membership and a Google Play
> Console account, but **no Expo / EAS account yet**. EAS Build and EAS Submit
> require an Expo account (ideally a Red Duck Labs organization) and `eas init`
> to link the project. **The Expo account is free to create and the EAS free
> tier (15 iOS + 15 Android builds/month) is expected to cover the beta — no
> paid EAS plan is assumed.** The `mobile/eas.json` and config below can be
> **authored and committed without the account**, but no EAS build or submit can
> run until the owner creates the (free) Expo account and EAS credentials. See §19.

Add EAS configuration under `mobile/`:

- `mobile/eas.json`
- EAS project linkage in Expo config after `eas init`
- build profiles:
  - `development` for internal dev-client builds, not store submission
  - `preview` for installable internal/ad hoc builds when useful
  - `production` for store-ready `.ipa` and `.aab` artifacts
- submit profiles:
  - `ios-production` or `production` targeting App Store Connect
  - `android-production` or `production` targeting Google Play

The production Android artifact should be an Android App Bundle (`.aab`) for Play
testing. iOS production builds should target App Store Connect/TestFlight.

EAS credentials may be managed by EAS. If the owner chooses manual credentials,
those files remain outside the repo and are entered through EAS/Apple/Google
tooling only.

## 10. Apple setup

Prerequisites:

- Apple Developer Program enrollment.
- App Store Connect access for the app owner/developers.
- App ID with bundle identifier `com.redducklabs.fountainrank`.
- Sign in with Apple capability enabled if the app offers Google or other social
  login.
- App Store Connect app record for FountainRank.

Testing flow:

1. Build iOS with the production EAS profile.
2. Submit the build to App Store Connect with EAS Submit.
3. Add the build to a TestFlight internal testing group.
4. Add internal App Store Connect users first.
5. Add external testers only after the first build is ready for beta review.

External TestFlight testers may require Apple beta review before access. Internal
testing is the first target because it has fewer review dependencies and uses App
Store Connect users.

## 11. Google Play setup

Prerequisites:

- Google Play Console developer account.
- Play Console app record for FountainRank.
- Play App Signing enabled.
- Android package name `com.redducklabs.fountainrank`.
- App signing certificate SHA-1 captured from Play Console once signing is
  established.
- Google Play service account key for EAS Submit, stored outside the repo.

Testing flow:

1. Build Android with the production EAS profile, producing an `.aab`.
2. Submit the bundle to Google Play with EAS Submit or manually upload it.
3. Create an internal testing release.
4. Add tester email list and opt-in link.
5. Move to closed testing if a wider or policy-required test group is needed.

If the Play Console account is a new personal developer account, Google may
require closed testing before production access. That requirement does not block
internal testing, but it matters before public launch.

## 12. OAuth and Logto dependencies

Early development builds can launch and call public backend endpoints before
native auth is fully wired. The store-testing beta cannot be considered
functionally complete until authenticated mobile flows work. Authenticated flows
require the following to be consistent:

- Logto Native application exists with redirect URI
  `com.redducklabs.fountainrank://callback`.
- Mobile app config uses the same scheme and callback URL.
- Backend API resource/audience remains `https://api.fountainrank.com`.
- Google OAuth native clients exist after the native identifiers and Android
  signing SHA-1 are known.
- Apple Sign in artifacts exist and match the App ID / Services ID setup.

The store-testing beta requires an auth smoke check and at least one successful
authenticated write from a physical iOS device and a physical Android device.

## 13. Store listing minimums

Even for testing, both stores require app metadata. Prepare the minimum set
without adding secrets to the repo:

- App name: `FountainRank`
- Short description / subtitle
- Full description
- App icon
- Splash screen assets
- Screenshots for required device classes
- Privacy policy URL on `fountainrank.com`
- Terms URL if required by the selected store forms
- App category
- Content rating questionnaire
- Data safety / privacy nutrition answers
- Tester instructions

The app icon and splash assets should live in the repo under `mobile/assets/`
once finalized. Store-console-only answers and account metadata do not need to be
committed unless they become durable project documentation.

## 14. Security and privacy

- No secrets in git, chat transcripts, screenshots, issue comments, logs, or
  generated docs.
- Do not add `.env` files.
- Treat EAS tokens, Apple API keys, Play service-account JSON, signing keys,
  provisioning profiles, and Apple private keys as secrets.
- Native clients are public clients. Do not embed app secrets.
- **Never send the dev-auth seam from mobile.** The generated client exposes
  `X-Dev-User` / `X-Dev-Email` / `X-Dev-Name` headers on write endpoints (the
  dev-only auth shortcut, gated off in production by `dev_auth_enabled=False`).
  The mobile app must authenticate **only** with
  `Authorization: Bearer <Logto access token>` and must **never** set any
  `X-Dev-*` header in any build profile (development, preview, or production).
  The mobile API-client wrapper (slice 6e-2) owns this, and a unit test must
  assert the mobile auth-header builder cannot emit `X-Dev-*` headers.
- Production API/auth URLs are public configuration and may be committed.
- The mobile app must not log access tokens, ID tokens, refresh tokens,
  authorization codes, email magic-link codes, or full user profile payloads.
- Keep store tester groups scoped to intended testers.
- Do not submit a build to public production tracks as part of this work.

## 15. Implementation plan

### Phase 1 — Repo and release configuration

1. Update `mobile/app.json` or replace it with `mobile/app.config.ts` if dynamic
   config is needed.
2. Add bundle/package identifiers, URL scheme, icon/splash references, public
   `extra` config, and the full **store versioning** policy (`expo.version`,
   `ios.buildNumber`, `android.versionCode`, `runtimeVersion`, and whether EAS
   auto-increment advances build numbers/versionCode) — see §20. The diagnostic
   surface (step in Phase 2) must display the same values App Store Connect / Play
   will show.
2a. Add the **static native config** the app needs (no native module required):
   location-permission usage strings (iOS `NSLocationWhenInUseUsageDescription`,
   Android foreground location permission) and the deep-link scheme registration
   for the auth callback — see §20. (The `@maplibre/maplibre-react-native` config
   plugin + CNG/prebuild land in **Phase 3 / slice 6e-3**, with the map that uses
   them — that is when the app stops running in Expo Go.)
3. Replace the hard-coded local API URL in `mobile/App.tsx` with mobile runtime
   config.
4. Add `mobile/eas.json` with development, preview, and production build
   profiles plus submit profiles.
5. Add or update mobile README instructions for store-testing builds.
6. Run mobile lint/typecheck and `expo-doctor`.

### Phase 2 — Native app foundation

1. Choose the mobile navigation structure and state management pattern in line
   with the existing repo conventions.
2. Add mobile app shell screens for map, detail, add fountain, sign-in/account,
   and diagnostics.
3. Add shared API configuration that reads release-safe public config and
   constructs the generated `@fountainrank/api-client`.
4. Add loading, empty, offline, and request-error states that are usable on small
   screens.
5. Add focused tests for pure formatting/state helpers and type-check the full
   mobile workspace.

### Phase 3 — Map and public discovery

1. Add the native map implementation using **MapLibre React Native** — the
   project-standard mobile map stack mandated by the architecture spec
   (`docs/specs/2026-06-16-architecture-and-foundation-design.md` §"Mobile" and
   the Maps row of the technology table) — rendering the same Protomaps basemap
   the web client uses (served by the go-pmtiles tile server). This is settled,
   not an open decision. **This slice installs `@maplibre/maplibre-react-native`
   and adds its Expo config plugin** (CNG/prebuild — the app stops running in
   Expo Go from here on), per §20.
2. Request and handle foreground location permission without blocking manual map
   browsing when permission is denied.
3. Load FountainRank basemap tiles from the deployed tile service.
4. Fetch fountain pins from production-compatible bbox/nearby API calls.
5. Render pin states for working/broken/degraded/rated where the API exposes the
   data.
6. Implement pin selection and navigation to the fountain detail view.
7. Implement basic filters backed by existing API filter parameters.

### Phase 4 — Fountain detail and public reads

1. Render fountain detail using the generated API client and existing backend
   detail contract.
2. Show rating summary, dimensions, operational status, access attributes,
   placement context, notes, and last verification data where present.
3. Handle missing/unknown values without implying false certainty.
4. Provide refresh/retry behavior and preserve map context when returning from
   detail.

### Phase 5 — Native auth

1. Add Logto React Native / Expo auth integration using native browser auth-code
   with PKCE and the configured custom scheme callback.
2. Store tokens using the SDK's native secure storage path.
3. Request access tokens for the backend audience
   `https://api.fountainrank.com`.
4. Add sign-in, callback, sign-out, and account-state handling.
5. Verify `GET /me` or equivalent authenticated profile sync against production
   auth/backend.
6. Confirm no token values are logged.

### Phase 6 — Existing-fountain contribution workflows

1. Add signed-in contribution UI on detail for rating an existing fountain.
2. Add operational status verification/reporting.
3. Add attribute/access observations where the backend endpoints have shipped.
4. Add note **creation** (`POST .../notes`). The notes API is **list/create
   only** — there is no update or delete operation, so the mobile UI must not
   present note editing/deletion as available.
5. Surface contribution success, validation failures, auth expiry, and network
   failures clearly.
6. Refresh detail and pin state after successful writes.

### Phase 7 — Add-fountain capture

1. Add an authenticated add-fountain entry point from the map.
2. Support current GPS location and tap/select-on-map placement.
3. Collect required add fields, initial working/status signal, and initial
   ratings/attributes according to the deployed API contract.
4. Submit through the generated API client with an authenticated token.
5. Handle duplicate-proximity `409` by routing the user to the existing fountain
   and offering contribution actions there.
6. Return to the map/detail state after successful add.

### Phase 8 — Store metadata and owner account setup

1. Confirm Apple Developer Program and Google Play Console access.
2. Create Apple App ID and App Store Connect app record.
3. Create Google Play app record and enable Play App Signing.
4. Confirm or create Expo account/project ownership for Red Duck Labs.
5. Configure EAS credentials without committing credential files.
6. Prepare app icon, splash, screenshots, descriptions, privacy/data-safety
   answers, and tester instructions.
7. Capture non-secret outputs in the relevant setup docs if they become durable
   project values.

### Phase 9 — Auth/OAuth store alignment

1. Create or confirm Logto Native application and callback URI.
2. Set mobile public Logto values.
3. Create Google iOS OAuth client after the bundle id is final.
4. Create Google Android OAuth client after Play signing SHA-1 is available.
5. Confirm Apple Sign in artifacts if social login is present in the mobile app.
6. Smoke-test callback round trips before depending on authenticated mobile
   flows.

### Phase 10 — Functional device release candidate

1. Run the app on at least one physical iPhone and one physical Android device
   using a release-equivalent EAS build profile.
2. Verify map, detail, auth, contribution writes, and add-fountain capture
   against deployed production services.
3. Fix platform-specific runtime issues before store upload.
4. Run the repo checks required by `claude_help/testing-ci.md`.

### Phase 11 — First store-testing builds

1. Run EAS production build for iOS.
2. Run EAS production build for Android.
3. Submit iOS build to App Store Connect/TestFlight.
4. Submit Android build to Google Play internal testing.
5. Add testers and tester instructions in each store console.

### Phase 12 — Store-channel device verification

Verify on at least one physical iPhone and one physical Android device installed
from the store testing channel:

- App installs from TestFlight / Google Play testing.
- App launches without crashing.
- App displays the correct FountainRank identity and assets.
- App reaches `https://api.fountainrank.com`.
- Map loads basemap and fountain pins.
- Detail opens for at least one production fountain.
- Native auth callback succeeds.
- At least one authenticated existing-fountain contribution succeeds.
- Add-fountain flow succeeds or returns a correct duplicate-proximity path.
- Production API smoke checks succeed from cellular and Wi-Fi.
- App version/build number displayed in the store matches the submitted build.
- No secrets or token values appear in device logs.

## 16. Acceptance criteria

The store-testing setup is complete when:

- `mobile/` has committed Expo/EAS configuration for iOS and Android store
  testing builds.
- The mobile app no longer ships a localhost API URL.
- The app identity is consistent across Expo, Apple, Google, and Logto.
- The mobile app is a functional beta, including map discovery, fountain detail,
  native auth, existing-fountain contributions, and add-fountain capture.
- iOS build is available to at least one tester through TestFlight.
- Android build is available to at least one tester through Google Play internal
  or closed testing.
- Physical-device smoke checks pass for install, launch, map, detail, auth,
  contribution writes, add-fountain behavior, and production API reachability.
- Relevant local checks were run and documented in the implementation handoff or
  PR.
- The auth callback was verified on a physical device from **both cold-start and
  warm-app** states, and sign-in cancellation is handled gracefully (§20).
- Crash dashboards (App Store Connect + Google Play Console) were checked after
  device smoke testing, with no unresolved crashes in the core flows (§21).
- Android `targetSdkVersion` and the iOS deployment target meet the stores'
  current minimums and the selected MapLibre version's requirements (§20).
- No secrets or generated credential artifacts were committed.

## 17. Open decisions

### Resolved since the first draft (no longer open)

- **Mobile map stack** — settled: **MapLibre React Native** (architecture spec).
  Not an open decision.
- **Which contribution endpoints are deployed** — resolved at the **exact
  operation level** (each verified against `packages/api-client/src/schema.d.ts`).
  **Reads (GET):** `/api/v1/fountains` (nearby: `lat`/`lng`/`radius_m` +
  working/status/attribute/rating filters), `/api/v1/fountains/bbox`,
  `/api/v1/fountains/{id}` (detail), `/api/v1/fountains/{id}/notes` (list),
  `/api/v1/rating-types`, `/api/v1/attribute-types`, `/api/v1/me`,
  `/api/v1/me/contributions`, `/api/v1/me/badges`,
  `/api/v1/leaderboard/contributors`.
  **Writes (POST):** `/api/v1/fountains` (add, with 409 duplicate-proximity),
  `/api/v1/fountains/{id}/ratings`, `/api/v1/fountains/{id}/attributes`,
  `/api/v1/fountains/{id}/conditions` (operational status),
  `/api/v1/fountains/{id}/notes` (create), `/api/v1/me/sync`.
  **Method-level facts the mobile plan must respect (no invented endpoints):**
  ratings, attributes, and conditions are **POST-only** — there is **no** GET
  collection for them; the **read-side** current status, attribute consensus, and
  rating summary all come from `GET /api/v1/fountains/{id}` (detail) and the pin
  responses, not from per-subresource GETs. Notes are the only per-fountain
  subresource with both **list (GET)** and **create (POST)** — and there is **no**
  `PUT`/`PATCH`/`DELETE` for notes, so note editing/deletion is out of beta scope.
  No backend slice is pending for the beta scope (it is narrowed to note
  *creation*, not because note update exists).
- **Bundle / package id** — `com.redducklabs.fountainrank` is the **proposed
  working default**, consistent with the *example* in
  `docs/setup/04-apple-and-app-stores.md` (which says "e.g.
  `com.redducklabs.fountainrank` — confirm the final bundle id with me") — i.e.
  it is **not yet confirmed**, not an "established convention." It requires an
  explicit owner thumbs-up **before any Apple App ID, Play app record, Logto
  Native app, or Google OAuth client is created**, because changing native
  identity after those exist breaks sign-in. Slice 6e-1 may author config with
  this default only if the plan includes that owner-confirmation gate before any
  external record is created.

### Still open (owner decisions)

- **Expo / EAS account ownership** — the owner has Apple Developer + Google Play
  Console but **no Expo/EAS account yet**; this must be created (ideally a Red
  Duck Labs org) before any EAS build/submit. Blocks §18 slices 6e-8/6e-10.
- Decide whether first Android tester distribution uses internal testing only or
  goes directly to closed testing.
- Decide whether the first TestFlight build is internal-only or includes external
  beta testers.
- Decide whether photos are included in the first functional mobile beta or
  explicitly deferred until after the first store-testing release. *(Default
  assumption per §3 non-goals: photos are deferred unless the backend/web photo
  slice has already shipped.)*
- Finalize mobile app icon, splash screen, screenshots, privacy policy URL, and
  store tester instructions.

## 18. Slice breakdown (implementation)

This umbrella is shipped as small, independently mergeable slices. Each slice is
its own plan (`docs/plans/`) → Codex Loop A → branch → CI green + Codex Loop B +
all PR comments addressed → squash-merge → (where applicable) deploy/verify. The
§15 phases map onto these slices; the phase numbers above are the detailed task
lists, the slices below are the delivery units.

| Slice | Content (maps to §15) | Kind |
|---|---|---|
| **6e-1** | Release config & app identity: kill the `localhost` API URL, add validated runtime config (§8), `app.json`→`app.config.ts` identity (bundle id, scheme), **store versioning** (`version`/`ios.buildNumber`/`android.versionCode`/`runtimeVersion` + increment policy — §20), **static native config** (location-permission usage strings, deep-link scheme — §20), a **mobile unit-test runner**, `mobile/eas.json` (development/preview/production + submit profiles), an app-version/build diagnostic surface, README (Phase 1). The **MapLibre config plugin + native dep land in 6e-3** (with the map that uses them); **finalized icon/splash assets land in 6e-8**. | Claude-actionable to CI-green (config authored with the proposed bundle-id default; the owner-confirmation gate per §17 precedes any external record) |
| **6e-2** | App shell: navigation + state pattern, screen scaffolding (map, detail, add, sign-in/account, diagnostics), shared release-safe API config building `@fountainrank/api-client`, loading/empty/offline/error states, pure-helper tests (Phase 2). | Claude-actionable to CI-green |
| **6e-3** | Map + public discovery: MapLibre RN map (via the config plugin + CNG/prebuild — **not** Expo Go), foreground-location permission (non-blocking when denied), Protomaps basemap tiles, nearby/bbox pins + pin states, pin→detail nav, filters backed by existing API params (Phase 3). | Code + pure-helper tests Claude-actionable to CI-green; **actual map render is verified only on a native build** (dev-client/EAS — owner-gated, since no Mac and no Expo Go) |
| **6e-4** | Fountain detail + public reads: detail via the generated client — rating summary, dimensions, status, attributes, placement, notes, last-verified; unknowns shown honestly; refresh/retry; preserve map context (Phase 4). | Claude-actionable to CI-green |
| **6e-5** | Native auth (Logto): native auth-code + PKCE with the custom-scheme callback, SDK secure-token storage, access tokens for the `https://api.fountainrank.com` audience, sign-in/callback/sign-out/account state, `GET /me` sync, no token logging (Phase 5). Ships behind the **auth-unavailable mode** (§21) until the Logto Native app exists — no placeholder app IDs, signed-in actions hidden/disabled, PR/handoff wording limited to "compiled + unit-tested only." | Code Claude-actionable; **end-to-end verify owner-gated** (needs the Logto Native app + redirect URI; Android social-login also needs the Play SHA-1) |
| **6e-6** | Existing-fountain contributions: rating, status verify/report, attribute observations, note **creation** (create-only — no edit/delete in the API), clear pending/success/error states, refresh after write (Phase 6). Same auth-unavailable mode as 6e-5 until 6e-9. | Code Claude-actionable; signed-in verify owner-gated |
| **6e-7** | Add-fountain capture: authenticated entry, GPS + tap/select-on-map placement, required fields + initial rating/attributes, 409 duplicate-proximity → existing fountain, return to map/detail (Phase 7). | Code Claude-actionable; signed-in verify owner-gated |
| **6e-8** | Store metadata + Expo/EAS account & credentials: Apple App ID + ASC record, Play app record + Play App Signing, Expo account/`eas init` + EAS credentials, icon/splash/screenshots/descriptions/privacy + data-safety answers + tester instructions (Phase 8). | **Owner-gated** |
| **6e-9** | Auth/OAuth store alignment: Logto Native app + callback URI, mobile public Logto values, Google iOS OAuth client (after bundle id final), Google Android OAuth client (after Play SHA-1), Apple Sign-in artifacts, callback smoke test (Phase 9). | **Owner-gated** (Claude sets the public mobile config values once the records exist) |
| **6e-10** | Functional device RC + first store-testing builds + store-channel device verification: EAS production builds, EAS Submit to TestFlight + Play internal testing, add testers, physical-device verification on iOS + Android (Phases 10–12, §16). | **Owner-gated** |

Slices 6e-1 … 6e-4 (public reads + config) have **no auth or store dependency**
and can ship first. 6e-5 … 6e-7 add the authenticated code paths (mergeable on
CI-green) but their *runtime* verification waits on the owner-gated auth records
in 6e-9. 6e-8 … 6e-10 are the owner runbook for accounts, credentials, builds,
and device sign-off.

## 19. Execution split — Claude-actionable vs owner-gated

To set expectations honestly about what an automated agent can finish vs. what
only the owner can do:

**Claude can do autonomously and prove with CI (`./run.ps1 check` — type-check,
lint, `expo-doctor`, tests):**

- All `mobile/` application code, screens, navigation, state, and the shared
  release-safe API config (slices 6e-1 … 6e-7 code).
- `mobile/eas.json`, `app.json`/`app.config.ts`, runtime config, README — the
  *authoring* of EAS/store config, even though the builds that consume it are
  owner-gated.
- The public mobile config **values** (API/auth URLs, scheme, callback) once the
  owner-side records they reference exist.
- Pure-helper/formatting/state unit tests, full mobile type-check + lint +
  `expo-doctor` in CI.

**Owner-gated — an automated agent cannot execute these (no account access, no
physical devices); they are documented here and in `docs/setup/` as a runbook:**

- **Expo / EAS account + `eas init` + EAS credentials** — ⚠️ **not yet set up**
  (owner has Apple Developer + Google Play Console only). The account is **free**
  and the **EAS free tier** (15 iOS + 15 Android builds/month) is expected to
  cover the beta; no paid plan is assumed. Still blocks every EAS Build and EAS
  Submit (i.e. every actual store binary) until created — and because there is no
  Mac, the cloud iOS build is not optional.
- Apple App ID + App Store Connect app record; TestFlight tester groups + review.
- Google Play app record + Play App Signing; internal-testing track + tester list.
- Logto **Native** application + redirect URI `com.redducklabs.fountainrank://callback`.
- Google native OAuth clients (iOS after the bundle id is final; **Android after
  the Play App Signing SHA-1 is captured** — see `docs/setup/04` + `03`).
- Apple Sign-in artifacts for the native app if social login is offered there.
- Physical-device verification (iOS + Android) and store-channel install checks
  (§16).

**Sequencing rule (do not over-claim):** native-auth code (6e-5) compiles and
ships in CI, but mobile auth is **not** "working" until a real callback
round-trip succeeds on a physical device against the deployed Logto + backend —
which requires the owner-gated 6e-9 records. No handoff, PR, or status update may
claim mobile auth, signed-in contributions, or add-fountain "work" until that
round-trip has actually been observed on device.

## 20. Native platform configuration & store requirements

A managed Expo app distributed through the stores needs native configuration the
first draft glossed over. These are requirements, not optional metadata; missing
or inaccurate values cause store-review rejections or runtime failures.

**Maps (MapLibre React Native).** `@maplibre/maplibre-react-native` wraps native
SDKs — it is **not** a JS-only dependency and will **not** run in Expo Go.
Implementation must: install the package, add its **Expo config plugin**, and
rely on **Continuous Native Generation (CNG)** — `npx expo prebuild` generates
the `ios/`/`android/` projects at build time. Keep those generated native folders
**out of git** unless a later, explicitly reviewed slice intentionally commits a
prebuilt project. Map rendering is therefore verifiable only on a **dev-client or
EAS build**, never in Expo Go (slice 6e-3 acceptance reflects this). Pin the
MapLibre RN version and record the Android **min/compile/target SDK** and the iOS
**deployment target** it requires, reconciling them with the store minimums
below.

**Location permission & privacy.** The app uses **foreground-only** location
(no background location in this beta). Native config must declare:
- iOS: `NSLocationWhenInUseUsageDescription` (a clear, honest usage string).
- Android: `ACCESS_FINE_LOCATION` / `ACCESS_COARSE_LOCATION` foreground
  permissions only.

The store **data-safety (Play) / privacy-nutrition (App Store)** answers must
**accurately** reflect what is actually collected and why: approximate/precise
location, account & profile data (via Logto), user contributions, diagnostics,
and crash data (per §21). Because the API is **HTTPS-only**, do **not** add an
iOS ATS exception and do **not** enable Android cleartext traffic.

**Store versioning.** Define and enforce, in slice 6e-1:
- `expo.version` — marketing/semantic version.
- `ios.buildNumber` and `android.versionCode` — **monotonically increasing**
  per-store build numbers (App Store Connect and Play both reject reused build
  numbers).
- `runtimeVersion` policy.
- Whether **EAS auto-increment** advances build numbers / `versionCode`, or they
  are bumped manually.

The in-app diagnostic surface (Phase 2) must display the same version + build
values App Store Connect / Play will show, so a tester's report is unambiguous.

**Deep link / auth callback.** The custom scheme `com.redducklabs.fountainrank`
(callback `com.redducklabs.fountainrank://callback`) must be registered in Expo
config (→ iOS `CFBundleURLTypes`, Android intent-filter) via `expo-linking`. The
callback must be handled correctly from **both cold-start and warm-app** states;
sign-in **cancellation** must be handled; PKCE/state validation is delegated to
the Logto SDK; and the authorization code and tokens must **never** be logged.
This is exercised in 6e-1 (scheme config), 6e-5 (handling), and 6e-9 (the real
Logto record + device round-trip).

**OS minimums.** Pick a current store-compliant Android `targetSdkVersion` and a
supported iOS deployment target, reconciled with the MapLibre RN requirement.
Record the chosen values in 6e-1.

## 21. Auth-unavailable mode, per-slice proof, crash visibility

**Auth-unavailable mode (slices 6e-5 … 6e-7, before 6e-9).** The Logto Native
app and mobile public auth config do **not** exist yet, so authenticated code
must ship without faking availability:
- **No placeholder/fake app IDs or callback values** are committed.
- When the mobile Logto public config is absent, the app stays in a **public-read
  state**: signed-in actions (rate, status, attributes, add note, add fountain)
  are **hidden or disabled**, not shown as working.
- PR and handoff wording for 6e-5 … 6e-7 is limited to **"compiled and
  unit-tested only"** — never "auth works" / "contributions work."
- The **first PR after the Logto Native app exists** carries the on-device
  acceptance gate: one real callback **round-trip** + at least one **authenticated
  write** on a physical device before any "functional auth/contribution" claim.

**Per-slice proof levels.** Each slice's "definition of done" is bounded by the
strongest proof it can actually reach — a PR must not claim umbrella acceptance
(§16) prematurely:

| Proof level | What it means | Who |
|---|---|---|
| **Local CI** | type-check + lint + `expo-doctor` + unit tests (`./run.ps1 check`) | agent |
| **Native build** | renders/runs on a dev-client or EAS build (e.g. MapLibre map) | owner-gated (no Mac → EAS) |
| **Owner-gated records** | accounts, store records, Logto/OAuth records, credentials exist | owner |
| **Store-channel** | installed from TestFlight / Play internal testing + on-device §16 checks | owner |

6e-1, 6e-2, 6e-4 top out at **Local CI**. 6e-3 needs **Native build** to prove
the map. 6e-5 … 6e-7 are **Local CI** as code, then **Owner-gated** + on-device
to prove auth/writes. 6e-8 … 6e-10 are **Owner-gated** → **Store-channel**.

**Crash visibility.** The first beta relies on the **App Store Connect** and
**Google Play Console** crash dashboards — no third-party crash SDK is added by
default (adding one is a separate, explicitly reviewed decision with privacy /
data-safety implications). §16 acceptance includes checking those dashboards
after device smoke testing.

**External-quota check (do not bake a vendor number in).** The EAS free-tier
figure cited in §6/§19 (15 iOS + 15 Android builds/month) is **current as of this
spec, not a durable project fact**. Re-verify Expo's current pricing/quota as the
first step of the owner-gated build slice (6e-10) before relying on it.
