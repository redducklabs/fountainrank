# FountainRank Mobile

Expo SDK 56 / React Native app. **Expo Router** (file-based `app/` tree) for
navigation, **TanStack Query** over `@fountainrank/api-client` for server state.
Release builds target the deployed production services
(`https://api.fountainrank.com`, `https://auth.fountainrank.com`).

## App structure

```
app/
  _layout.tsx          providers (SafeArea + QueryClient + ApiProvider) + config guard
  (tabs)/index.tsx     Map tab — MapLibre map + bbox pins + filters (slice 6e-3)
  (tabs)/              bottom tabs: Map · Add · Account
  fountains/[id].tsx   fountain detail (stack-pushed)
  diagnostics.tsx      backend reachability + version/build
components/            ScreenContainer + loading/empty/error/offline states
components/map/        FountainMap (MapLibre) + MapFilters
hooks/                 useForegroundLocation (non-blocking when-in-use location)
lib/                   pure, unit-tested helpers (config, api, view-state, build-info)
lib/map/               pure, unit-tested map helpers (constants, bounds, pins, format, filters)
providers/             ApiProvider (shared API client from validated config)
theme.ts               design tokens
```

The remaining screens are scaffolds for later slices (detail → 6e-4, auth →
6e-5, add → 6e-7). **Slice 6e-3 ends Expo Go support:** the MapLibre native map
requires a dev-client / EAS build (see _Map_ below).

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
`https://` (local cleartext is not supported in this slice). Sign-in stays
disabled (public-read mode) until a Logto Native app id is configured
(`isAuthConfigured`), which arrives with the owner-gated auth records (6e-9).

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

## Store-testing builds (EAS)

`eas.json` defines `development` / `preview` / `production` build profiles and a
credential-free `production` submit profile (Android `internal` track). Producing
and submitting store binaries requires an Expo/EAS account and `eas init`
(owner-gated — see the umbrella spec
`docs/specs/2026-06-23-mobile-store-testing-distribution-design.md`, slice 6e-8).
No build/submit runs as part of this slice.
