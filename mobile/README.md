# FountainRank Mobile

Expo SDK 56 / React Native app. **Expo Router** (file-based `app/` tree) for
navigation, **TanStack Query** over `@fountainrank/api-client` for server state.
Release builds target the deployed production services
(`https://api.fountainrank.com`, `https://auth.fountainrank.com`).

## App structure

```
app/
  _layout.tsx          providers (SafeArea + QueryClient + AuthProvider + ApiProvider) + config guard
  (tabs)/index.tsx     Map tab — MapLibre map + bbox pins + filters (slice 6e-3)
  (tabs)/              bottom tabs: Map · Rankings · Add · Profile
  fountains/[id].tsx   fountain detail (stack-pushed)
  diagnostics.tsx      backend reachability + version/build
components/            ScreenContainer + loading/empty/error/offline states
components/map/        FountainMap (MapLibre) + MapFilters
components/add-fountain/ Add-fountain placement + details form (slice 6e-7)
hooks/                 useForegroundLocation (non-blocking when-in-use location)
lib/                   pure, unit-tested helpers (config, api, auth, view-state, build-info)
lib/map/               pure, unit-tested map helpers (constants, bounds, pins, format, filters)
providers/             AuthProvider + ApiProvider (shared auth-aware API client)
theme.ts               design tokens
```

**Slice 6e-3 ends Expo Go support:** the MapLibre native map requires a
dev-client / EAS build (see _Map_ below).

## Common commands (run from the repo root)

```bash
pnpm --filter @fountainrank/api-client run generate  # refresh API types from the backend
pnpm --filter mobile run start         # Expo dev server (Metro)
pnpm --filter mobile run lint
pnpm --filter mobile run typecheck
pnpm --filter mobile run test          # Vitest (pure helpers)
```

Local CI mirror for mobile: `./run.ps1 check -Mobile` (lint, typecheck, vitest, `expo-doctor`).

## Runtime configuration

Non-secret client config lives in `app.config.ts` under `extra` and is validated
at startup by `lib/config.ts`. Defaults point at production; override for an
alternate HTTPS endpoint with `EXPO_PUBLIC_API_BASE_URL` /
`EXPO_PUBLIC_LOGTO_ENDPOINT` / `EXPO_PUBLIC_LOGTO_AUDIENCE`. URLs must be
`https://` (local cleartext is not supported in this slice).

Native auth uses the public Logto Native app id from `EXPO_PUBLIC_LOGTO_APP_ID`,
but a lone app-id env var is deliberately inert. `app.config.ts` only surfaces
`extra.logtoAppId` when `EXPO_PUBLIC_LOGTO_NATIVE_AUTH_CONFIRMED=true` is also
set, and that flag must only be set after `docs/setup/06-logto.md` records the
owner-confirmed Native app type, public app id variable name, and exact
`com.redducklabs.fountainrank://callback` redirect URI. Until then
`isAuthConfigured` is false and the Profile tab stays in public-read mode.

The map basemap style URL is `EXPO_PUBLIC_BASEMAP_STYLE_URL` (public, non-secret;
defaults to the same DigitalOcean-Spaces Protomaps "light" style the web client
uses). When absent/blank, `isMapConfigured` is false and the Map tab shows an
honest "map unavailable" state instead of crashing.

## Map (slice 6e-3)

The Map tab wires a native **MapLibre** map (`@maplibre/maplibre-react-native`)
with the Protomaps basemap, viewport-driven fountain pins from the production
`GET /api/v1/fountains/bbox` API (working / broken / gold-rated icons + a rating
pill at zoom ≥ 13), clustering, basic filters, foreground location, and pin →
detail navigation.

- **No Expo Go.** `@maplibre/maplibre-react-native` is a native module; its Expo
  config plugin forces **CNG / prebuild** (`npx expo prebuild` generates
  `ios/` + `android/`, which are **git-ignored**). To run the map, build a
  **dev client** (`eas build --profile development`) or a full EAS build and run
  Metro against it. **CI does not render the map** — it only type-checks, lints,
  runs `expo-doctor`, and runs the pure-helper unit tests. The map render is
  verified on a device (owner-gated; no Mac → EAS).
- **Native SDK targets.** MapLibre RN 11.3.4 inherits the host project's Android
  SDK levels and iOS `min_ios_version_supported`; the Expo SDK 56 / RN 0.85
  defaults govern (no `expo-build-properties` override is needed), and
  `expo-doctor` confirms compatibility.
- **🔑 Clean reinstall before any `expo prebuild` / `eas` command.** Incremental
  Expo installs break config-plugin resolution under pnpm; from the repo root:
  `rm -rf node_modules web/node_modules mobile/node_modules packages/*/node_modules && CI=true pnpm install`,
  then verify `pnpm --filter mobile exec expo config --type prebuild` (exit 0).

## Contributions (slice 6e-6)

The fountain detail screen includes authenticated contribution forms for rating
an existing fountain, reporting operational status, recording attribute/access
observations, and creating a note. Write calls go through the shared
`createApiClient` facade so protected POSTs receive a Logto Bearer token when
auth is configured, and the mobile app still cannot emit `X-Dev-*` headers.

Attribute observations use the public `/api/v1/attribute-types` catalog for
labels, boolean-vs-enum controls, and allowed values. The existing
`detail.attributes` payload is read-only consensus data and is not used as the
form source. Note creation is create-only; the API has no mobile edit/delete
surface.

Until the owner-gated Logto Native app/redirect setup and physical-device
round-trip are complete, contribution code is locally verified only (type-check,
lint, helper tests, and Expo Doctor). Do not claim signed-in mobile
contributions work on device until a real native auth callback and at least one
authenticated write have actually been observed.

## Add fountain (slice 6e-7)

The Add tab is now an authenticated create flow for `POST /api/v1/fountains`.
It uses the same auth-aware mobile API facade as existing-fountain
contributions, so protected writes receive a Logto Bearer token only when native
auth is configured and authenticated, and the mobile app still cannot emit
`X-Dev-*` headers.

The flow:

- gates all writable controls behind `auth.status === "authenticated"`;
- uses foreground location accuracy when available, otherwise a zoomed-in map
  viewport fallback;
- supports current location, map tap, place-at-center, and nudge placement;
- collects working status, optional rating dimensions from `/api/v1/rating-types`,
  optional attribute observations from `/api/v1/attribute-types`, and one optional
  comment field;
- handles duplicate-proximity `409` by showing a View existing fountain action
  only when the duplicate body contains a valid fountain UUID;
- invalidates map bbox queries after a successful create.

Until the owner-gated Logto Native app/redirect setup and physical-device
round-trip are complete, add-fountain code is locally verified only
(type-check, lint, helper tests, and Expo Doctor). Do not claim signed-in mobile
add-fountain writes work on device until native auth and an authenticated add
have actually been observed.

## Store-testing builds (EAS)

`eas.json` defines `development` / `preview` / `production` build profiles and a
credential-free `production` submit profile for Android's `internal` track. The
Android submit profile uses `releaseStatus: completed`, so a store-release run
auto-publishes the internal-testing release on upload — no Play Console step. The
Expo org/project are linked in `app.config.ts`
(`red-duck-labs/fountainrank`, project id
`820564bf-5f29-44c7-8ec7-edde67b77360`), and the native identity is
owner-confirmed as `com.redducklabs.fountainrank`.

Build numbers are EAS-managed for store builds: `cli.appVersionSource` is
`remote`, and the production profile keeps `autoIncrement: true`. Android
production builds produce an `.aab`; preview Android builds produce an `.apk`.
The local `ios.buildNumber` and `android.versionCode` values in `app.config.ts`
seed the first remote value; after that, EAS owns store build-number increments.
The iOS `production` submit profile carries only non-secret identifiers — the App
Store Connect app id (`ascAppId`) and the Apple Team id (`appleTeamId`). The App
Store Connect API key, Play service-account JSON, signing material, EAS tokens, and
tester lists stay outside the repo (EAS credentials service / GitHub secrets).

The GitHub `mobile-store-release.yml` workflow generates store release notes from
the PRs included since the previous `v*.*.*` tag and prints them in the run summary
for both platforms. Neither store's release-notes text is set automatically by EAS:
the TestFlight changelog requires the Enterprise plan (otherwise the submit fails with
"Changelog submission is currently available for Enterprise plan only"), and the EAS
Android submit options here don't carry release-note text. iOS is submitted without it
(paste the notes into TestFlight's "What to Test" if wanted); Android auto-publishes to
internal testing (`releaseStatus: completed`) without notes — add them in Play Console
afterward only if desired. The printed notes are there for that optional paste.

Before any `expo config --type prebuild`, `expo prebuild`, or EAS command after
incremental dependency changes, recover the pnpm/Expo install from the repo
root:

```bash
rm -rf node_modules web/node_modules mobile/node_modules packages/*/node_modules
CI=true pnpm install
```

Non-mutating local validation:

```bash
pnpm --filter mobile exec expo config --type public
pnpm --filter mobile exec expo config --type prebuild
./run.ps1 check -Mobile
```

If PowerShell is unavailable in WSL, run the mobile mirror directly:

```bash
pnpm --filter mobile run lint
pnpm --filter mobile run typecheck
pnpm --filter mobile run test
CI=true pnpm dlx expo-doctor
```

Producing and submitting store binaries remains owner-gated. Native auth and
authenticated writes are not proven until the Logto callback, store/OAuth
records, a release-equivalent native build, and physical-device verification are
complete. See `docs/setup/07-mobile-store-readiness.md` for the 6e-8 owner
worksheet and store metadata checklist.
