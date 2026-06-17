# FountainRank Mobile

Expo SDK 56 / React Native. Talks to the backend through
`@fountainrank/api-client`.

## Common commands (run from the repo root)

```bash
pnpm --filter @fountainrank/api-client run generate  # refresh API types from the backend
pnpm --filter mobile run start        # Expo dev server
pnpm --filter mobile run lint
pnpm --filter mobile run typecheck
```

`pnpm --filter mobile run start` runs Metro. Running on a device/emulator and
wiring the backend base URL for native networking is handled in a later phase;
0c verifies type-check, lint, and `expo-doctor` only.
