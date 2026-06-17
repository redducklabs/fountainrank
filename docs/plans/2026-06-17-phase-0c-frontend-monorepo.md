# Phase 0c — Frontend Monorepo Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stand up the pnpm + Turborepo frontend monorepo — a Next.js `web/` skeleton and an Expo `mobile/` skeleton that each call the backend through a shared `packages/api-client` generated from the backend's OpenAPI schema — wired with ESLint/Prettier, pinned Node/JS versions, and pre-commit hooks.

**Architecture:** A pnpm workspace (`web`, `mobile`, `packages/*`) orchestrated by Turborepo. The backend's `/healthz` and `/readyz` endpoints are first given typed Pydantic response models so the FastAPI OpenAPI 3.1 schema is clean. `packages/api-client` exports the schema **live from the backend** (`uv run … app.export_openapi`) → `openapi-typescript` types → a tiny `openapi-fetch` typed client (`makeClient`). `web/` (Next.js App Router + Tailwind v4) and `mobile/` (Expo SDK 56) both import `@fountainrank/api-client` and render the backend `/healthz` status. Generated artifacts are gitignored; downstream typecheck/build depend on `generate` via Turborepo.

**Tech Stack:** Node 22 · pnpm · Turborepo · TypeScript · Next.js (App Router, React 19, Tailwind v4) · Expo SDK 56 / React Native · `openapi-typescript` + `openapi-fetch` · ESLint 9 (flat config) · Prettier · vitest. Backend touch-up: FastAPI + Pydantic v2.

## Global Constraints

- Repo `redducklabs/fountainrank` (public). **Phase 0 → commit directly to `main`** (no CI/PR gate yet; CI lands in 0f). Conventional Commits. **No AI attribution. No time estimates.**
- **No secrets, no `.env` files** created or modified. The root `.env` is gitignored and out of scope — never read, write, or commit it.
- Windows host: use **backslash paths** with Read/Write/Edit tools; the Bash tool is Git Bash (forward-slash, `/d/repos/fountainrank/...`). pnpm scripts must work in both `cmd.exe` (default Windows pnpm script shell) and POSIX `sh` — avoid shell-specific redirection; the `generate:schema` script uses `cd … && <cmd> <outfile>` (portable) and the Python writes the file itself.
- **Pinned versions (verified 2026-06-17 — copy exactly). Pin 0.x packages exactly; pin all others exactly too.**
  - **Runtime/monorepo:** Node **22.22.3** (`.nvmrc`; `engines.node` `>=22.0.0 <23.0.0`). Do **not** use Node 24/26. pnpm **11.7.0** (`packageManager`). Turborepo (`turbo`) **2.9.18**. TypeScript **6.0.3** everywhere **except** `packages/api-client`, which pins **5.9.3** (see Task 3).
  - **Web:** next **16.2.9** · react **19.2.7** · react-dom **19.2.7** · @types/react **19.2.17** · @types/react-dom **19.2.3** · @types/node **22.19.21** (hold at 22.x to match the Node runtime — do **not** use 25.x) · tailwindcss **4.3.1** · @tailwindcss/postcss **4.3.1** · eslint **9.39.4** (hold at 9 — eslint-config-next's transitive plugins cap at ESLint 9; do **not** use ESLint 10) · eslint-config-next **16.2.9** · vitest **4.1.9** · vite **8.0.16**.
  - **Mobile:** expo **56.0.12** (Expo SDK 56) · react **19.2.3** (Expo-pinned — do **not** bump to web's 19.2.7) · react-native **0.85.3** (Expo-pinned) · @types/react **19.2.17** · eslint **9.39.4** · eslint-config-expo **56.0.4** · typescript **6.0.3**.
  - **api-client:** openapi-fetch **0.17.0** (runtime dep) · openapi-typescript **7.13.0** (dev) · typescript **5.9.3** (dev, package-local) · typescript-eslint **8.61.1** (dev) · eslint **9.39.4** (dev) · @types/node **22.19.21** (dev) · vitest **4.1.9** (dev) · vite **8.0.16** (dev).
  - **Root:** prettier **3.8.4** · turbo **2.9.18**.
- **React version isolation:** web (React 19.2.7 / Next 16) and mobile (React 19.2.3 / Expo SDK 56) each pin their own React in their own `package.json`. **Do NOT add `react` to the root `package.json` and do NOT hoist a single React across the workspace.** pnpm's isolated `node_modules` gives each app its own React. `expo-doctor` fails the mobile app if its React/React-Native drift from SDK 56's expected versions.
- **TypeScript isolation for codegen:** `openapi-typescript@7.13.0` declares `typescript` as a `peerDependency` capped at `^5.x` and uses the TS compiler API (`ts.factory.*`) at runtime; it is **unverified under TS 6**. `packages/api-client` therefore pins package-local `typescript@5.9.3` (codegen + its own typecheck), while `web`/`mobile`/root use `6.0.3`. pnpm's per-package resolution keeps these isolated; do not add a root-level `pnpm.peerDependencyRules` override.
- **No live UI design yet.** The web page and mobile screen are minimal connectivity probes, not designed UI elements. The design system + `docs/style-guide.md` are created in Phase 3 (UI brainstorm) per the house rule; do not introduce reusable UI components here.
- **Schema source = live from backend** (decided with the owner). The frontend `generate` step runs the backend via `uv`; it needs backend deps synced (`cd backend && uv sync`, done in 0b). OpenAPI generation is **DB-free** (no PostGIS container needed for `generate`).
- Each task ends with a direct-to-`main` commit; Task 6 pushes.

---

### Task 1: Backend — typed health response models + OpenAPI export

**Files:**
- Modify: `D:\repos\fountainrank\backend\app\routers\health.py`
- Create: `D:\repos\fountainrank\backend\app\export_openapi.py`
- Test: `D:\repos\fountainrank\backend\tests\test_openapi.py`

**Interfaces:**
- Consumes: `app.main.app` (existing), `app.db.get_session` (existing).
- Produces:
  - `app.routers.health.HealthResponse` (`status: str`) and `ReadyzResponse` (`status: str`, `postgis_version: str`, `sf_to_nyc_m: float`); `/healthz` and `/readyz` now declare these as their return type so FastAPI emits named OpenAPI components.
  - `app.export_openapi.main()` — writes `app.openapi()` JSON to the path in `argv[1]`, else to stdout. Invoked by `packages/api-client` (Task 3) as `python -m app.export_openapi <outfile>`.

- [ ] **Step 1: Start the local PostGIS container** (the existing `/readyz` test needs it)

Run:
```bash
docker rm -f fr-postgis 2>/dev/null || true
docker run -d --name fr-postgis \
  -e POSTGRES_USER=fountainrank -e POSTGRES_PASSWORD=fountainrank_dev -e POSTGRES_DB=fountainrank \
  -p 5436:5432 postgis/postgis:17-3.5
for i in $(seq 1 30); do
  docker exec fr-postgis pg_isready -U fountainrank -d fountainrank >/dev/null 2>&1 && break
  sleep 1
done
cd /d/repos/fountainrank/backend && uv run alembic upgrade head
```
Expected: container id, then `0001_enable_postgis` applies with no error.

- [ ] **Step 2: Write the failing test**

`backend/tests/test_openapi.py`:

```python
from app.main import app


def test_openapi_has_typed_health_schemas():
    schema = app.openapi()
    components = schema["components"]["schemas"]

    assert "HealthResponse" in components
    assert components["HealthResponse"]["properties"]["status"]["type"] == "string"

    assert "ReadyzResponse" in components
    props = components["ReadyzResponse"]["properties"]
    assert props["status"]["type"] == "string"
    assert props["postgis_version"]["type"] == "string"
    assert props["sf_to_nyc_m"]["type"] == "number"
```

- [ ] **Step 3: Run test to verify it fails**

Run: `cd /d/repos/fountainrank/backend && uv run pytest tests/test_openapi.py -v`
Expected: FAIL — `KeyError: 'HealthResponse'` (the endpoints still return bare `dict`s, so no named component schemas exist).

- [ ] **Step 4: Add response models to `app/routers/health.py`**

Replace the file with:

```python
from fastapi import APIRouter, Depends
from pydantic import BaseModel
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.db import get_session

router = APIRouter()


class HealthResponse(BaseModel):
    status: str


class ReadyzResponse(BaseModel):
    status: str
    postgis_version: str
    sf_to_nyc_m: float


@router.get("/healthz")
async def healthz() -> HealthResponse:
    return HealthResponse(status="ok")


@router.get("/readyz")
async def readyz(session: AsyncSession = Depends(get_session)) -> ReadyzResponse:
    version = (await session.execute(text("SELECT PostGIS_version()"))).scalar_one()
    distance_m = (
        await session.execute(
            text(
                "SELECT ST_Distance("
                "ST_SetSRID(ST_MakePoint(-122.4194, 37.7749), 4326)::geography, "
                "ST_SetSRID(ST_MakePoint(-73.9857, 40.7484), 4326)::geography)"
            )
        )
    ).scalar_one()
    return ReadyzResponse(
        status="ok", postgis_version=version, sf_to_nyc_m=float(distance_m)
    )
```

- [ ] **Step 5: Create `app/export_openapi.py`**

```python
"""Dump the FastAPI OpenAPI schema (DB-free) for frontend codegen."""

import json
import sys
from pathlib import Path

from app.main import app


def main() -> None:
    schema = json.dumps(app.openapi(), indent=2)
    if len(sys.argv) > 1:
        Path(sys.argv[1]).write_text(schema + "\n", encoding="utf-8")
    else:
        sys.stdout.write(schema)


if __name__ == "__main__":
    main()
```

- [ ] **Step 6: Run the full backend suite + lint**

Run: `cd /d/repos/fountainrank/backend && uv run pytest -v`
Expected: all pass — `test_config` (2), `test_healthz_ok`, `test_readyz_reports_postgis`, `test_openapi_has_typed_health_schemas`. The existing health/readyz tests still pass because the models serialize to the same JSON.

Run (confirm the export module works headless): `cd /d/repos/fountainrank/backend && uv run python -m app.export_openapi | head -c 40`
Expected: starts with `{` and `"openapi"` (valid JSON to stdout).

Run: `cd /d/repos/fountainrank/backend && uv run ruff check . && uv run ruff format --check .`
Expected: clean (run `uv run ruff format .` first if needed, then re-check).

- [ ] **Step 7: Commit**

```bash
cd /d/repos/fountainrank
git add backend/app/routers/health.py backend/app/export_openapi.py backend/tests/test_openapi.py
git commit -m "feat(backend): type health endpoints and add openapi export"
```

---

### Task 2: Monorepo root — pnpm workspace + Turborepo + tooling

**Files:**
- Create: `D:\repos\fountainrank\package.json`
- Create: `D:\repos\fountainrank\pnpm-workspace.yaml`
- Create: `D:\repos\fountainrank\turbo.json`
- Create: `D:\repos\fountainrank\.nvmrc`
- Create: `D:\repos\fountainrank\.prettierrc.json`
- Create: `D:\repos\fountainrank\.prettierignore`
- Modify: `D:\repos\fountainrank\.gitignore`
- Generate: `D:\repos\fountainrank\pnpm-lock.yaml`

**Interfaces:**
- Produces: a resolvable pnpm workspace with `turbo` tasks `generate`/`lint`/`typecheck`/`test`/`build`, root scripts that delegate to turbo, and repo-wide `prettier` (frontend globs only). Later tasks add the `web`, `mobile`, and `packages/api-client` workspace members.

- [ ] **Step 1: Confirm Node + Corepack/pnpm are available**

Run: `node --version`
Expected: a `v22.x` line (ideally `v22.22.3`; install/`nvm use` to match `.nvmrc` if it differs).

Run: `corepack --version || pnpm --version`
Expected: prints a version. If pnpm is missing, enable it: `corepack enable && corepack prepare pnpm@11.7.0 --activate`.

- [ ] **Step 2: Create `.nvmrc`**

```text
22.22.3
```

- [ ] **Step 3: Create root `package.json`**

```json
{
  "name": "fountainrank",
  "version": "0.0.0",
  "private": true,
  "packageManager": "pnpm@11.7.0",
  "engines": {
    "node": ">=22.0.0 <23.0.0"
  },
  "scripts": {
    "generate": "turbo run generate",
    "lint": "turbo run lint",
    "typecheck": "turbo run typecheck",
    "test": "turbo run test",
    "build": "turbo run build",
    "format": "prettier --write \"{web,mobile,packages}/**/*.{ts,tsx,js,jsx,mjs,cjs,json,css,md}\"",
    "format:check": "prettier --check \"{web,mobile,packages}/**/*.{ts,tsx,js,jsx,mjs,cjs,json,css,md}\""
  },
  "devDependencies": {
    "prettier": "3.8.4",
    "turbo": "2.9.18"
  }
}
```

- [ ] **Step 4: Create `pnpm-workspace.yaml`**

```yaml
packages:
  - "web"
  - "mobile"
  - "packages/*"
```

- [ ] **Step 5: Create `turbo.json`**

```json
{
  "$schema": "https://turbo.build/schema.json",
  "tasks": {
    "generate": {
      "cache": false,
      "outputs": ["openapi.json", "src/schema.d.ts"]
    },
    "lint": {},
    "typecheck": {
      "dependsOn": ["generate", "^generate"]
    },
    "test": {
      "dependsOn": ["generate", "^generate"]
    },
    "build": {
      "dependsOn": ["generate", "^generate"],
      "outputs": [".next/**", "!.next/cache/**"]
    }
  }
}
```

> `generate` is `cache: false` because its real inputs live in the backend (outside Turborepo's graph), so it must always re-run. `dependsOn: ["generate", "^generate"]` makes a package's own checks wait for its own `generate` **and** for its dependencies' `generate`: `@fountainrank/api-client#typecheck`/`test` wait for `@fountainrank/api-client#generate` (its `src/schema.d.ts`), and `web`/`mobile` wait for `@fountainrank/api-client#generate`. Turborepo only runs `generate` where the package defines that script, so the same-package edge is a no-op for `web`/`mobile`. This keeps the root `typecheck`/`test`/`build` scripts correct on a clean checkout (important for 0f CI), not just when `generate` is run first by hand. `lint` has no `generate` dependency (ESLint ignores the generated schema).

- [ ] **Step 6: Create `.prettierrc.json`**

```json
{
  "semi": true,
  "singleQuote": false,
  "trailingComma": "all",
  "printWidth": 100
}
```

- [ ] **Step 7: Create `.prettierignore`**

```text
node_modules
.next
.expo
.turbo
dist
out
coverage
pnpm-lock.yaml
packages/api-client/openapi.json
packages/api-client/src/schema.d.ts
```

- [ ] **Step 8: Add generated frontend artifacts to `.gitignore`**

Append this block to the end of `D:\repos\fountainrank\.gitignore`:

```text
# ---- Generated frontend artifacts (Phase 0c) ----
packages/api-client/openapi.json
packages/api-client/src/schema.d.ts
mobile/expo-env.d.ts
```

> `web/next-env.d.ts` is **committed** (Next's standard TypeScript setup tracks it, and `web/tsconfig.json` references it), so it is intentionally **not** ignored here — Task 4 creates it (Step 3) and commits it with `web/`. `mobile/expo-env.d.ts` is generated by Expo at run/prebuild time (later phase), so it is ignored. `web/.next/`, `mobile/.expo/`, `node_modules/`, `.turbo/`, and `*.tsbuildinfo` are already covered by the existing `.gitignore`.

- [ ] **Step 9: Install and verify the workspace resolves**

Run: `cd /d/repos/fountainrank && pnpm install`
Expected: installs `prettier` + `turbo`, writes `pnpm-lock.yaml`. With no workspace members yet, pnpm reports the root project only (no error for the not-yet-created `web`/`mobile` entries).

Run: `cd /d/repos/fountainrank && pnpm exec turbo --version && pnpm exec prettier --version`
Expected: `2.9.18` and `3.8.4`.

- [ ] **Step 10: Commit**

```bash
cd /d/repos/fountainrank
git add package.json pnpm-workspace.yaml turbo.json .nvmrc .prettierrc.json .prettierignore .gitignore pnpm-lock.yaml
git commit -m "build: scaffold pnpm + turborepo monorepo workspace"
```

---

### Task 3: `packages/api-client` — typed client generated from backend OpenAPI

**Files:**
- Create: `D:\repos\fountainrank\packages\api-client\package.json`
- Create: `D:\repos\fountainrank\packages\api-client\tsconfig.json`
- Create: `D:\repos\fountainrank\packages\api-client\eslint.config.mjs`
- Create: `D:\repos\fountainrank\packages\api-client\src\index.ts`
- Create: `D:\repos\fountainrank\packages\api-client\src\index.test.ts`
- Create: `D:\repos\fountainrank\packages\api-client\README.md`
- Generated (gitignored): `packages\api-client\openapi.json`, `packages\api-client\src\schema.d.ts`

**Interfaces:**
- Consumes: `app.export_openapi` (Task 1) via `cd ../../backend && uv run python -m app.export_openapi`.
- Produces: package `@fountainrank/api-client` exporting `makeClient(baseUrl: string, options?: Omit<ClientOptions, "baseUrl">): ApiClient` and the `ApiClient` type (`Client<paths>`). `paths` comes from the generated `src/schema.d.ts`. Consumed by `web/` (Task 4) and `mobile/` (Task 5) as `"@fountainrank/api-client": "workspace:*"`. Package scripts: `generate`, `generate:schema`, `generate:types`, `typecheck`, `lint`, `test`.

- [ ] **Step 1: Create `packages/api-client/package.json`**

```json
{
  "name": "@fountainrank/api-client",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "main": "./src/index.ts",
  "types": "./src/index.ts",
  "exports": {
    ".": "./src/index.ts"
  },
  "scripts": {
    "generate:schema": "cd ../../backend && uv run python -m app.export_openapi ../packages/api-client/openapi.json",
    "generate:types": "openapi-typescript ./openapi.json -o ./src/schema.d.ts",
    "generate": "pnpm run generate:schema && pnpm run generate:types",
    "typecheck": "tsc --noEmit",
    "lint": "eslint .",
    "test": "vitest run"
  },
  "dependencies": {
    "openapi-fetch": "0.17.0"
  },
  "devDependencies": {
    "@types/node": "22.19.21",
    "eslint": "9.39.4",
    "openapi-typescript": "7.13.0",
    "typescript": "5.9.3",
    "typescript-eslint": "8.61.1",
    "vite": "8.0.16",
    "vitest": "4.1.9"
  }
}
```

> `type: "module"` + `exports`/`types` pointing at raw `src/index.ts` is the Turborepo "internal package, no build step" pattern: consumers (Next via `transpilePackages`, Metro, vitest/vite) transpile the TS; `tsc` resolves types directly. The `generate:schema` script `cd`s into `backend` (portable in `cmd.exe` and `sh`) and has the Python write the file by path (no shell redirection). `typescript@5.9.3` is package-local on purpose (see Global Constraints — codegen isolation).

- [ ] **Step 2: Create `packages/api-client/tsconfig.json`**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "lib": ["ES2022", "DOM"],
    "strict": true,
    "noEmit": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "verbatimModuleSyntax": true,
    "types": ["node"]
  },
  "include": ["src/**/*.ts"]
}
```

> `lib` includes `DOM` so the global `fetch`/`Response` types resolve (openapi-fetch uses `fetch`).

- [ ] **Step 3: Create `packages/api-client/eslint.config.mjs`**

```js
import tseslint from "typescript-eslint";

export default tseslint.config(
  { ignores: ["src/schema.d.ts", "openapi.json"] },
  ...tseslint.configs.recommended,
);
```

- [ ] **Step 4: Install, then generate the schema + types**

Run: `cd /d/repos/fountainrank && pnpm install`
Expected: `@fountainrank/api-client` is picked up as a workspace member; installs its dev deps. `openapi-typescript`'s `typescript ^5` peer is satisfied by the package-local `typescript@5.9.3` — no peer warning.

Run: `cd /d/repos/fountainrank && pnpm --filter @fountainrank/api-client run generate`
Expected: writes `packages/api-client/openapi.json` (from the backend) and `packages/api-client/src/schema.d.ts` (from `openapi-typescript`). No error. (Requires backend deps synced: `cd backend && uv sync` if a fresh checkout.)

Run: `cd /d/repos/fountainrank && grep -c "\"/healthz\"" packages/api-client/openapi.json && grep -c "HealthResponse" packages/api-client/src/schema.d.ts`
Expected: both counts are ≥ 1 (the typed `/healthz` path and `HealthResponse` schema made it through codegen).

- [ ] **Step 5: Write the failing test**

`packages/api-client/src/index.test.ts`:

```ts
import { describe, expect, it } from "vitest";

import { makeClient } from "./index";

describe("makeClient", () => {
  it("returns typed data from GET /healthz", async () => {
    const fetchMock: typeof fetch = async () =>
      new Response(JSON.stringify({ status: "ok" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });

    const client = makeClient("http://test", { fetch: fetchMock });
    const { data, error } = await client.GET("/healthz");

    expect(error).toBeUndefined();
    expect(data).toEqual({ status: "ok" });
  });
});
```

- [ ] **Step 6: Run test to verify it fails**

Run: `cd /d/repos/fountainrank && pnpm --filter @fountainrank/api-client run test`
Expected: FAIL — cannot resolve `./index` / `makeClient` is not exported (the module does not exist yet).

- [ ] **Step 7: Implement `packages/api-client/src/index.ts`**

```ts
import createClient, { type Client, type ClientOptions } from "openapi-fetch";

import type { paths } from "./schema";

export type ApiClient = Client<paths>;

export function makeClient(
  baseUrl: string,
  options?: Omit<ClientOptions, "baseUrl">,
): ApiClient {
  return createClient<paths>({ baseUrl, ...options });
}
```

- [ ] **Step 8: Run test + typecheck + lint to verify green**

Run: `cd /d/repos/fountainrank && pnpm --filter @fountainrank/api-client run test`
Expected: 1 passed (`makeClient returns typed data from GET /healthz`).

Run: `cd /d/repos/fountainrank && pnpm --filter @fountainrank/api-client run typecheck`
Expected: no output, exit 0 (`paths["/healthz"]` resolves; `data` is typed `HealthResponse`).

Run: `cd /d/repos/fountainrank && pnpm --filter @fountainrank/api-client run lint`
Expected: no errors (`src/schema.d.ts` and `openapi.json` are ignored).

Run: `cd /d/repos/fountainrank && pnpm run format && pnpm run format:check`
Expected: Prettier formats the new files (a near-no-op — they were authored to `.prettierrc.json`), then reports all matched files clean. This keeps the api-client commit Prettier-clean.

- [ ] **Step 9: Create `packages/api-client/README.md`**

```markdown
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
```

- [ ] **Step 10: Commit**

```bash
cd /d/repos/fountainrank
git add packages/api-client/package.json packages/api-client/tsconfig.json packages/api-client/eslint.config.mjs packages/api-client/src/index.ts packages/api-client/src/index.test.ts packages/api-client/README.md pnpm-lock.yaml
git commit -m "feat(api-client): generate typed client from backend openapi"
```

> Do not `git add` `openapi.json` or `src/schema.d.ts` — they are gitignored. Confirm with `git status` that they are not staged.

---

### Task 4: `web/` — Next.js skeleton that calls the backend

**Files:**
- Create: `D:\repos\fountainrank\web\package.json`
- Create: `D:\repos\fountainrank\web\tsconfig.json`
- Create: `D:\repos\fountainrank\web\next-env.d.ts`
- Create: `D:\repos\fountainrank\web\next.config.ts`
- Create: `D:\repos\fountainrank\web\postcss.config.mjs`
- Create: `D:\repos\fountainrank\web\eslint.config.mjs`
- Create: `D:\repos\fountainrank\web\vitest.config.ts`
- Create: `D:\repos\fountainrank\web\lib\api.ts`
- Test: `D:\repos\fountainrank\web\lib\api.test.ts`
- Create: `D:\repos\fountainrank\web\app\layout.tsx`
- Create: `D:\repos\fountainrank\web\app\globals.css`
- Create: `D:\repos\fountainrank\web\app\page.tsx`
- Create: `D:\repos\fountainrank\web\app\backend-status.tsx`
- Create: `D:\repos\fountainrank\web\README.md`

**Interfaces:**
- Consumes: `@fountainrank/api-client` (`makeClient`, `ApiClient`).
- Produces: a Next.js App Router app. `web/lib/api.ts` exports `resolveApiBaseUrl(env?)` (reads `NEXT_PUBLIC_API_BASE_URL`, default `http://localhost:8000`) and `getApiClient()`. `app/backend-status.tsx` is a client component that fetches `/healthz` and renders the status. Package scripts: `dev`, `build`, `start`, `lint`, `typecheck`, `test`.

- [ ] **Step 1: Create `web/package.json`**

```json
{
  "name": "web",
  "version": "0.0.0",
  "private": true,
  "scripts": {
    "dev": "next dev",
    "build": "next build",
    "start": "next start",
    "lint": "eslint .",
    "typecheck": "tsc --noEmit",
    "test": "vitest run"
  },
  "dependencies": {
    "@fountainrank/api-client": "workspace:*",
    "next": "16.2.9",
    "react": "19.2.7",
    "react-dom": "19.2.7"
  },
  "devDependencies": {
    "@tailwindcss/postcss": "4.3.1",
    "@types/node": "22.19.21",
    "@types/react": "19.2.17",
    "@types/react-dom": "19.2.3",
    "eslint": "9.39.4",
    "eslint-config-next": "16.2.9",
    "tailwindcss": "4.3.1",
    "typescript": "6.0.3",
    "vite": "8.0.16",
    "vitest": "4.1.9"
  }
}
```

- [ ] **Step 2: Create `web/tsconfig.json`**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "lib": ["dom", "dom.iterable", "esnext"],
    "allowJs": true,
    "skipLibCheck": true,
    "strict": true,
    "noEmit": true,
    "esModuleInterop": true,
    "module": "esnext",
    "moduleResolution": "bundler",
    "resolveJsonModule": true,
    "isolatedModules": true,
    "jsx": "preserve",
    "incremental": true,
    "plugins": [{ "name": "next" }],
    "paths": {
      "@/*": ["./*"]
    }
  },
  "include": ["next-env.d.ts", "**/*.ts", "**/*.tsx", ".next/types/**/*.ts"],
  "exclude": ["node_modules"]
}
```

- [ ] **Step 3: Create `web/next-env.d.ts`**

```ts
/// <reference types="next" />
/// <reference types="next/image-types/global" />

// NOTE: This file should not be edited
// see https://nextjs.org/docs/app/api-reference/config/typescript for more information.
```

- [ ] **Step 4: Create `web/next.config.ts`**

```ts
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // The api-client ships raw TypeScript; Next must transpile it.
  transpilePackages: ["@fountainrank/api-client"],
};

export default nextConfig;
```

- [ ] **Step 5: Create `web/postcss.config.mjs`** (Tailwind v4 PostCSS plugin)

```js
const config = {
  plugins: {
    "@tailwindcss/postcss": {},
  },
};

export default config;
```

- [ ] **Step 6: Create `web/eslint.config.mjs`**

```js
import next from "eslint-config-next";

const config = [
  { ignores: [".next/**", "out/**", "next-env.d.ts"] },
  ...next,
];

export default config;
```

> `eslint-config-next@16.2.9` exports a flat-config **array** as its default export (verified), so spread it with `...next`. (Next 16 removed `next lint`; ESLint is wired manually via this flat config.)

- [ ] **Step 7: Create `web/vitest.config.ts`**

```ts
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["**/*.test.ts"],
  },
});
```

> `node` environment is enough — the only web test exercises a pure function. React component testing (jsdom/RTL) is intentionally deferred to Phase 3 when real UI exists.

- [ ] **Step 8: Write the failing test**

`web/lib/api.test.ts`:

```ts
import { describe, expect, it } from "vitest";

import { resolveApiBaseUrl } from "./api";

describe("resolveApiBaseUrl", () => {
  it("defaults to localhost:8000", () => {
    expect(resolveApiBaseUrl({})).toBe("http://localhost:8000");
  });

  it("uses NEXT_PUBLIC_API_BASE_URL when set", () => {
    expect(
      resolveApiBaseUrl({ NEXT_PUBLIC_API_BASE_URL: "https://api.example.com" }),
    ).toBe("https://api.example.com");
  });
});
```

- [ ] **Step 9: Run test to verify it fails**

Run: `cd /d/repos/fountainrank && pnpm install && pnpm --filter web run test`
Expected: FAIL — cannot resolve `./api` / `resolveApiBaseUrl` is not exported.

- [ ] **Step 10: Implement `web/lib/api.ts`**

```ts
import { makeClient, type ApiClient } from "@fountainrank/api-client";

const DEFAULT_API_BASE_URL = "http://localhost:8000";

export function resolveApiBaseUrl(
  env: { NEXT_PUBLIC_API_BASE_URL?: string } = process.env,
): string {
  return env.NEXT_PUBLIC_API_BASE_URL ?? DEFAULT_API_BASE_URL;
}

export function getApiClient(): ApiClient {
  return makeClient(resolveApiBaseUrl());
}
```

- [ ] **Step 11: Create the App Router files**

`web/app/globals.css`:

```css
@import "tailwindcss";
```

`web/app/layout.tsx`:

```tsx
import type { Metadata } from "next";

import "./globals.css";

export const metadata: Metadata = {
  title: "FountainRank",
  description: "Find, rate, and rank public drinking fountains.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
```

`web/app/backend-status.tsx`:

```tsx
"use client";

import { useEffect, useState } from "react";

import { getApiClient } from "@/lib/api";

type Status = "loading" | "ok" | "error";

export function BackendStatus() {
  const [status, setStatus] = useState<Status>("loading");

  useEffect(() => {
    getApiClient()
      .GET("/healthz")
      .then(({ data, error }) =>
        setStatus(!error && data?.status === "ok" ? "ok" : "error"),
      )
      .catch(() => setStatus("error"));
  }, []);

  return <p data-testid="backend-status">Backend status: {status}</p>;
}
```

`web/app/page.tsx`:

```tsx
import { BackendStatus } from "./backend-status";

export default function Home() {
  return (
    <main className="p-8">
      <h1 className="text-2xl font-bold">FountainRank</h1>
      <BackendStatus />
    </main>
  );
}
```

- [ ] **Step 12: Generate types, then verify test + lint + typecheck + build**

Run: `cd /d/repos/fountainrank && pnpm --filter @fountainrank/api-client run generate`
Expected: regenerates `schema.d.ts` (needed for `web` typecheck/build).

Run: `cd /d/repos/fountainrank && pnpm --filter web run test`
Expected: 2 passed.

Run: `cd /d/repos/fountainrank && pnpm --filter web run lint`
Expected: no ESLint errors.

Run: `cd /d/repos/fountainrank && pnpm --filter web run typecheck`
Expected: exit 0 (`GET("/healthz")` is typed against the generated schema).

Run: `cd /d/repos/fountainrank && pnpm --filter web run build`
Expected: `next build` succeeds (Tailwind v4 processes `globals.css`; the page prerenders with `BackendStatus` in its loading state — no live backend required).

Run: `cd /d/repos/fountainrank && pnpm run format && pnpm run format:check`
Expected: Prettier formats the new `web/` files (a near-no-op), then reports all matched files clean. This keeps the web commit Prettier-clean.

- [ ] **Step 13: Create `web/README.md`**

```markdown
# FountainRank Web

Next.js (App Router) + React 19 + Tailwind CSS v4. Talks to the backend through
`@fountainrank/api-client`.

## Common commands (run from the repo root)

```bash
pnpm --filter @fountainrank/api-client run generate  # refresh API types from the backend
pnpm --filter web run dev        # http://localhost:3000
pnpm --filter web run build
pnpm --filter web run lint
pnpm --filter web run typecheck
pnpm --filter web run test
```

The backend base URL defaults to `http://localhost:8000`; override with the
`NEXT_PUBLIC_API_BASE_URL` environment variable.
```

- [ ] **Step 14: Commit**

```bash
cd /d/repos/fountainrank
git add web/ pnpm-lock.yaml
git commit -m "feat(web): add next.js skeleton that calls the backend"
```

> `git add web/` includes `web/next-env.d.ts` (committed, per Next's standard TypeScript setup — it exists from Step 3). `git status` should show no `web/.next/` staged (gitignored).

---

### Task 5: `mobile/` — Expo skeleton that calls the backend

**Files:**
- Create: `D:\repos\fountainrank\mobile\package.json`
- Create: `D:\repos\fountainrank\mobile\app.json`
- Create: `D:\repos\fountainrank\mobile\tsconfig.json`
- Create: `D:\repos\fountainrank\mobile\babel.config.js`
- Create: `D:\repos\fountainrank\mobile\eslint.config.js`
- Create: `D:\repos\fountainrank\mobile\index.ts`
- Create: `D:\repos\fountainrank\mobile\App.tsx`
- Create: `D:\repos\fountainrank\mobile\README.md`

**Interfaces:**
- Consumes: `@fountainrank/api-client` (`makeClient`).
- Produces: an Expo SDK 56 app whose root `App` fetches `/healthz` and renders the status. Verified by `tsc --noEmit` + ESLint + `expo-doctor` (no bundling/unit tests in 0c, per the testing-ci policy). Package scripts: `start`, `android`, `ios`, `lint`, `typecheck`.

- [ ] **Step 1: Create `mobile/package.json`**

```json
{
  "name": "mobile",
  "version": "0.0.0",
  "private": true,
  "main": "index.ts",
  "scripts": {
    "start": "expo start",
    "android": "expo start --android",
    "ios": "expo start --ios",
    "lint": "eslint .",
    "typecheck": "tsc --noEmit"
  },
  "dependencies": {
    "@fountainrank/api-client": "workspace:*",
    "expo": "56.0.12",
    "react": "19.2.3",
    "react-native": "0.85.3"
  },
  "devDependencies": {
    "@types/react": "19.2.17",
    "eslint": "9.39.4",
    "eslint-config-expo": "56.0.4",
    "typescript": "6.0.3"
  }
}
```

> `react`/`react-native` are pinned to Expo SDK 56's expected versions. Do not bump `react` to web's `19.2.7` — `expo-doctor` checks this.

- [ ] **Step 2: Create `mobile/app.json`**

```json
{
  "expo": {
    "name": "FountainRank",
    "slug": "fountainrank",
    "version": "0.0.0",
    "platforms": ["ios", "android"],
    "newArchEnabled": true
  }
}
```

- [ ] **Step 3: Create `mobile/tsconfig.json`**

```json
{
  "extends": "expo/tsconfig.base",
  "compilerOptions": {
    "strict": true
  },
  "include": ["**/*.ts", "**/*.tsx", ".expo/types/**/*.ts", "expo-env.d.ts"]
}
```

- [ ] **Step 4: Create `mobile/babel.config.js`**

```js
module.exports = function (api) {
  api.cache(true);
  return {
    presets: ["babel-preset-expo"],
  };
};
```

- [ ] **Step 5: Create `mobile/eslint.config.js`**

```js
const expoConfig = require("eslint-config-expo/flat");

module.exports = [
  ...expoConfig,
  { ignores: ["dist/**", ".expo/**", "babel.config.js", "eslint.config.js"] },
];
```

> `eslint-config-expo/flat` (56.0.4) exports a flat-config **array**, so spread it with `...expoConfig`. Listing it as a bare element fails in ESLint 9 with `TypeError: Unexpected array.`. The config files themselves are ignored to avoid linting CommonJS plumbing.

- [ ] **Step 6: Create `mobile/index.ts`** (Expo entry point)

```ts
import { registerRootComponent } from "expo";

import App from "./App";

registerRootComponent(App);
```

- [ ] **Step 7: Create `mobile/App.tsx`** (the screen that calls the backend)

```tsx
import { useEffect, useState } from "react";
import { StyleSheet, Text, View } from "react-native";

import { makeClient } from "@fountainrank/api-client";

const API_BASE_URL = "http://localhost:8000";

type Status = "loading" | "ok" | "error";

export default function App() {
  const [status, setStatus] = useState<Status>("loading");

  useEffect(() => {
    makeClient(API_BASE_URL)
      .GET("/healthz")
      .then(({ data, error }) =>
        setStatus(!error && data?.status === "ok" ? "ok" : "error"),
      )
      .catch(() => setStatus("error"));
  }, []);

  return (
    <View style={styles.container}>
      <Text style={styles.title}>FountainRank</Text>
      <Text>Backend status: {status}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, alignItems: "center", justifyContent: "center" },
  title: { fontSize: 24, fontWeight: "bold" },
});
```

- [ ] **Step 8: Install, generate types, then verify typecheck + lint + doctor**

Run: `cd /d/repos/fountainrank && pnpm install`
Expected: installs mobile deps; mobile resolves its own `react@19.2.3` (web keeps `19.2.7`) — no peer error.

Run: `cd /d/repos/fountainrank && pnpm --filter @fountainrank/api-client run generate`
Expected: regenerates `schema.d.ts` (needed for mobile typecheck).

Run: `cd /d/repos/fountainrank && pnpm --filter mobile run typecheck`
Expected: exit 0 (`@fountainrank/api-client` resolves; `GET("/healthz")` is typed).

Run: `cd /d/repos/fountainrank && pnpm --filter mobile run lint`
Expected: no ESLint errors.

Run: `cd /d/repos/fountainrank/mobile && npx --yes expo-doctor`
Expected: all checks pass (no version-mismatch errors against SDK 56). If it flags a package version, align it to SDK 56's expected version (`npx expo install <pkg> --check`) and re-run.

Run: `cd /d/repos/fountainrank && pnpm run format && pnpm run format:check`
Expected: Prettier formats the new `mobile/` files (a near-no-op), then reports all matched files clean. This keeps the mobile commit Prettier-clean.

- [ ] **Step 9: Create `mobile/README.md`**

```markdown
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
```

- [ ] **Step 10: Commit**

```bash
cd /d/repos/fountainrank
git add mobile/ pnpm-lock.yaml
git commit -m "feat(mobile): add expo skeleton that calls the backend"
```

> `git status` should show no `mobile/.expo/` or `mobile/expo-env.d.ts` staged (both gitignored).

---

### Task 6: Pre-commit ESLint/Prettier hooks, README versions, final verification, push

**Files:**
- Modify: `D:\repos\fountainrank\.pre-commit-config.yaml`
- Modify: `D:\repos\fountainrank\README.md` (Software Versions table)

**Interfaces:**
- Consumes: the whole workspace (Tasks 1–5).
- Produces: pre-commit hooks that run ESLint + Prettier across the frontend (mirroring the 0f CI lint), and a filled-in root Software Versions table.

- [ ] **Step 1: Add frontend hooks to `.pre-commit-config.yaml`**

Append this `local` repo block to the end of the existing `repos:` list:

```yaml
  - repo: local
    hooks:
      - id: prettier
        name: prettier (frontend)
        entry: pnpm run format:check
        language: system
        pass_filenames: false
        files: ^(web|mobile|packages)/.*\.(ts|tsx|js|jsx|mjs|cjs|json|css|md)$
      - id: eslint
        name: eslint (frontend)
        entry: pnpm run lint
        language: system
        pass_filenames: false
        files: ^(web|mobile|packages)/.*\.(ts|tsx|js|jsx|mjs|cjs)$
```

> `language: system` + `pass_filenames: false` means each hook runs once (via the root pnpm scripts) only when a staged file matches `files`. ESLint runs through `turbo run lint`; it does not need the generated schema. `pnpm` must be on `PATH` when the hook runs.

- [ ] **Step 2: Verify the frontend is Prettier-clean**

Run: `cd /d/repos/fountainrank && pnpm run format:check`
Expected: `All matched files use Prettier code style!` (exit 0). Each frontend task (3–5) already ran `pnpm run format` before its own commit, so this is a verification. If anything is still unformatted, run `pnpm run format` and include the (formatting-only) changes in **this** task's commit (Step 5) — do not amend the earlier task commits.

- [ ] **Step 3: Update the root `README.md` Software Versions table**

Replace the existing table body under `## Software Versions` with:

```markdown
| Component | Version | Last checked |
|---|---|---|
| Python | 3.13.14 | 2026-06-17 |
| Node.js | 22.22.3 | 2026-06-17 |
| pnpm | 11.7.0 | 2026-06-17 |
| Turborepo | 2.9.18 | 2026-06-17 |
| TypeScript | 6.0.3 (api-client 5.9.3) | 2026-06-17 |
| Next.js | 16.2.9 | 2026-06-17 |
| React | 19.2.7 (web) / 19.2.3 (mobile) | 2026-06-17 |
| Expo SDK / React Native | 56 (expo 56.0.12) / 0.85.3 | 2026-06-17 |
| Tailwind CSS | 4.3.1 | 2026-06-17 |
| PostgreSQL / PostGIS | 17 / 3.5.2 | 2026-06-17 |
| uv | 0.11.21 | 2026-06-17 |
| FastAPI | 0.137.1 | 2026-06-17 |
| SQLAlchemy | 2.0.51 | 2026-06-17 |
| Alembic | 1.18.4 | 2026-06-17 |
| ruff | 0.15.17 | 2026-06-17 |
| (full pins) | `backend/pyproject.toml` + `backend/uv.lock`; workspace `package.json` + `pnpm-lock.yaml` | — |
```

- [ ] **Step 4: Final whole-monorepo verification**

Run (frontend — needs the PostGIS container from Task 1 Step 1 only if you also re-run backend tests; `generate` itself is DB-free):
```bash
cd /d/repos/fountainrank
pnpm install
pnpm run generate
pnpm run lint
pnpm run typecheck
pnpm run test
pnpm run build
```
Expected: install clean (no peer-dependency errors); `generate` writes the schema; `lint`/`typecheck` exit 0 across `web`, `mobile`, `@fountainrank/api-client`; `test` passes (web 2, api-client 1); `build` succeeds for `web`.

Run (mobile Expo check):
```bash
cd /d/repos/fountainrank/mobile && npx --yes expo-doctor && cd /d/repos/fountainrank
```
Expected: all `expo-doctor` checks pass.

Run (backend still green — needs `fr-postgis` up):
```bash
cd /d/repos/fountainrank/backend && uv run ruff check . && uv run ruff format --check . && uv run pytest -q
cd /d/repos/fountainrank
```
Expected: ruff clean; all backend tests pass.

Run (pre-commit, all hooks):
```bash
cd /d/repos/fountainrank && pre-commit run --all-files
```
Expected: baseline hooks + `ruff-check`/`ruff-format` + `prettier (frontend)` + `eslint (frontend)` all pass. (If a hook reformats/fixes, re-stage and re-run until clean.)

- [ ] **Step 5: Commit and push Phase 0c**

```bash
cd /d/repos/fountainrank
git add .pre-commit-config.yaml README.md
git commit -m "docs: add frontend eslint/prettier hooks and pin versions"
git push origin main
```

- [ ] **Step 6: Clean up the local DB container** (optional)

Run: `docker rm -f fr-postgis 2>/dev/null; echo done`
Expected: `done`.

---

## Self-Review

**Spec coverage (spec §14, §21 "Monorepo wiring" + "Walking-skeleton apps", §22 layout + handoff "0c"):**
- pnpm workspace + Turborepo covering `web`, `mobile`, `packages` → Task 2. ✅
- Next.js web page that calls the backend → Task 4 (`BackendStatus` → `GET /healthz` via api-client). ✅
- Expo app screen that calls the backend → Task 5 (`App` → `GET /healthz`). ✅
- Shared `packages/api-client` generated from OpenAPI → Task 3 (`openapi-typescript` + `openapi-fetch`, live from backend per the owner's choice). ✅
- ESLint/Prettier pre-commit hooks → Task 6 (per-app ESLint flat configs in Tasks 3–5; hooks in Task 6). ✅
- Pin Node 22.x + JS deps; fill README "Node.js" row → Global Constraints (pins) + Task 6 (README). ✅
- Deferred-from-0b typed `/readyz` response model for clean codegen → Task 1 (`HealthResponse`/`ReadyzResponse`). ✅
- Deferred (correctly out of 0c): `docker-compose.yml` + `run.ps1` (0d); Terraform/k8s (0e); CI workflows, CodeQL, Dependabot, Trivy, `pnpm audit`, CODEOWNERS, README badges (0f); real UI + `docs/style-guide.md` + MapLibre maps + React component (RTL) tests (Phase 3); Logto auth SDKs (Phase 2). `packages/config` and `packages/ui` and a shared `packages/tsconfig` are deferred (YAGNI — only `api-client` exists in 0c). Each noted inline.

**Placeholder scan:** Every file is given complete content (root `package.json`/`pnpm-workspace.yaml`/`turbo.json`/`.nvmrc`/prettier configs/`.gitignore` block; api-client `package.json`/`tsconfig`/eslint/`index.ts`/test/README; web's 13 files; mobile's 8 files; the pre-commit block; the README table). The ESLint flat-config shapes (`...next` for `eslint-config-next@16.2.9`, `...expoConfig` for `eslint-config-expo/flat@56.0.4`) are the verified-correct forms — both export flat-config arrays and must be spread; no fallbacks remain. The one remediation note (`expo-doctor` version-alignment if it flags drift) is a standard `expo install --check` fix resolved in the same step, not a missing value.

**Type/name consistency:** `makeClient`/`ApiClient` defined in Task 3 (`packages/api-client/src/index.ts`) are imported by `web/lib/api.ts` (Task 4) and `mobile/App.tsx` (Task 5). `paths` is produced by `generate:types` into `src/schema.d.ts` and consumed by `index.ts`. `resolveApiBaseUrl`/`getApiClient` defined in `web/lib/api.ts` (Task 4 Step 10) and consumed by `web/app/backend-status.tsx` (Step 11) and the test (Step 8). The `/healthz` path string and its `HealthResponse` shape (`{ status: string }`) are consistent across Task 1 (backend model), the api-client test, the web component, and the mobile screen. `@fountainrank/api-client` (the package `name`) matches every `workspace:*` dependency and import specifier. Turborepo task names (`generate`/`lint`/`typecheck`/`test`/`build`) match the per-package `scripts` and the root delegating scripts. Pinned versions are identical between Global Constraints and every `package.json`, the README table, and the pre-commit-adjacent tooling.
