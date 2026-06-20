# Phase 2 (web) — Logto Next.js auth + `/api/v1/me` (design)

**Date:** 2026-06-19
**Status:** Proposed (brainstormed + owner-approved; pending Codex Loop A)
**Relates to:** spec `2026-06-16-architecture-and-foundation-design.md` §10 (auth), §14
(frontend); `claude_help/oauth-sso.md`; `docs/setup/06-logto.md`; the Phase 2a backend JWT
seam (`docs/specs/2026-06-19-phase-2a-logto-infra-and-backend-jwt-design.md`,
`backend/app/logto_auth.py` + `backend/app/auth.py`).
**Builds on:** Phase 2a (backend validates Logto resource JWTs; writes closed in prod until a
client mints one). This sub-project stands up the **web** client that mints that token, so a
real Logto JWT round-trips and write endpoints become reachable from the browser.
**Out of scope here:** mobile RN SDK, Apple-specific app work, and the fountains/map/rating
product UI — each a later, separate spec.

---

## 1. Goal

Make the **web app** (`web/`) a real Logto OIDC client so an authenticated user obtains a
backend **resource JWT** (`aud=https://api.fountainrank.com`) and the backend accepts it —
proving end-to-end that writes are unblocked. Concretely:

1. Integrate the **Logto Next.js SDK** (`@logto/next`, App Router): auth-code + PKCE sign-in,
   sign-out, and an **encrypted server-side session cookie** (httpOnly).
2. Establish the **server-side (BFF) token convention**: the Logto access token is obtained
   and used **only server-side** and attached to backend calls server-to-server. The browser
   never receives the access token (XSS-safe; matches §10 "session cookies server-side").
3. Add **`GET /api/v1/me`** to the backend (the §10 "current user profile" endpoint earmarked
   for Phase 2) as the side-effect-free round-trip target.
4. Render the signed-in user on an **`/account`** page that calls `/api/v1/me` through the BFF
   — the demonstrable proof the token is minted, sent, validated, and the user provisioned.
5. Wire the web pod's **`LOGTO_*` runtime env** (manifest + `deploy.yml`), keeping secrets in
   the k8s Secret and out of the build and out of the repo.

## 2. Background — verified state (2026-06-19)

- **Web app** (`web/`): Next.js `16.2.9` (App Router), React `19.2.7`, Tailwind 4. Pages today
  are a static landing (`app/page.tsx`, "Coming soon"), `app/privacy`, `app/terms`. It runs as
  a **Node server** in prod (`web/Dockerfile` runner = `next start -p 3000`), so server
  actions / route handlers / server session cookies are supported.
- **No backend calls exist yet.** `web/lib/api.ts` wraps `@fountainrank/api-client`
  (`makeClient(baseUrl, options?)`, an `openapi-fetch` client) and reads
  `NEXT_PUBLIC_API_BASE_URL` (default `http://localhost:3021`), but **no page calls it** — so
  there is **no existing browser-vs-server data-fetch convention to preserve**; this spec sets
  it (server-side/BFF).
- **api-client** (`packages/api-client/src/index.ts`): `makeClient(baseUrl, options?)` forwards
  `options` (incl. `headers`) to `openapi-fetch`'s `createClient`. Its `schema.d.ts` is
  generated from the backend OpenAPI by `pnpm run generate`; adding `/api/v1/me` regenerates a
  typed `client.GET("/api/v1/me")`.
- **Backend** (Phase 2a): `get_current_user` is a dual-path resolver — a valid
  `Authorization: Bearer <Logto resource JWT>` (validated in `app/logto_auth.py` against JWKS,
  `iss`/`aud`/`exp`, ES384 allowlist) → real path; `X-Dev-User` → dev path only when
  `dev_auth_enabled` (`False` in prod). `get_or_create_user` JIT-provisions `User`
  (`logto_user_id`=`sub`, with safe `email`/`display_name` fallbacks). `User` columns:
  `id` (uuid), `logto_user_id` (unique), `display_name`, `email`, `avatar_url` (nullable),
  `is_admin` (bool), `created_at`. **`/api/v1/me` does not exist yet.**
- **CORS** (`backend/app/config.py`): `cors_allow_origins` already includes
  `https://fountainrank.com`, `https://www.fountainrank.com`, `http://localhost:3020`. (With
  the BFF pattern, authenticated calls are server-to-server and do **not** rely on CORS; CORS
  remains for any future browser-direct public reads.)
- **Logto admin state (owner-confirmed 2026-06-19):** the **API Resource**
  `https://api.fountainrank.com` is registered; the **web "Traditional Web" app** is registered
  with real `App ID`/secret + redirect URIs `http://localhost:3020/callback` and
  `https://fountainrank.com/callback` (post-sign-out `https://fountainrank.com`); Google + Apple
  social and email connectors are configured. **Gap:** the GitHub `production` env still holds
  **placeholder** `LOGTO_APP_ID` (var) and `LOGTO_APP_SECRET`/`LOGTO_COOKIE_SECRET` (secrets)
  per the Phase 2a handoff — these must hold the **real** values before the prod deploy works
  (owner task, §8).
- **Infra:** `web/Dockerfile` already declares `ARG NEXT_PUBLIC_API_BASE_URL` and
  `deploy.yml` already builds with `--build-arg NEXT_PUBLIC_API_BASE_URL="https://api.${DOMAIN}"`.
  `infra/k8s/web.yaml` currently injects **only** `NEXT_PUBLIC_API_BASE_URL` at runtime and **no
  `LOGTO_*`**. `deploy.yml` creates `fountainrank-secrets` imperatively (`--from-literal …`) and
  applies `backend web logto ingress` via `envsubst`.
- **`@logto/next` (App Router) shape** (Context7-verified): `logtoConfig: LogtoNextConfig`
  (`endpoint`, `appId`, `appSecret`, `baseUrl`, `cookieSecret`, `cookieSecure`, `resources`);
  callback route handler calls `handleSignIn(logtoConfig, searchParams)`; server actions
  `signIn`/`signOut`/`getLogtoContext`/`getAccessToken(logtoConfig, resource)` from
  `@logto/next/server-actions`; sign-in/out are triggered from `'use client'` components that
  invoke the server actions.

## 3. Scope

**In scope**

- Backend: `GET /api/v1/me` (auth-required) + response schema + tests; OpenAPI/api-client
  regeneration.
- Web: `@logto/next` integration — `logtoConfig`, callback route, sign-in/sign-out, server
  session; a server-only authed api-client helper (BFF token injection); an `/account` page
  that renders the signed-in user via `/api/v1/me`; a discreet "Sign in" link in the landing
  footer; sign-in/out UI components; web env wiring.
- Infra: `infra/k8s/web.yaml` `LOGTO_*` runtime env (envsubst for non-secret, `secretKeyRef`
  for secrets); `deploy.yml` two new `--from-literal` secret keys + exported non-secret vars;
  `infra/k8s/secrets.yaml` documentation.
- Docs: `docs/style-guide.md` (auth UI elements), `claude_help/oauth-sso.md` (web BFF pattern +
  env), `docs/setup/06-logto.md` (confirm web redirect URIs + the GitHub-secret update task),
  `web` local-dev env-var documentation (var **names** only, never a `.env` file).

**Out of scope** (later specs / owner actions)

- Mobile RN SDK; Apple sign-in app wiring; the fountains/map/detail/rating/photo product UI.
- Profile **sync on subsequent logins** (an existing user's `email`/`name` is not updated;
  inherited Phase 2a limitation), `/oidc/userinfo` backfill, custom claims, roles/orgs.
- Browser-direct public reads / a public data layer (no public read endpoint is wired here).
- Flipping `dev_auth_enabled`, tagging/deploying a release, or editing GitHub secrets
  (owner actions).

## 4. Design

### 4.1 Backend — `GET /api/v1/me`

New router `backend/app/routers/users.py`, mounted under the existing `/api/v1` prefix:

- `GET /api/v1/me` with `current_user: Annotated[User, Depends(get_current_user)]`.
- Response model `MeResponse` (Pydantic, `from_attributes`): `id` (uuid→str), `display_name`,
  `email`, `avatar_url` (`str | None`), `is_admin` (bool), `created_at` (datetime). **Excludes
  `logto_user_id`** (the Logto subject is an internal identity key, not user-facing payload).
- Behaviour: `401` when no/invalid credential (handled entirely by the Phase 2a resolver —
  reads stay public, this route does not); `200` with the profile otherwise; never `500`.
- Logged at `INFO`/`DEBUG` with the **validated** `sub`/user id only (per the Phase 2a logging
  rule), reusing the existing request-id-stamped logging — no token material.

Regenerate `packages/api-client` (`pnpm run generate`) so the web gets a typed
`GET("/api/v1/me")` and the committed `openapi.json`/`schema.d.ts` reflect the new path.

### 4.2 Web — Logto config (`web/lib/logto.ts`)

```ts
import { LogtoNextConfig } from "@logto/next";

export const logtoConfig: LogtoNextConfig = {
  endpoint: requireEnv("LOGTO_ENDPOINT"),          // https://auth.fountainrank.com
  appId: requireEnv("LOGTO_APP_ID"),
  appSecret: requireEnv("LOGTO_APP_SECRET"),
  baseUrl: requireEnv("LOGTO_BASE_URL"),           // https://fountainrank.com | http://localhost:3020
  cookieSecret: requireEnv("LOGTO_COOKIE_SECRET"), // >= 32 chars
  cookieSecure: process.env.NODE_ENV === "production",
  resources: ["https://api.fountainrank.com"],     // mint the backend resource JWT
};
```

`requireEnv` throws a clear server-side error naming the missing var (fail-fast on
misconfiguration; never logs the value). The `resources` entry is what makes `getAccessToken`
return a JWT with the `aud` the backend validates.

### 4.3 Web — callback + sign-in/out

- `web/app/callback/route.ts`: `GET` → `await handleSignIn(logtoConfig, request.nextUrl.searchParams)`
  then `redirect("/account")`. On a `handleSignIn` error (e.g. state/PKCE mismatch), redirect to
  `/account?error=signin` (no token/exception detail leaked to the client) and `console.warn`
  the reason server-side.
- `web/app/actions/auth.ts` (`"use server"`): thin `signInAction()` →
  `signIn(logtoConfig, \`${logtoConfig.baseUrl}/callback\`)` and `signOutAction()` →
  `signOut(logtoConfig)`; centralizes the redirect URIs.
- `web/components/SignInButton.tsx` / `SignOutButton.tsx` (`"use client"`): render a styled
  button whose `onClick`/form-action invokes the corresponding server action.

### 4.4 Web — server-only BFF data layer (`web/lib/server/api.ts`)

```ts
import "server-only";
import { getAccessToken } from "@logto/next/server-actions";
import { makeClient } from "@fountainrank/api-client";
import { logtoConfig } from "../logto";
import { resolveApiBaseUrl } from "../api";

export async function getAuthedApiClient() {
  const token = await getAccessToken(logtoConfig, "https://api.fountainrank.com");
  return makeClient(resolveApiBaseUrl(), { headers: { Authorization: `Bearer ${token}` } });
}
```

`import "server-only"` guarantees a build error if this module is ever pulled into a client
bundle (defense-in-depth: the token cannot leak to the browser). The SDK refreshes the access
token as needed; calling per request is correct. A non-authed `makeClient(resolveApiBaseUrl())`
remains available for future public reads.

### 4.5 Web — `/account` page + landing link

- `web/app/account/page.tsx` (server component): `const { isAuthenticated } =
  await getLogtoContext(logtoConfig, { fetchUserInfo: false })`.
  - **Not authenticated** → render `<SignInButton>` (+ short copy).
  - **Authenticated** → `const { data, error } = await (await getAuthedApiClient()).GET("/api/v1/me")`;
    render the profile (`display_name`, `email`, `avatar_url`) + `<SignOutButton>`. On `error`
    (non-200), render a graceful "couldn't load your profile" state + `<SignOutButton>`, and
    `console.error` the status server-side (no token).
- `web/app/page.tsx`: add one discreet **"Sign in"** `Link` to `/account` in the existing
  footer (alongside Privacy/Terms). The marketing hero is otherwise untouched.

### 4.6 Env taxonomy & infra wiring

| Var | Kind | Source → web pod |
|---|---|---|
| `NEXT_PUBLIC_API_BASE_URL` | build-time, public | already: Dockerfile `ARG` + `deploy.yml --build-arg` (`https://api.${DOMAIN}`) |
| `LOGTO_ENDPOINT` | runtime, non-secret | `web.yaml` env `https://auth.${DOMAIN}` (envsubst) |
| `LOGTO_BASE_URL` | runtime, non-secret | `web.yaml` env `https://${DOMAIN}` (envsubst) |
| `LOGTO_APP_ID` | runtime, non-secret | `web.yaml` env `${LOGTO_APP_ID}` (envsubst from GitHub `production` var) |
| `LOGTO_APP_SECRET` | runtime, **secret** | `fountainrank-secrets` → `secretKeyRef` |
| `LOGTO_COOKIE_SECRET` | runtime, **secret** | `fountainrank-secrets` → `secretKeyRef` |

- `infra/k8s/web.yaml`: add the four non-secret `env` entries (envsubst) + two `secretKeyRef`
  entries; secrets never appear in rendered YAML.
- `deploy.yml`: in the `fountainrank-secrets` create step add
  `--from-literal=logto-app-secret="$LOGTO_APP_SECRET"` and
  `--from-literal=logto-cookie-secret="$LOGTO_COOKIE_SECRET"` (env from `secrets.LOGTO_APP_SECRET`
  / `secrets.LOGTO_COOKIE_SECRET`); export `LOGTO_APP_ID` (from `vars.LOGTO_APP_ID`) for the
  `envsubst` apply step. `LOGTO_ENDPOINT`/`LOGTO_BASE_URL` derive from `DOMAIN` in the manifest.
- `infra/k8s/secrets.yaml`: document the two new secret keys.
- **k8s secret reality** (carried from Phase 2a): `fountainrank-secrets` is recreated at each
  deploy from GitHub secrets — changing a GitHub secret takes effect only on the next `v*.*.*`
  deploy.

### 4.7 Local dev

`web` dev runs on **port 3020** (`next dev -p 3020`); Logto redirect `http://localhost:3020/callback`
is already registered. The owner exports the real values in their shell before running the dev
server / `run.ps1`:

```
LOGTO_ENDPOINT=https://auth.fountainrank.com
LOGTO_BASE_URL=http://localhost:3020
LOGTO_APP_ID=<real>
LOGTO_APP_SECRET=<real>
LOGTO_COOKIE_SECRET=<at least 32 chars>
NEXT_PUBLIC_API_BASE_URL=https://api.fountainrank.com   # or a local backend
```

These are read from `process.env` (no Next.js `.env*` file). **This spec never creates or
writes a `.env` file**; only the variable **names** are documented (in `claude_help/oauth-sso.md`
+ `docs/setup/06-logto.md`).

## 5. Error handling

- `GET /api/v1/me`: `401` for any missing/invalid credential (Phase 2a resolver), `200`
  otherwise, never `500`.
- Web callback: `handleSignIn` failure → safe redirect (`/account?error=signin`), server log at
  `warn`, no exception/token detail to the client.
- Web `/account`: a failed `/api/v1/me` (non-200 or thrown `getAccessToken`) renders a graceful
  state + sign-out; server logs the status only.
- **Never log** access tokens, ID tokens, the session cookie, `cookieSecret`, `appSecret`, or
  full JWTs anywhere (web stdout is DOKS-captured). `requireEnv` failures name the missing var,
  not any value.

## 6. Testing & verification

**Backend** — `backend/tests/test_me.py` (no network): `GET /api/v1/me` returns the provisioned
user (test overrides `get_current_user`, as the existing API tests do) and asserts the field set
incl. **absence of `logto_user_id`**; without a credential → `401`. Existing 105 backend tests
stay green. Local gate: `run.ps1 check -Backend`.

**Web** — `vitest` pure-function tests (no browser, no live Logto — the honest CI limitation
inherited from Phase 2a):
- `logtoConfig` is built from env with `resources` set and `cookieSecure` reflecting
  `NODE_ENV`; `requireEnv` throws naming a missing var.
- `getAuthedApiClient` attaches `Authorization: Bearer <token>` (mock `getAccessToken`) and
  targets `resolveApiBaseUrl()`.
- Existing `web/lib/api.test.ts` stays green.

**CI mirror:** `workspace-js` (lint + typecheck + build + vitest for `web` + `api-client`) and
`backend` green; `pnpm-audit`/`pip-audit`/`trivy-fs`/CodeQL green; no new deps with known CVEs.

**Live verification before merge (owner-assisted):** with the real `LOGTO_*` exported, run the
web app locally against `auth.fountainrank.com`, sign in (Google or email), and confirm:
`/account` renders the real profile **and** `/api/v1/me` returned `200` (observed in the network
panel / server log). This is the genuine end-to-end proof CI cannot do; it is a documented
pre-merge step, not a CI gate.

## 7. Acceptance criteria

1. `GET /api/v1/me` returns the authenticated user's profile (`200`, no `logto_user_id`) and
   `401` without a valid credential; `test_me.py` + the existing suite pass under `run.ps1 check`.
2. `web/` integrates `@logto/next`: sign-in/sign-out work, the session is an encrypted httpOnly
   cookie, and `/account` renders the signed-in user via a **server-side** `/api/v1/me` call;
   the access token is never exposed to the browser (`server-only` guard present).
3. `infra/k8s/web.yaml` injects `LOGTO_*` (non-secret via envsubst, secrets via `secretKeyRef`);
   `deploy.yml` creates the two secret keys + exports the non-secret var; manifests pass
   `kubeconform`; no secret appears in the repo or in rendered YAML.
4. Docs updated: `docs/style-guide.md` (auth UI elements), `claude_help/oauth-sso.md`,
   `docs/setup/06-logto.md`; local-dev env documented by name only; no `.env` written; no AI
   attribution; no time estimates.
5. **Live pre-merge round-trip verified** (§6): real sign-in → `/api/v1/me` `200`.
6. CI green + Codex `VERDICT: APPROVED` (Loop A on this spec, Loop B on the PR) + every PR
   comment addressed → squash-merge.

## 8. Owner tasks (before the prod deploy works)

1. Set the **real** `LOGTO_APP_ID` (GitHub `production` **var**) and `LOGTO_APP_SECRET` +
   `LOGTO_COOKIE_SECRET` (≥32 chars) (GitHub `production` **secrets**), replacing the Phase 2a
   placeholders.
2. Decide to deploy (tag a `v*.*.*` release) so the new web env + `/api/v1/me` go live; then
   re-verify the round-trip in prod (`https://fountainrank.com/account`).

## 9. Risks / open points

- **Secret values in GitHub are placeholders** until §8.1 — a prod deploy before that yields a
  web pod that fails `requireEnv` (fail-fast, visible in logs) rather than a silent broken
  session. Called out, not hidden.
- **No end-to-end token test in CI** (no live Logto in CI) — same honest limitation as Phase 2a;
  mitigated by the pre-merge live verification (§6).
- **Session-cookie size:** Logto stores tokens in the encrypted cookie; with one API resource
  the cookie stays well within limits. If future resources/claims bloat it, revisit a
  server-side session store — not needed now.
- **`@logto/next` + Next 16 / React 19 compatibility:** pin the latest stable `@logto/next` at
  plan time and confirm `workspace-js` build is green; if `transpilePackages` is needed for the
  SDK, add it in `next.config.ts` (it already transpiles `@fountainrank/api-client`).
</content>
</invoke>
