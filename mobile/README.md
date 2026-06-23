# FountainRank Mobile

Expo SDK 56 / React Native. Talks to the backend through
`@fountainrank/api-client`. Release builds target the deployed production
services (`https://api.fountainrank.com`, `https://auth.fountainrank.com`).

## Common commands (run from the repo root)

```bash
pnpm --filter @fountainrank/api-client run generate  # refresh API types from the backend
pnpm --filter mobile run start         # Expo dev server (Metro)
pnpm --filter mobile run lint
pnpm --filter mobile run typecheck
pnpm --filter mobile run test          # Vitest (pure helpers)
```

Local CI mirror for mobile: `./run.ps1 check -Mobile` (lint + typecheck + vitest + `expo-doctor`).

## Runtime configuration

Non-secret client config lives in `app.config.ts` under `extra` and is validated
at startup by `lib/config.ts`. Defaults point at production; override for an
alternate HTTPS endpoint with `EXPO_PUBLIC_API_BASE_URL` /
`EXPO_PUBLIC_LOGTO_ENDPOINT` / `EXPO_PUBLIC_LOGTO_AUDIENCE`. URLs must be
`https://` (local cleartext is not supported in this slice).

## Store-testing builds (EAS)

`eas.json` defines `development` / `preview` / `production` build profiles and a
credential-free `production` submit profile (Android `internal` track). Producing
and submitting store binaries requires an Expo/EAS account and `eas init`
(owner-gated — see the umbrella spec
`docs/specs/2026-06-23-mobile-store-testing-distribution-design.md`, slice 6e-8).
No build/submit runs as part of this slice.
