# FountainRank Mobile

Expo SDK 56 / React Native app. **Expo Router** (file-based `app/` tree) for
navigation, **TanStack Query** over `@fountainrank/api-client` for server state.
Release builds target the deployed production services
(`https://api.fountainrank.com`, `https://auth.fountainrank.com`).

## App structure

```
app/
  _layout.tsx          providers (SafeArea + QueryClient + ApiProvider) + config guard
  (tabs)/              bottom tabs: Map · Add · Account
  fountains/[id].tsx   fountain detail (stack-pushed)
  diagnostics.tsx      backend reachability + version/build
components/            ScreenContainer + loading/empty/error/offline states
lib/                   pure, unit-tested helpers (config, api, view-state, build-info)
providers/             ApiProvider (shared API client from validated config)
theme.ts               design tokens
```

Most screens are scaffolds for later slices (map → 6e-3, detail → 6e-4, auth →
6e-5, add → 6e-7). The app runs in **Expo Go** through 6e-2; the MapLibre native
map in 6e-3 ends Expo Go support (dev-client / EAS build required from there).

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

## Store-testing builds (EAS)

`eas.json` defines `development` / `preview` / `production` build profiles and a
credential-free `production` submit profile (Android `internal` track). Producing
and submitting store binaries requires an Expo/EAS account and `eas init`
(owner-gated — see the umbrella spec
`docs/specs/2026-06-23-mobile-store-testing-distribution-design.md`, slice 6e-8).
No build/submit runs as part of this slice.
