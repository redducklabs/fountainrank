# Mobile store metadata and release-readiness (slice 6e-8) Implementation Plan

**Goal:** Turn the already-merged mobile beta code into a store-readiness
package that can be handed to the owner for Apple, Google Play, Expo/EAS, and
Logto account work without guessing at secrets, account identifiers, policy
answers, screenshots, or device results.

**Spec:** `docs/specs/2026-06-23-mobile-store-testing-distribution-design.md`
slice 6e-8, especially sections 8-14 and 18-21.

**Current baseline:** `main` includes slices 6e-1 through 6e-7. The app has
production API/auth defaults, Expo Router, MapLibre native map code, native auth
scaffolding, existing-fountain contributions, add-fountain capture, `mobile/eas.json`,
and public EAS project linkage in `mobile/app.config.ts`. The older umbrella
spec text that says the Expo/EAS account does not exist is superseded by
`handoffs/2026-06-23-mobile-store-readiness-and-6e-3-next-handoff.md`: the
Expo org, EAS project, and bundle id are already owner-confirmed. Native
signed-in write behavior is still not proven end-to-end until owner-controlled
credentials, store builds, OAuth/store records, and physical-device tests are
complete.

## Boundary

This slice is mostly owner-gated. The repo-local deliverable is a precise,
credential-free release-readiness package:

- a checked plan that separates agent-actionable work from owner-only work;
- setup/runbook updates for Apple, Google Play, Expo/EAS, Logto, and store
  metadata;
- mobile README updates with exact non-secret build/readiness commands and
  caveats;
- Expo config references for finalized app icon/splash assets only if the
  assets exist in the repo and pass Expo config validation;
- store-listing draft inputs only where they are factual and owner-reviewable,
  never invented legal/privacy/data-safety answers;
- verification commands that can run without external credentials.

Do not run EAS builds, EAS submit, Apple/Google console changes, Terraform
state-changing commands, Kubernetes writes, database writes, or any command that
requires credentials. Do not create or edit `.env` files.

## Current Facts To Preserve

- App name: `FountainRank`.
- Owner-confirmed native identity already in config:
  - iOS bundle identifier: `com.redducklabs.fountainrank`
  - Android package: `com.redducklabs.fountainrank`
  - URL scheme: `com.redducklabs.fountainrank`
  - Logto callback URI: `com.redducklabs.fountainrank://callback`
- Production public endpoints:
  - API: `https://api.fountainrank.com`
  - Logto: `https://auth.fountainrank.com`
  - audience/resource: `https://api.fountainrank.com`
- Current release versioning:
  - `expo.version`: `0.1.0`
  - `ios.buildNumber`: `1`
  - `android.versionCode`: `1`
  - `runtimeVersion.policy`: `appVersion`
  - `mobile/eas.json` uses `appVersionSource: "local"` and production
    `autoIncrement: true`; this was intentionally deferred from 6e-1 and must
    be resolved in this slice because dynamic `app.config.ts` does not give EAS
    a static JSON file to mutate for local auto-increment.
- Current EAS config:
  - `owner: "red-duck-labs"`
  - public project id: `820564bf-5f29-44c7-8ec7-edde67b77360`
  - Expo org `red-duck-labs` and EAS project `fountainrank` exist and were
    linked via `eas init`;
  - development, preview, and production build profiles exist;
  - Android production build type is `app-bundle`;
  - Android production submit track is `internal`;
  - no iOS submit profile exists yet.
- Current assets at plan start: only map pin PNGs existed under
  `mobile/assets/pins/`. Follow-up 6e-8 work later added the app icon, adaptive
  icon, splash image, Play feature graphic, and owner-approved store screenshot
  mockups.

If any of these facts have changed by the time implementation begins, update
this section before editing code or runbooks.

## Constraints

- No secrets, token values, signing material, service-account JSON, Apple private
  keys, provisioning profiles, certificates, or `.env` values in git.
- The bundle id/package/scheme are owner-confirmed and may be used for external
  records. Do not change them after Apple, Google Play, Logto, or OAuth records
  exist.
- Store metadata that is subjective, legal, policy-sensitive, or console-only
  must be marked owner-review-required. Do not invent data-safety, privacy
  nutrition, content rating, or legal answers.
- Store screenshots must accurately represent the shipped native build. Real
  native captures remain preferred for final submission, but the owner may
  explicitly approve generated, clearly labeled mockups as interim store-console
  assets when the console is blocked on screenshots before builds are ready.
- Privacy and terms URLs must point to real deployed pages before store
  submission. The repo currently has web privacy/terms pages, but 6e-8 may only
  document the URL requirement unless deployment is verified separately.
- Auth remains in auth-unavailable mode until the owner confirms the Logto
  Native app callback exactly and sets the mobile public build variables.
- No public-production store submission is in scope. First channel remains
  TestFlight and Google Play internal or closed testing.
- `ios/` and `android/` generated native folders stay out of git.
- Do not edit `CLAUDE.md` or Claude-specific files.

## Repo-Local Deliverables

1. **Owner runbook updates.**
   Update setup docs so the owner has one coherent checklist for:
   - Expo/EAS account/org/project facts that are already confirmed;
   - EAS credential management and the rule that credential files stay outside
     the repo;
   - Apple App ID, App Store Connect app record, TestFlight group, Sign in with
     Apple capability, and non-secret outputs to report back;
   - Google Play app record, Play App Signing, internal/closed testing decision,
     Play signing SHA-1, and non-secret outputs to report back;
   - Logto Native redirect confirmation and the build variables that may be set
     only after confirmation.

2. **Store metadata worksheet.**
   Add a repo-local worksheet or runbook section that lists the minimum store
   inputs:
   - app name;
   - subtitle/short description draft;
   - full description draft;
   - category;
   - support/contact URL or email;
   - privacy URL;
   - terms URL if used;
   - content-rating questionnaire inputs to confirm;
   - Apple privacy nutrition inputs to confirm;
   - Google Play data-safety inputs to confirm;
   - tester instructions for the beta scope.

   Draft copy may describe factual app behavior from the shipped beta, but all
   legal, safety, contact, and store-policy answers must be labeled
   owner-confirmed-before-submission.

3. **Asset readiness.**
   Decide one of two paths during implementation:
   - If the owner provides or explicitly approves generated assets, add
     build-valid icon/splash/adaptive-icon files under `mobile/assets/` and wire
     `mobile/app.config.ts` to them.
   - If no approved assets exist, leave `mobile/app.config.ts` unchanged and add
     an asset checklist with exact file paths, dimensions, and validation
     commands. Do not reference missing files in Expo config.

   Screenshots may be either real native captures or owner-approved generated
   mockups, but mockups must be labeled as such in repo docs, dimension-checked
   against the target store slots, and replaced before final submission if they
   no longer match the shipped native build.

4. **Mobile release-readiness docs.**
   Update `mobile/README.md` with the 6e-8 state:
   - which EAS config is committed and credential-free;
   - which build/submit steps are owner-gated;
   - the required clean reinstall before `expo prebuild` or EAS commands;
   - non-mutating validation commands;
   - the exact caveat that native auth and writes still require owner-side
     records plus physical-device verification.

5. **EAS versioning readiness.**
   Resolve the deferred `appVersionSource` decision. The planned default is to
   change `mobile/eas.json` from `"local"` to `"remote"` so EAS, not a dynamic
   TypeScript config file, owns build-number auto-increment when store builds
   start. If implementation discovers a current EAS constraint that makes the
   flip wrong, document the reason and the exact 6e-10 prerequisite instead of
   leaving the decision implicit.

6. **Config validation.**
   If assets/config are changed, validate Expo config without running EAS build
   or submit. At minimum:
   - `pnpm --filter mobile exec expo config --type public`
   - `pnpm --filter mobile exec expo config --type prebuild`

## Owner-Gated Checklist

The owner must complete or confirm these outside the repo before 6e-9/6e-10 can
claim functional native auth or store-channel installation:

- Keep final native identity unchanged when creating external records.
- Confirm owner access to the already-linked Expo/EAS org/project before any
  build, but do not re-create or replace the committed owner/project id.
- Configure EAS credentials through EAS or the platform consoles. Keep all
  credential files outside git.
- Create Apple App ID with the final bundle id and required capabilities.
- Create App Store Connect app record for `FountainRank`.
- Decide internal-only TestFlight vs external beta testing for the first build.
- Create Google Play app record with final package name and Play App Signing.
- Decide Android internal testing vs closed testing for the first wider group.
- Capture Play App Signing SHA-1 for the future Android OAuth client.
- Confirm Logto Native app redirect URI exactly:
  `com.redducklabs.fountainrank://callback`.
- Confirm when `EXPO_PUBLIC_LOGTO_NATIVE_AUTH_CONFIRMED=true` may be set.
- Review and approve store descriptions, tester instructions, category,
  privacy/data-safety answers, content rating, support/contact details, and
  privacy/terms URLs.
- Review the committed store screenshot mockups in App Store Connect and Google
  Play. Capture screenshots from real native builds after 6e-10 device smoke
  testing if the native UI diverges, the store reviewer requires captures, or
  owner policy requires literal captures.

## Task List

### Task 1 - Plan Review

- Write this plan.
- Self-review for owner/agent boundary mistakes, invented store answers,
  missing security constraints, and stale baseline facts.
- Run the required plan review loop. Do not start implementation until the plan
  review verdict is approved.

### Task 2 - Store And Account Runbook Updates

- Update `docs/setup/04-apple-and-app-stores.md` so it covers current 6e-8
  store-readiness work, not only earlier enrollment/auth setup.
- Add Expo/EAS account and credential guidance either in `docs/setup/04-apple-and-app-stores.md`
  or a narrowly named companion setup doc, then link it from `docs/setup/README.md`.
- Keep all outputs split into:
  - non-secret values the owner can hand back for repo config/docs;
  - secrets/credential material the owner must store only in EAS, Apple, Google,
    Logto, GitHub secrets, or a password manager.
- Document that actual EAS build/submit belongs to 6e-10 unless the user
  explicitly asks and prerequisites are satisfied.
- Record that the spec's older "no Expo/EAS account yet" statement is
  superseded by the linked EAS project currently in `mobile/app.config.ts`.

### Task 3 - Store Metadata Worksheet

- Add a durable worksheet under `docs/setup/` or `docs/runbooks/`.
- Include factual draft listing copy for FountainRank's beta scope:
  map-based drinking fountain discovery, fountain details, sign-in,
  contributions, and add-fountain capture.
- Include tester instructions that are precise about expected beta workflows and
  known owner-gated prerequisites.
- Include a factual data-flow inventory from the shipped beta: foreground
  location use, Logto-mediated account/profile data, submitted ratings/status/
  attribute observations, notes/comments, add-fountain coordinates/placement
  notes, diagnostics/build info, and store crash dashboards. This inventory
  must be verified against the shipped code, distinguishing data that leaves the
  device from locally displayed diagnostics or store-managed crash dashboards.
  It feeds the owner-confirmed privacy nutrition and Play data-safety answers;
  it is not itself the final legal answer.
- Mark privacy nutrition, Play data safety, content rating, legal URLs, support
  contact, and screenshots as owner-confirmed-before-submission.
- Do not include any actual user emails, tester lists, account ids, secrets, or
  console-only private values.

### Task 4 - Asset And Expo Config Decision

- Inspect `mobile/assets/` and `mobile/app.config.ts`.
- If approved icon/splash assets are available, add them under `mobile/assets/`
  and wire Expo config with valid top-level `icon`, Android
  `android.adaptiveIcon`, and the SDK-56 `expo-splash-screen` config plugin.
  Adding `expo-splash-screen` means adding the SDK-correct dependency, updating
  the lockfile, and doing the clean reinstall before prebuild config validation.
- If approved assets are not available, do not wire placeholders. Instead,
  document the required files and validation path in the store metadata
  worksheet and mobile README.
- In either path, add screenshots only when they come from an actual native build
  or when the owner explicitly approves generated mockups as an interim
  store-console deliverable. Generated mockups must be documented as mockups and
  verified against current store dimensions.

### Task 5 - EAS Versioning Readiness

- Change `mobile/eas.json` `cli.appVersionSource` from `"local"` to `"remote"`
  unless current EAS validation proves that should be deferred to 6e-10.
- Keep production `autoIncrement: true` so store build numbers are monotonic
  once EAS builds start.
- Document in `mobile/README.md` that build-number increments are EAS-managed
  after project linkage and that no build happens in this slice.

### Task 6 - Mobile README Release-Readiness Update

- Update `mobile/README.md` so the Store-testing builds section reflects the
  current state:
  - EAS profiles and public project linkage exist;
  - Expo org/project and bundle id are already owner-confirmed;
  - builds/submits are blocked on owner credentials and account access;
  - Android production produces an `.aab`;
  - Android submit targets the internal track by config;
  - no iOS submit profile is committed yet; App Store Connect credentials and
    app ids remain outside git;
  - native auth and writes are not proven until physical-device verification.
- Include only non-mutating local validation commands.

### Task 7 - Verification

Run the checks appropriate to the files changed:

- Always run:
  - `pnpm exec prettier --check <changed-doc-files>`
  - `pnpm run format:check`
  - `git diff --check`
- If `mobile/app.config.ts`, `mobile/eas.json`, or mobile assets change:
  - First recover the pnpm/Expo install before the prebuild config check:
    `rm -rf node_modules web/node_modules mobile/node_modules packages/*/node_modules && CI=true pnpm install`
  - `pnpm --filter mobile exec expo config --type public`
  - `pnpm --filter mobile exec expo config --type prebuild`
  - `./run.ps1 check -Mobile`
  - `pnpm --filter mobile run lint`
  - `pnpm --filter mobile run typecheck`
  - `pnpm --filter mobile run test`
  - from `mobile/`: `CI=true pnpm dlx expo-doctor`
  - `pnpm run format:check`
  - `git diff --check`

Do not run EAS build or EAS submit as part of this slice unless the user gives
an explicit new instruction after the owner prerequisites are satisfied.

## Acceptance Criteria

- Plan review is approved before implementation begins.
- Store/account runbooks clearly separate repo-local work from owner-gated
  external account and credential work.
- Store metadata worksheet exists and has no invented legal/privacy/data-safety
  answers.
- Mobile README accurately describes the current EAS/release-readiness state and
  does not claim device, auth, write, or store-channel verification that has not
  happened.
- The `appVersionSource` + `autoIncrement` decision is resolved explicitly,
  preferably by moving to EAS remote versioning now that the project is linked.
- Expo config does not reference missing asset files.
- If assets are added, Expo config validation passes.
- Relevant local checks are run and their actual results are reported.
- No secrets or generated credential artifacts are committed.

## Out Of Scope

- EAS Build or EAS Submit.
- Apple App Store Connect or Google Play Console changes performed by the agent.
- Logto Native app mutation.
- Google or Apple OAuth client creation.
- Native auth callback verification.
- Authenticated mobile write verification.
- TestFlight / Play store-channel installation checks.
- Public App Store / Play Store production release.
