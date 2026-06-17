# @fountainrank/api-client

Typed TypeScript client for the FountainRank backend, shared by `web/` and `mobile/`.

- Types are generated from the backend's OpenAPI schema with
  [`openapi-typescript`](https://openapi-ts.dev/); requests go through the tiny
  [`openapi-fetch`](https://openapi-ts.dev/openapi-fetch/) client.
- The schema is generated **live from the backend** — `generate` runs
  `uv run python -m app.export_openapi` in `../../backend`, so the backend deps
  must be synced (`cd backend && uv sync`). Generation is DB-free.

## Regenerate after the backend API changes

```bash
pnpm --filter @fountainrank/api-client run generate
```

This writes `openapi.json` and `src/schema.d.ts` (both gitignored — regenerated
locally and in CI).

## Usage

```ts
import { makeClient } from "@fountainrank/api-client";

const api = makeClient("http://localhost:8000");
const { data } = await api.GET("/healthz"); // data: { status: string }
```
