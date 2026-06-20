# Web Logto Auth Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the `web/` Next.js app a real Logto OIDC client (server-side BFF token pattern) and add a backend `GET /api/v1/me`, so an authenticated user's Logto resource JWT round-trips to the backend and writes are unblocked.

**Architecture:** Logto Next.js SDK (`@logto/next` v4, App Router) with an encrypted httpOnly server session. The access token for the `https://api.fountainrank.com` API Resource is fetched **only server-side** (`getAccessTokenRSC` in a React Server Component) and attached to a server-to-server backend call — never exposed to the browser. A new `GET /api/v1/me` (auth-required) is the round-trip target rendered on an `/account` page.

**Tech Stack:** Next.js 16.2.9 (App Router) · React 19 · Tailwind v4 · `@logto/next@4.2.10` · `server-only` · TypeScript · vitest (web). FastAPI · SQLAlchemy 2 async · Pydantic · pytest (backend). pnpm workspace + turbo. DOKS via envsubst'd manifests + `deploy.yml`.

**Spec:** `docs/specs/2026-06-19-web-logto-auth-design.md` (Codex Loop A `VERDICT: APPROVED`).

## Global Constraints

- **Token boundary:** the Logto access token is obtained and used **server-side only**; it is NEVER sent to the browser, and no Logto secret uses a `NEXT_PUBLIC_` name.
- **Build-safe env:** `getLogtoConfig()` is a per-request function (never a top-level const); `/account` and `/callback` are `export const dynamic = "force-dynamic"`. `pnpm exec turbo run build --filter=web` MUST pass with **no `LOGTO_*` set**.
- **Secrets:** `LOGTO_APP_SECRET` + `LOGTO_COOKIE_SECRET` live only in the k8s `fountainrank-secrets` Secret (via `secretKeyRef`); never committed, never in envsubst workload output, never logged. **Never create or modify a `.env` file.**
- **Logging:** new server-side auth paths use the structured `web/lib/server/log.ts` helper (redacted, stdout, `LOG_LEVEL`/`LOG_FORMAT`); no bare `console.*` for diagnostics. Never log tokens, JWTs, the session cookie, secrets, or the raw callback query string.
- **Deps:** `@logto/next@4.2.10` + `server-only` are the only new web deps; **no** new backend deps. Generated `packages/api-client/openapi.json` + `src/schema.d.ts` are gitignored — never commit them.
- **No AI attribution** in commits/PRs. **No time estimates** anywhere.
- **Windows host:** file tools use backslash paths (`D:\repos\fountainrank\...`); the Bash tool is git-bash (forward slashes). Local CI mirror: `powershell.exe -NoProfile -File run.ps1 check` (full) / `run.ps1 check -Backend`. The web local mirror is flaky on Windows (known `eslint-config-next` resolution artifact) — if it fails only on that, CI is the source of truth.
- **Source control:** branch `feat/web-logto-auth` (already created) → PR → CI green + Codex Loop B `VERDICT: APPROVED` + all PR comments addressed → squash-merge. Conventional Commits, frequent commits.

---

## File Structure

**Backend**
- Create `backend/app/routers/users.py` — `GET /api/v1/me`.
- Modify `backend/app/schemas.py` — add `MeResponse`.
- Modify `backend/app/main.py` — include `users.router`.
- Create `backend/tests/test_me.py` — endpoint tests.
- Modify `backend/tests/test_openapi.py` — assert `/api/v1/me` + `MeResponse`.

**Web**
- Modify `web/package.json` + `pnpm-lock.yaml` — add `@logto/next`, `server-only`.
- Create `web/lib/logto.ts` — `requireEnv`, `requireCookieSecret`, `getLogtoConfig`.
- Create `web/lib/logto.test.ts`.
- Create `web/lib/server/log.ts` — structured logger (`redact`, `log`).
- Create `web/lib/server/log.test.ts`.
- Create `web/lib/server/api.ts` — `authedClientHeaders`, `getAuthedApiClient`.
- Create `web/lib/server/api.test.ts`.
- Create `web/app/actions/auth.ts` — `signInAction`, `signOutAction`.
- Create `web/app/callback/route.ts` — `handleSignIn`.
- Create `web/components/SignInButton.tsx`, `web/components/SignOutButton.tsx`.
- Create `web/app/account/page.tsx` — `/account`.
- Modify `web/app/page.tsx` — footer "Sign in" link.
- Modify `docs/style-guide.md` — auth UI elements.

**Infra**
- Modify `infra/k8s/web.yaml` — `LOGTO_*` + `LOG_LEVEL`/`LOG_FORMAT` env.
- Modify `.github/workflows/deploy.yml` — two secret keys + `LOGTO_APP_ID` export.
- Modify `infra/k8s/secrets.yaml` — document the two new secret keys.

**Docs**
- Modify `claude_help/oauth-sso.md` — web BFF pattern + env names.
- Modify `docs/setup/06-logto.md` — web redirect URIs + GitHub-secret owner task.

---

## Task 1: Backend `GET /api/v1/me`

**Files:**
- Create: `backend/app/routers/users.py`
- Modify: `backend/app/schemas.py` (add `MeResponse`)
- Modify: `backend/app/main.py:10` (import) and `:32-35` (include)
- Test: `backend/tests/test_me.py`
- Modify: `backend/tests/test_openapi.py`

**Interfaces:**
- Consumes: `get_current_user` (`backend/app/auth.py`) → returns `User`; `User` model (`id: uuid.UUID`, `display_name: str`, `email: str`, `avatar_url: str | None`, `is_admin: bool`, `created_at: datetime`).
- Produces: `GET /api/v1/me` → `MeResponse` JSON; the web client (Task 4/6) calls `client.GET("/api/v1/me")`.

- [ ] **Step 1: Write the failing tests**

Create `backend/tests/test_me.py`:

```python
from httpx import ASGITransport, AsyncClient

from app.main import app


async def test_me_returns_profile(client, test_user):
    resp = await client.get("/api/v1/me")
    assert resp.status_code == 200
    body = resp.json()
    assert body["id"] == str(test_user.id)
    assert body["display_name"] == "Dev One"
    assert body["email"] == "dev1@example.com"
    assert body["avatar_url"] is None
    assert body["is_admin"] is False
    assert "created_at" in body
    # The Logto subject is an internal identity key, never user-facing payload.
    assert "logto_user_id" not in body


async def test_me_requires_auth():
    # No dependency override and no credential -> the real resolver returns 401.
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        resp = await ac.get("/api/v1/me")
    assert resp.status_code == 401
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `powershell.exe -NoProfile -File run.ps1 check -Backend` (or `cd backend && uv run pytest tests/test_me.py -v`)
Expected: FAIL — `404` for `/api/v1/me` (route not defined yet).

- [ ] **Step 3: Add the `MeResponse` schema**

In `backend/app/schemas.py`, after `RatingTypeOut` (it already imports `uuid`, `datetime`, `BaseModel`, `ConfigDict`):

```python
class MeResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    display_name: str
    email: str
    avatar_url: str | None
    is_admin: bool
    created_at: datetime
```

- [ ] **Step 4: Create the router**

Create `backend/app/routers/users.py`:

```python
from typing import Annotated

from fastapi import APIRouter, Depends

from app.auth import get_current_user
from app.models import User
from app.schemas import MeResponse

router = APIRouter(prefix="/api/v1", tags=["users"])


@router.get("/me", response_model=MeResponse)
async def get_me(current_user: Annotated[User, Depends(get_current_user)]) -> User:
    # Auth failures are raised by get_current_user (401). Unexpected errors propagate
    # to the centralized exception handler in main.py (logged 500) — not swallowed here.
    return current_user
```

- [ ] **Step 5: Mount the router**

In `backend/app/main.py` line 10, add `users` to the import:

```python
from app.routers import email_webhook, fountains, health, rating_types, users
```

And after `app.include_router(fountains.router)` (line 34), add:

```python
    app.include_router(users.router)
```

- [ ] **Step 6: Extend the OpenAPI test**

In `backend/tests/test_openapi.py`, add to `test_openapi_exposes_phase1_contract` (or a new test):

```python
def test_openapi_exposes_me_endpoint():
    schema = app.openapi()
    assert "/api/v1/me" in schema["paths"]
    assert "MeResponse" in schema["components"]["schemas"]
```

- [ ] **Step 7: Run the tests to verify they pass**

Run: `powershell.exe -NoProfile -File run.ps1 check -Backend`
Expected: PASS — `test_me.py` (2) + `test_openapi.py` green; existing suite still green.

- [ ] **Step 8: Commit**

```bash
git add backend/app/routers/users.py backend/app/schemas.py backend/app/main.py backend/tests/test_me.py backend/tests/test_openapi.py
git commit -m "feat(backend): add GET /api/v1/me (current user profile)"
```

---

## Task 2: Web dependencies + Logto config

**Files:**
- Modify: `web/package.json`, `pnpm-lock.yaml`
- Create: `web/lib/logto.ts`
- Test: `web/lib/logto.test.ts`

**Interfaces:**
- Produces: `getLogtoConfig(env?): LogtoNextConfig`, `requireEnv(name, env?): string`, `requireCookieSecret(name, env?): string`. Consumed by Tasks 4, 5, 6.

- [ ] **Step 1: Add the dependencies**

From the repo root:

```bash
pnpm --filter web add @logto/next@4.2.10 server-only
```

Confirm `web/package.json` gained both under `dependencies` and `pnpm-lock.yaml` updated.

- [ ] **Step 2: Write the failing test**

Create `web/lib/logto.test.ts`:

```ts
import { describe, expect, it } from "vitest";

import { getLogtoConfig, requireCookieSecret, requireEnv } from "./logto";

const base = {
  LOGTO_ENDPOINT: "https://auth.fountainrank.com",
  LOGTO_APP_ID: "app123",
  LOGTO_APP_SECRET: "secret",
  LOGTO_BASE_URL: "https://fountainrank.com",
  LOGTO_COOKIE_SECRET: "x".repeat(32),
} as NodeJS.ProcessEnv;

describe("requireEnv", () => {
  it("returns the value when set", () => {
    expect(requireEnv("LOGTO_APP_ID", base)).toBe("app123");
  });
  it("throws naming the missing var", () => {
    expect(() => requireEnv("LOGTO_APP_ID", {})).toThrow(/LOGTO_APP_ID/);
  });
});

describe("requireCookieSecret", () => {
  it("passes at exactly 32 chars", () => {
    expect(requireCookieSecret("LOGTO_COOKIE_SECRET", { LOGTO_COOKIE_SECRET: "x".repeat(32) })).toHaveLength(32);
  });
  it("throws below 32 chars", () => {
    expect(() => requireCookieSecret("LOGTO_COOKIE_SECRET", { LOGTO_COOKIE_SECRET: "x".repeat(31) })).toThrow(/32/);
  });
});

describe("getLogtoConfig", () => {
  it("builds config with the API resource and dev cookieSecure=false", () => {
    const cfg = getLogtoConfig({ ...base, NODE_ENV: "development" });
    expect(cfg.resources).toEqual(["https://api.fountainrank.com"]);
    expect(cfg.cookieSecure).toBe(false);
    expect(cfg.baseUrl).toBe("https://fountainrank.com");
  });
  it("sets cookieSecure=true in production", () => {
    expect(getLogtoConfig({ ...base, NODE_ENV: "production" }).cookieSecure).toBe(true);
  });
});
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `pnpm --filter web exec vitest run lib/logto.test.ts`
Expected: FAIL — `./logto` not found.

- [ ] **Step 4: Implement the config module**

Create `web/lib/logto.ts`:

```ts
import type { LogtoNextConfig } from "@logto/next";

export const API_RESOURCE = "https://api.fountainrank.com";

export function requireEnv(name: string, env: NodeJS.ProcessEnv = process.env): string {
  const value = env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

export function requireCookieSecret(name: string, env: NodeJS.ProcessEnv = process.env): string {
  const value = requireEnv(name, env);
  if (value.length < 32) {
    throw new Error(`${name} must be at least 32 characters (Logto session cookie encryption)`);
  }
  return value;
}

// Built per request (never a top-level const) so `next build` — which runs with no
// LOGTO_* present — never evaluates requireEnv and fails. Call sites are dynamic routes.
export function getLogtoConfig(env: NodeJS.ProcessEnv = process.env): LogtoNextConfig {
  return {
    endpoint: requireEnv("LOGTO_ENDPOINT", env),
    appId: requireEnv("LOGTO_APP_ID", env),
    appSecret: requireEnv("LOGTO_APP_SECRET", env),
    baseUrl: requireEnv("LOGTO_BASE_URL", env),
    cookieSecret: requireCookieSecret("LOGTO_COOKIE_SECRET", env),
    cookieSecure: env.NODE_ENV === "production",
    resources: [API_RESOURCE],
  };
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `pnpm --filter web exec vitest run lib/logto.test.ts`
Expected: PASS (6 assertions).

- [ ] **Step 6: Commit**

```bash
git add web/package.json pnpm-lock.yaml web/lib/logto.ts web/lib/logto.test.ts
git commit -m "feat(web): add @logto/next deps + request-scoped Logto config"
```

---

## Task 3: Web structured logger

**Files:**
- Create: `web/lib/server/log.ts`
- Test: `web/lib/server/log.test.ts`

**Interfaces:**
- Produces: `redact(fields): Record<string, unknown>`, `log(level, msg, fields?, env?): void`. Consumed by Tasks 5, 6.

- [ ] **Step 1: Write the failing test**

Create `web/lib/server/log.test.ts`:

```ts
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { log, redact } from "./log";

afterEach(() => vi.restoreAllMocks());

describe("redact", () => {
  it("masks token-bearing keys, keeps benign ones", () => {
    const out = redact({ accessToken: "abc", authorization: "Bearer z", code: "c", user: "bob" });
    expect(out.accessToken).toBe("[redacted]");
    expect(out.authorization).toBe("[redacted]");
    expect(out.code).toBe("[redacted]");
    expect(out.user).toBe("bob");
  });
});

describe("log", () => {
  it("never emits a token value", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    log("warn", "callback failed", { accessToken: "supersecret" }, { LOG_LEVEL: "info", LOG_FORMAT: "json" });
    const line = spy.mock.calls.map((c) => String(c[0])).join("");
    expect(line).not.toContain("supersecret");
    expect(line).toContain("[redacted]");
  });

  it("suppresses below the configured level", () => {
    const spy = vi.spyOn(console, "log").mockImplementation(() => {});
    log("debug", "noise", {}, { LOG_LEVEL: "info" });
    expect(spy).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter web exec vitest run lib/server/log.test.ts`
Expected: FAIL — `./log` not found.

- [ ] **Step 3: Implement the logger**

Create `web/lib/server/log.ts`:

```ts
import "server-only";

export type LogLevel = "debug" | "info" | "warn" | "error";

const ORDER: Record<LogLevel, number> = { debug: 10, info: 20, warn: 30, error: 40 };

// Substrings that mark a field as sensitive; matched case-insensitively against the key.
const SENSITIVE = ["token", "authorization", "cookie", "secret", "jwt", "code", "password", "query"];

export function redact(fields: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(fields)) {
    const lower = key.toLowerCase();
    out[key] = SENSITIVE.some((s) => lower.includes(s)) ? "[redacted]" : value;
  }
  return out;
}

export function log(
  level: LogLevel,
  message: string,
  fields: Record<string, unknown> = {},
  env: NodeJS.ProcessEnv = process.env,
): void {
  const threshold = ORDER[(env.LOG_LEVEL as LogLevel) ?? "info"] ?? ORDER.info;
  if (ORDER[level] < threshold) {
    return;
  }
  const safe = redact(fields);
  const payload =
    (env.LOG_FORMAT ?? "json") === "json"
      ? JSON.stringify({ level, msg: message, service: "web", ...safe })
      : `${level.toUpperCase()} ${message} ${JSON.stringify(safe)}`;
  // console is the stdout/stderr sink here (DOKS captures it) — not an ad-hoc diagnostic.
  (level === "warn" || level === "error" ? console.error : console.log)(payload);
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm --filter web exec vitest run lib/server/log.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add web/lib/server/log.ts web/lib/server/log.test.ts
git commit -m "feat(web): add redacting structured server logger"
```

---

## Task 4: Web server-only BFF data layer

**Files:**
- Create: `web/lib/server/api.ts`
- Test: `web/lib/server/api.test.ts`

**Interfaces:**
- Consumes: `getLogtoConfig` (`web/lib/logto.ts`), `resolveApiBaseUrl` (`web/lib/api.ts`), `makeClient` (`@fountainrank/api-client`), `getAccessTokenRSC` (`@logto/next/server-actions`).
- Produces: `authedClientHeaders(token, requestId): Record<string, string>`, `getAuthedApiClient(requestId): Promise<ApiClient>`. Consumed by Task 6.

- [ ] **Step 1: Write the failing test**

Create `web/lib/server/api.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@logto/next/server-actions", () => ({
  getAccessTokenRSC: vi.fn().mockResolvedValue("tok-123"),
}));

import { authedClientHeaders, getAuthedApiClient } from "./api";

describe("authedClientHeaders", () => {
  it("sets Bearer auth + request id", () => {
    expect(authedClientHeaders("tok-123", "rid-1")).toEqual({
      Authorization: "Bearer tok-123",
      "X-Request-ID": "rid-1",
    });
  });
});

describe("getAuthedApiClient", () => {
  it("fetches an RSC token and returns a client", async () => {
    process.env.LOGTO_ENDPOINT = "https://auth.fountainrank.com";
    process.env.LOGTO_APP_ID = "app123";
    process.env.LOGTO_APP_SECRET = "secret";
    process.env.LOGTO_BASE_URL = "https://fountainrank.com";
    process.env.LOGTO_COOKIE_SECRET = "x".repeat(32);
    const client = await getAuthedApiClient("rid-1");
    expect(client.GET).toBeTypeOf("function");
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter web exec vitest run lib/server/api.test.ts`
Expected: FAIL — `./api` (server) not found.

- [ ] **Step 3: Implement the BFF helper**

Create `web/lib/server/api.ts`:

```ts
import "server-only";

import { getAccessTokenRSC } from "@logto/next/server-actions";

import { makeClient, type ApiClient } from "@fountainrank/api-client";

import { resolveApiBaseUrl } from "../api";
import { API_RESOURCE, getLogtoConfig } from "../logto";

export function authedClientHeaders(token: string, requestId: string): Record<string, string> {
  return { Authorization: `Bearer ${token}`, "X-Request-ID": requestId };
}

// getAccessTokenRSC is the RSC-specific helper: a React Server Component has read-only
// cookies, so a refreshed token is not persisted here (acceptable for a per-request read).
// The token never leaves the server — `server-only` guards against any client-bundle import.
export async function getAuthedApiClient(requestId: string): Promise<ApiClient> {
  const token = await getAccessTokenRSC(getLogtoConfig(), API_RESOURCE);
  return makeClient(resolveApiBaseUrl(), { headers: authedClientHeaders(token, requestId) });
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm --filter web exec vitest run lib/server/api.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add web/lib/server/api.ts web/lib/server/api.test.ts
git commit -m "feat(web): add server-only authed api client (BFF token attach)"
```

---

## Task 5: Web auth actions, callback route, sign-in/out buttons

**Files:**
- Create: `web/app/actions/auth.ts`
- Create: `web/app/callback/route.ts`
- Create: `web/components/SignInButton.tsx`, `web/components/SignOutButton.tsx`

**Interfaces:**
- Consumes: `getLogtoConfig` (`web/lib/logto.ts`), `log` (`web/lib/server/log.ts`), `signIn`/`signOut`/`handleSignIn` (`@logto/next/server-actions`).
- Produces: `signInAction()`, `signOutAction()` (server actions); `<SignInButton/>`, `<SignOutButton/>`. Consumed by Task 6.

> These are thin SDK/redirect glue that cannot be meaningfully unit-tested without the live SDK + a browser; they are verified by typecheck/build (this task) and the live verification (Task 9). Write them completely and correctly.

- [ ] **Step 1: Create the server actions**

Create `web/app/actions/auth.ts`:

```ts
"use server";

import { signIn, signOut } from "@logto/next/server-actions";

import { getLogtoConfig } from "../../lib/logto";

export async function signInAction(): Promise<void> {
  const config = getLogtoConfig();
  await signIn(config, `${config.baseUrl}/callback`);
}

export async function signOutAction(): Promise<void> {
  const config = getLogtoConfig();
  await signOut(config, config.baseUrl);
}
```

- [ ] **Step 2: Create the callback route**

Create `web/app/callback/route.ts`:

```ts
import { handleSignIn } from "@logto/next/server-actions";
import { redirect } from "next/navigation";
import type { NextRequest } from "next/server";

import { getLogtoConfig } from "../../lib/logto";
import { log } from "../../lib/server/log";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest): Promise<void> {
  let ok = true;
  try {
    await handleSignIn(getLogtoConfig(), request.nextUrl.searchParams);
  } catch (error) {
    // Never log the callback query string (it carries the auth `code`).
    ok = false;
    log("warn", "logto callback failed", { reason: (error as Error).name });
  }
  // redirect() throws NEXT_REDIRECT, so it must run OUTSIDE the try/catch above.
  redirect(ok ? "/account" : "/account?error=signin");
}
```

- [ ] **Step 3: Create the buttons**

Create `web/components/SignInButton.tsx`:

```tsx
"use client";

import { signInAction } from "../app/actions/auth";

export function SignInButton() {
  return (
    <form action={signInAction}>
      <button
        type="submit"
        className="inline-flex items-center justify-center rounded-full bg-[#F2C200] px-6 py-2.5 text-sm font-semibold text-[#0A357E] transition hover:bg-[#ffce1f] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#F2C200]"
      >
        Sign in
      </button>
    </form>
  );
}
```

Create `web/components/SignOutButton.tsx`:

```tsx
"use client";

import { signOutAction } from "../app/actions/auth";

export function SignOutButton() {
  return (
    <form action={signOutAction}>
      <button
        type="submit"
        className="inline-flex items-center justify-center rounded-full border border-white/40 px-6 py-2.5 text-sm font-semibold text-white transition hover:bg-white/10 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white"
      >
        Sign out
      </button>
    </form>
  );
}
```

- [ ] **Step 4: Typecheck**

Run: `pnpm --filter web exec tsc --noEmit`
Expected: PASS (no type errors). If `@logto/next` ESM fails to resolve in the build later, add `"@logto/next"` to `transpilePackages` in `web/next.config.ts`.

- [ ] **Step 5: Commit**

```bash
git add web/app/actions/auth.ts web/app/callback/route.ts web/components/SignInButton.tsx web/components/SignOutButton.tsx
git commit -m "feat(web): add Logto sign-in/out actions, callback route, buttons"
```

---

## Task 6: Web `/account` page + landing link + style guide

**Files:**
- Create: `web/app/account/page.tsx`
- Modify: `web/app/page.tsx` (footer link)
- Modify: `docs/style-guide.md`

**Interfaces:**
- Consumes: `getLogtoConfig`, `getAuthedApiClient`, `log`, `<SignInButton/>`, `<SignOutButton/>`, `getLogtoContext` (`@logto/next/server-actions`).

- [ ] **Step 1: Create the account page**

Create `web/app/account/page.tsx`:

```tsx
import { getLogtoContext } from "@logto/next/server-actions";

import { SignInButton } from "../../components/SignInButton";
import { SignOutButton } from "../../components/SignOutButton";
import { getLogtoConfig } from "../../lib/logto";
import { getAuthedApiClient } from "../../lib/server/api";
import { log } from "../../lib/server/log";

export const dynamic = "force-dynamic";

const shell =
  "relative flex min-h-dvh flex-col items-center justify-center gap-6 bg-gradient-to-b from-[#0A357E] via-[#0C44A0] to-[#0E4DA4] px-6 py-16 text-center text-white";

export default async function AccountPage() {
  const { isAuthenticated } = await getLogtoContext(getLogtoConfig(), { fetchUserInfo: false });

  if (!isAuthenticated) {
    return (
      <main className={shell}>
        <h1 className="text-2xl font-bold">Your FountainRank account</h1>
        <p className="max-w-sm text-white/80">Sign in to rate fountains and add new ones.</p>
        <SignInButton />
      </main>
    );
  }

  const requestId = crypto.randomUUID();
  const { data, error } = await (await getAuthedApiClient(requestId)).GET("/api/v1/me");

  if (error || !data) {
    log("error", "failed to load profile", { requestId, ok: false });
    return (
      <main className={shell}>
        <h1 className="text-2xl font-bold">Couldn&rsquo;t load your profile</h1>
        <p className="max-w-sm text-white/80">Please try signing in again.</p>
        <SignOutButton />
      </main>
    );
  }

  log("debug", "loaded profile", { requestId });
  return (
    <main className={shell}>
      <h1 className="text-2xl font-bold">Signed in</h1>
      <dl className="text-white/90">
        <div className="flex gap-2">
          <dt className="font-semibold">Name:</dt>
          <dd>{data.display_name}</dd>
        </div>
        <div className="flex gap-2">
          <dt className="font-semibold">Email:</dt>
          <dd>{data.email}</dd>
        </div>
      </dl>
      <SignOutButton />
    </main>
  );
}
```

- [ ] **Step 2: Add the landing footer link**

In `web/app/page.tsx`, in the `<footer>` (which already holds the copyright + Privacy + Terms links), add a "Sign in" link matching the existing `Link` styling:

```tsx
        <Link className="underline-offset-4 hover:text-white hover:underline" href="/account">
          Sign in
        </Link>
```

(Place it after the Terms `Link`, inside the same `<footer>`.)

- [ ] **Step 3: Document the new UI elements in the style guide**

In `docs/style-guide.md`, under `## Components`, append:

```markdown
### Auth buttons (`web/components/SignInButton.tsx`, `SignOutButton.tsx`)

Pill-shaped buttons that submit a Next.js server action (`<form action={...}>`).

- **Sign in (primary):** solid crown-gold fill (`bg-[#F2C200]`), navy text
  (`text-[#0A357E]`), `hover:bg-[#ffce1f]`, gold focus ring.
- **Sign out (secondary):** transparent with a `border-white/40` outline, white text,
  `hover:bg-white/10`, white focus ring — for use on the brand gradient.
- Both are `rounded-full`, `px-6 py-2.5`, `text-sm font-semibold`, and carry a visible
  `focus-visible` outline for keyboard users.

### Account panel (`web/app/account/page.tsx`)

The authenticated utility page (the BFF round-trip surface), on the brand gradient
(`min-h-dvh`, centered). Three states: signed-out (heading + copy + Sign in), signed-in
(heading + a `name`/`email` definition list + Sign out), and a profile-load error
(heading + Sign out). Not linked from the marketing hero; reached via the footer
"Sign in" link.
```

- [ ] **Step 4: Build the web app (build-safety, no `LOGTO_*` set)**

Run (ensure `LOGTO_*` are NOT set in the shell):
```bash
pnpm exec turbo run build --filter=web
```
Expected: PASS — the build completes with no `LOGTO_*` env (proves lazy config + `force-dynamic`). If it fails on `@logto/next` resolution, add `"@logto/next"` to `transpilePackages` in `web/next.config.ts` and rebuild.

- [ ] **Step 5: Commit**

```bash
git add web/app/account/page.tsx web/app/page.tsx docs/style-guide.md web/next.config.ts
git commit -m "feat(web): add /account BFF page, landing sign-in link, style guide"
```

---

## Task 7: Infra — web pod env + deploy secrets

**Files:**
- Modify: `infra/k8s/web.yaml` (env)
- Modify: `.github/workflows/deploy.yml` (secret keys + export)
- Modify: `infra/k8s/secrets.yaml` (document keys)

**Interfaces:**
- Produces: the running web pod's `LOGTO_*` + `LOG_LEVEL`/`LOG_FORMAT` env. Non-secret via envsubst; `LOGTO_APP_SECRET`/`LOGTO_COOKIE_SECRET` via `secretKeyRef`.

- [ ] **Step 1: Add env to the web Deployment**

In `infra/k8s/web.yaml`, replace the single-entry `env:` block (currently just `NEXT_PUBLIC_API_BASE_URL`) with:

```yaml
          env:
            # NEXT_PUBLIC_* is inlined at BUILD time (Dockerfile build-arg); this runtime
            # entry only helps server-side reads.
            - name: NEXT_PUBLIC_API_BASE_URL
              value: "https://api.${DOMAIN}"
            # Logto SDK (server-side runtime). Non-secret values via envsubst:
            - name: LOGTO_ENDPOINT
              value: "https://auth.${DOMAIN}"
            - name: LOGTO_BASE_URL
              value: "https://${DOMAIN}"
            - name: LOGTO_APP_ID
              value: "${LOGTO_APP_ID}"
            # Secrets via k8s Secret (never envsubst'd into rendered YAML):
            - name: LOGTO_APP_SECRET
              valueFrom:
                secretKeyRef:
                  name: fountainrank-secrets
                  key: logto-app-secret
            - name: LOGTO_COOKIE_SECRET
              valueFrom:
                secretKeyRef:
                  name: fountainrank-secrets
                  key: logto-cookie-secret
            - name: LOG_LEVEL
              value: "info"
            - name: LOG_FORMAT
              value: "json"
```

- [ ] **Step 2: Create the two secret keys in deploy.yml**

In `.github/workflows/deploy.yml`, the **"Create app + registry secrets imperatively"** step — add to its `env:` block:

```yaml
          LOGTO_APP_SECRET: ${{ secrets.LOGTO_APP_SECRET }}
          LOGTO_COOKIE_SECRET: ${{ secrets.LOGTO_COOKIE_SECRET }}
```

and add these two lines to the `kubectl create secret generic fountainrank-secrets` command (before `--dry-run=client`):

```bash
            --from-literal=logto-app-secret="$LOGTO_APP_SECRET" \
            --from-literal=logto-cookie-secret="$LOGTO_COOKIE_SECRET" \
```

- [ ] **Step 3: Export `LOGTO_APP_ID` for the manifest apply**

In the **"Render + apply workloads"** step, add to its `env:` block:

```yaml
          LOGTO_APP_ID: ${{ vars.LOGTO_APP_ID }}
```

and add `LOGTO_APP_ID` to the `export` line so `envsubst` substitutes it into `web.yaml`:

```bash
          export NAMESPACE ENVIRONMENT IMAGE_TAG REGISTRY DOMAIN GOOGLE_DELEGATED_USER FROM_EMAIL LOGTO_APP_ID
```

(`LOGTO_ENDPOINT`/`LOGTO_BASE_URL` derive from the already-exported `DOMAIN`.)

- [ ] **Step 4: Document the keys in secrets.yaml**

In `infra/k8s/secrets.yaml`, add `logto-app-secret` and `logto-cookie-secret` to the documented key inventory, following the existing comment/format used for `logto-email-webhook-token`.

- [ ] **Step 5: Validate manifests**

Run: `powershell.exe -NoProfile -File run.ps1 check` (the infra/kubeconform portion) or the repo's manifest-validation command.
Expected: `web.yaml` passes `kubeconform`; envsubst with the new vars renders valid YAML; no secret literals appear in rendered/committed YAML.

- [ ] **Step 6: Commit**

```bash
git add infra/k8s/web.yaml .github/workflows/deploy.yml infra/k8s/secrets.yaml
git commit -m "build(infra): inject Logto + log env into web pod; deploy secret keys"
```

---

## Task 8: Docs — runbooks + local-dev env

**Files:**
- Modify: `claude_help/oauth-sso.md`
- Modify: `docs/setup/06-logto.md`

- [ ] **Step 1: Document the web BFF pattern + env**

In `claude_help/oauth-sso.md`, under the **Web** bullet (or a new "Web (Phase 2) — implemented" subsection), record: `@logto/next` App Router, server-side BFF (token via `getAccessTokenRSC`, never sent to the browser), encrypted httpOnly session, and the **env var names** (no values): `LOGTO_ENDPOINT`, `LOGTO_BASE_URL`, `LOGTO_APP_ID`, `LOGTO_APP_SECRET`, `LOGTO_COOKIE_SECRET` (≥32 chars), `LOG_LEVEL`/`LOG_FORMAT`, and build-time `NEXT_PUBLIC_API_BASE_URL`. Note local dev sets these in the shell (port 3020, redirect `http://localhost:3020/callback`) — **never a `.env` file**.

- [ ] **Step 2: Confirm web redirect URIs + add the owner GitHub-secret task**

In `docs/setup/06-logto.md`, confirm the web app's redirect URIs (`http://localhost:3020/callback`, `https://fountainrank.com/callback`) and post-sign-out (`https://fountainrank.com`), and add an owner task: set the **real** `LOGTO_APP_ID` (GitHub `production` var) + `LOGTO_APP_SECRET` + a ≥32-char `LOGTO_COOKIE_SECRET` (GitHub `production` secrets), replacing the Phase 2a placeholders, before the next deploy.

- [ ] **Step 3: Commit**

```bash
git add claude_help/oauth-sso.md docs/setup/06-logto.md
git commit -m "docs: record web Logto BFF integration + owner secret tasks"
```

---

## Task 9: Full local gate, PR, and live verification

- [ ] **Step 1: Run the full local CI mirror**

Run: `powershell.exe -NoProfile -File run.ps1 check`
Expected: backend (107 tests: 105 + 2 new) green; `workspace-js` (web + api-client lint/typecheck/build/test) green. If the web mirror fails only on the known Windows `eslint-config-next` resolution artifact, note it and rely on CI.

- [ ] **Step 2: Live verification (owner-assisted, pre-merge)**

With the owner exporting the real `LOGTO_*` in the shell and `NEXT_PUBLIC_API_BASE_URL=https://api.fountainrank.com`, run `pnpm --filter web dev` (port 3020), open `http://localhost:3020/account`, sign in (Google or email). Confirm:
- the **web server log** shows the `/account` request + a `GET /api/v1/me 200` round-trip (no token material), and the **backend access log** shows the same `GET /api/v1/me 200` (correlated by `X-Request-ID`); and
- the **browser network panel shows NO `Authorization`-bearing call** to `api.fountainrank.com` — only the `/account` document/RSC payload. A browser-side `/api/v1/me` call is a failure (broken token boundary).

- [ ] **Step 3: Push + open the PR**

```bash
git push -u origin feat/web-logto-auth
gh pr create --base main --title "feat: web Logto auth (Next.js SDK, BFF) + GET /api/v1/me" --body-file <pr-body>
```

- [ ] **Step 4: CI green, then Codex Loop B**

Get CI green, then run the Codex PR review loop (`claude_help/codex-review-process.md`) until `VERDICT: APPROVED`; address every PR comment. Squash-merge once CI is green, Codex approved, and all comments addressed.

---

## Self-Review

**Spec coverage:** §4.1 `/me` → Task 1. §4.2 config → Task 2. §4.3 callback/actions/buttons → Task 5. §4.4 BFF data layer → Task 4. §4.5 `/account` + landing → Task 6. §4.6 infra → Task 7. §4.7 local dev → Task 8. §4.8 logger → Task 3. §4.9 deps → Task 2. §5 error handling → Tasks 1/5/6. §6 testing + live verification → Tasks 1–4, 9. §7 acceptance → all. §8 owner tasks → Task 8. No gaps.

**Type consistency:** `getLogtoConfig` (Tasks 2,4,5,6), `getAuthedApiClient(requestId)` (Tasks 4,6), `authedClientHeaders(token, requestId)` (Task 4), `log(level, msg, fields?, env?)` + `redact` (Tasks 3,5,6), `signInAction`/`signOutAction` (Tasks 5,6), `MeResponse` ↔ `client.GET("/api/v1/me")` returning `display_name`/`email` (Tasks 1,6) — all consistent.
