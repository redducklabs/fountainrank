# 07 — Mobile store readiness

This guide covers the owner-controlled work for the first FountainRank mobile
beta in TestFlight and Google Play testing. The repo can prepare configuration,
docs, and non-secret values; the owner controls store accounts, credentials,
policy answers, screenshots, builds, submissions, tester lists, and physical
device verification.

**Unblocks:** mobile slices 6e-8 through 6e-10.

## Current confirmed values

| Item               | Value                                                           | Status                                       |
| ------------------ | --------------------------------------------------------------- | -------------------------------------------- |
| App name           | `FountainRank`                                                  | confirmed in `mobile/app.config.ts`          |
| iOS bundle id      | `com.redducklabs.fountainrank`                                  | owner-confirmed                              |
| Android package    | `com.redducklabs.fountainrank`                                  | owner-confirmed                              |
| Native scheme      | `com.redducklabs.fountainrank`                                  | owner-confirmed                              |
| Logto redirect URI | `com.redducklabs.fountainrank://callback`                       | pending exact callback confirmation in Logto |
| Expo org           | `red-duck-labs`                                                 | linked                                       |
| EAS project id     | `820564bf-5f29-44c7-8ec7-edde67b77360`                          | linked via `eas init`                        |
| EAS project URL    | `https://expo.dev/accounts/red-duck-labs/projects/fountainrank` | public, non-secret                           |
| API URL            | `https://api.fountainrank.com`                                  | public config                                |
| Auth URL           | `https://auth.fountainrank.com`                                 | public config                                |

Do not change the bundle id, package name, scheme, or EAS project identity after
external Apple, Google Play, Logto, or OAuth records exist.

## EAS account and credentials

The Expo organization and project are already linked in `mobile/app.config.ts`.
What remains is credential and build access:

1. Confirm the owner account can access
   `https://expo.dev/accounts/red-duck-labs/projects/fountainrank`.
2. Keep EAS access tokens outside the repo. If CI later needs an EAS token, store
   it as a GitHub Environment secret, not in a file.
3. Let EAS manage Apple and Android build credentials unless the owner chooses a
   manual credential path. Any manual files remain outside git.
4. Do not commit provisioning profiles, certificates, keystores, API keys,
   service-account JSON, or credentials downloaded from EAS, Apple, or Google.

The repo now uses EAS remote app versioning:

- `mobile/eas.json` `cli.appVersionSource` = `remote`
- production `autoIncrement` = `true`

Expo documents remote version source as the recommended EAS behavior, with EAS
servers managing `ios.buildNumber` and `android.versionCode` when
`appVersionSource` is `remote` and production `autoIncrement` is enabled:
<https://docs.expo.dev/build-reference/app-versions/>.

## Apple App Store Connect / TestFlight

Use `docs/setup/04-apple-and-app-stores.md` for Apple Developer Program and
Sign in with Apple setup. For store testing:

1. Create or let EAS create the App ID for `com.redducklabs.fountainrank`.
2. Ensure Sign in with Apple capability is enabled if Apple social sign-in is
   offered in the mobile app.
3. Create the App Store Connect app record for `FountainRank` if EAS did not
   create it during the first iOS build flow.
4. Keep App Store Connect API keys and any Apple private keys outside the repo.
5. Add a TestFlight group and tester list in App Store Connect after a build is
   uploaded.
6. Capture iOS screenshots from a real native build or an owner-approved
   App Store Connect-compliant mockup set.

Apple references:

- TestFlight overview:
  <https://developer.apple.com/help/app-store-connect/test-a-beta-version/testflight-overview/>
- App privacy:
  <https://developer.apple.com/help/app-store-connect/reference/app-information/app-privacy/>
- Platform version information:
  <https://developer.apple.com/help/app-store-connect/reference/app-information/platform-version-information/>
- Screenshot specifications:
  <https://developer.apple.com/help/app-store-connect/reference/app-information/screenshot-specifications/>
- Age ratings:
  <https://developer.apple.com/help/app-store-connect/reference/app-information/age-ratings-values-and-definitions/>

## Google Play testing

Use `docs/setup/04-apple-and-app-stores.md` for Play Console enrollment. For
store testing:

1. Create the Google Play app record with package name
   `com.redducklabs.fountainrank`.
2. Enable Play App Signing.
3. Capture the Play App Signing SHA-1 from Play Console App integrity. This feeds
   the future Android OAuth client in `docs/setup/03-google-cloud.md`.
4. Keep the Google Play service-account JSON for EAS Submit outside the repo.
5. Use the configured Android production submit track `internal` unless the owner
   chooses closed testing for the first broader group.
6. Add tester email lists and opt-in links in Play Console.
7. Capture Android screenshots from a real native build or an owner-approved
   Play-compliant screenshot set.

Google references:

- Create and set up an app:
  <https://support.google.com/googleplay/android-developer/answer/9859152>
- Prepare your app for review:
  <https://support.google.com/googleplay/android-developer/answer/9859455>
- Data safety:
  <https://support.google.com/googleplay/android-developer/answer/10787469>
- Testing tracks:
  <https://support.google.com/googleplay/android-developer/answer/9845334>
- Publish status:
  <https://support.google.com/googleplay/android-developer/answer/9859751>

## Store metadata worksheet

These are working inputs for owner review, not final legal or policy answers.
The owner must review the copy, category, contact information, privacy answers,
content rating, screenshots, and tester instructions before any store
submission.

| Field                          | Draft / input                                                                                                                                                                                                                                                                                       | Owner action                                         |
| ------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------- |
| App name                       | FountainRank                                                                                                                                                                                                                                                                                        | Confirm exact store display name.                    |
| Subtitle / short description   | Find and improve drinking fountains nearby.                                                                                                                                                                                                                                                         | Review for store fit.                                |
| Full description               | FountainRank helps people find drinking fountains, inspect details, sign in, contribute field reports, and add missing fountains from a native map. The beta focuses on production map discovery, fountain detail, native Logto sign-in, existing-fountain contributions, and add-fountain capture. | Review and adjust before submission.                 |
| Category                       | Navigation, Travel, Lifestyle, or Utilities are plausible; no category is selected by the repo.                                                                                                                                                                                                     | Choose in each store console.                        |
| Support URL                    | `https://fountainrank.com` unless the owner provides a dedicated support page.                                                                                                                                                                                                                      | Confirm.                                             |
| Privacy URL                    | `https://fountainrank.com/privacy` after deployed page verification.                                                                                                                                                                                                                                | Confirm the page is deployed and current.            |
| Terms URL                      | `https://fountainrank.com/terms` if requested by the store form.                                                                                                                                                                                                                                    | Confirm the page is deployed and current.            |
| Keywords                       | drinking fountain, water fountain, refill, hydration, map, public water                                                                                                                                                                                                                             | Review against store rules and byte limits.          |
| TestFlight tester instructions | Install the beta, allow or deny location permission, browse the map, open a fountain detail, sign in, submit one existing-fountain contribution, add a fountain or confirm the duplicate path, and report any crash or blocked state with app version/build.                                        | Review after store build exists.                     |
| Play tester instructions       | Same as TestFlight, installed through the Play testing opt-in link.                                                                                                                                                                                                                                 | Review after store build exists.                     |
| Screenshots                    | Required from real native builds or approved mockups. Suggested flows: map with pins, fountain detail, contribution panel, add-fountain placement, add-fountain details/result, account/diagnostics.                                                                                                | Capture after device build.                          |
| App icon / splash              | No finalized files are currently committed.                                                                                                                                                                                                                                                         | Provide or approve assets before wiring Expo config. |

## Factual data-flow inventory

Use this inventory to answer Apple privacy and Google Play data-safety forms.
It is not the final answer; each row must be checked against the shipped code and
any SDKs in the actual store build.

| Data / behavior        | Current beta behavior                                                                                                                         | Store-answer note                                                                                                                |
| ---------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| Foreground location    | Requested for nearby map centering and add-fountain placement. The beta declares foreground-only location permissions.                        | Disclose approximate/precise location as applicable. No background location is in scope.                                         |
| Account/profile        | Logto handles sign-in. The mobile app requests backend access tokens and can sync/read the authenticated profile through the API.             | Disclose account/profile data according to final Logto and backend behavior. Do not claim native auth works until device-tested. |
| User contributions     | Signed-in users can submit ratings, operational status, attribute observations, notes/comments, and add-fountain coordinates/placement notes. | Disclose user-generated content/contributions and purposes.                                                                      |
| Diagnostics/build info | The diagnostics screen displays app version/build and checks backend reachability. Verify what leaves the device in the final build.          | Do not label locally displayed build info as collected unless transmitted.                                                       |
| Crash data             | No third-party crash SDK is installed by default. First beta relies on App Store Connect and Google Play Console crash dashboards.            | Store-managed crash reporting still affects privacy answers; owner must confirm platform disclosures.                            |
| Photos                 | Deferred unless a later photo slice ships before the beta.                                                                                    | Do not disclose photo collection unless implemented.                                                                             |
| Advertising/tracking   | No ad SDK or tracking SDK is installed for the beta.                                                                                          | Re-check dependencies before submission.                                                                                         |

Google Play specifically says developers should review app collection/sharing,
declared permissions, APIs, and third-party code when completing Data safety:
<https://support.google.com/googleplay/android-developer/answer/10787469>.

## Asset checklist

Do not wire missing files in `mobile/app.config.ts`. Expo config validation fails
when referenced asset paths do not exist.

Planned paths once assets are approved:

| Purpose                          | Planned path                                           | Notes                                                            |
| -------------------------------- | ------------------------------------------------------ | ---------------------------------------------------------------- |
| App icon                         | `mobile/assets/icon.png`                               | 1024x1024 PNG. Expo uses this for generated platform icon sizes. |
| Android adaptive icon foreground | `mobile/assets/adaptive-icon.png`                      | Foreground image for `android.adaptiveIcon.foregroundImage`.     |
| Splash image                     | `mobile/assets/splash-icon.png`                        | Configure through the SDK-56 `expo-splash-screen` config plugin. |
| Store screenshots                | `mobile/assets/store/` or external console upload only | Must come from a real native build or owner-approved mockups.    |

Expo references:

- App icon and splash screen:
  <https://docs.expo.dev/develop/user-interface/splash-screen-and-app-icon/>
- App config reference:
  <https://docs.expo.dev/versions/latest/config/app/>

If splash assets are wired in this repo, add `expo-splash-screen` at the
SDK-correct version, update `pnpm-lock.yaml`, and perform the clean reinstall
before prebuild config validation:

```bash
rm -rf node_modules web/node_modules mobile/node_modules packages/*/node_modules
CI=true pnpm install
pnpm --filter mobile exec expo config --type prebuild
```

## Non-mutating local validation

These checks do not create store records or run builds:

```bash
pnpm exec prettier --check <changed-doc-files>
pnpm run format:check
pnpm --filter mobile exec expo config --type public
pnpm --filter mobile exec expo config --type prebuild
./run.ps1 check -Mobile
git diff --check
```

Run the clean reinstall shown above before `expo config --type prebuild` if the
Expo/pnpm install has been changed incrementally.

In WSL shells without PowerShell, `./run.ps1 check -Mobile` may fail before it
starts. Run the mobile mirror directly instead:

```bash
pnpm --filter mobile run lint
pnpm --filter mobile run typecheck
pnpm --filter mobile run test
CI=true pnpm dlx expo-doctor
```

## What not to do from the repo

- Do not run `eas build` or `eas submit` unless the owner explicitly asks after
  credentials and external records are ready.
- Do not commit downloaded credentials, generated native folders, store
  screenshots containing private data, tester lists, or console-only private
  values.
- Do not set `EXPO_PUBLIC_LOGTO_NATIVE_AUTH_CONFIRMED=true` until Logto has the
  exact native callback URI and the owner is ready for a real device auth test.
