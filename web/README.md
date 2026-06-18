# FountainRank Web

Next.js (App Router) + React 19 + Tailwind CSS v4. Talks to the backend through
`@fountainrank/api-client`.

## Common commands (run from the repo root)

```bash
pnpm --filter @fountainrank/api-client run generate  # refresh API types from the backend
pnpm --filter web run dev        # http://localhost:3020
pnpm --filter web run build
pnpm --filter web run lint
pnpm --filter web run typecheck
pnpm --filter web run test
```

The backend base URL defaults to `http://localhost:3021`; override with the
`NEXT_PUBLIC_API_BASE_URL` environment variable.
