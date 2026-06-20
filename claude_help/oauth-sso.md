# Authentication & SSO (Logto)

FountainRank uses **self-hosted Logto** as the OIDC identity authority. See spec
§10 for the design.

## Architecture

- **Logto** runs in the cluster (its own Deployment + Service + Ingress on an
  `auth.` subdomain) with its own Postgres database. It owns the login UI,
  social SSO, email magic link, sessions, and token rotation.
- **Connectors:** Google, Apple, and email magic link (passwordless). Email is
  delivered via the Gmail-API connector — see `email.md`.
- **Web** (`web/`): `@logto/next` App Router SDK, OIDC auth-code + PKCE,
  encrypted httpOnly session cookie. Implemented as a **server-side BFF**: the
  access token for the API resource is fetched server-side via
  `getAccessTokenRSC` and **never sent to the browser** — `server-only` guards
  every file that touches it. See *Web BFF env vars* below.
- **Mobile** (`mobile/`): Logto React Native SDK with native OAuth (system
  browser via `expo-auth-session`; `expo-apple-authentication` for Apple) and
  secure token storage.
- **Backend** (`backend/`): validates Logto-issued JWT access tokens via JWKS —
  **verify `iss` and `aud`**. On first authenticated request, just-in-time
  provision a local `User` keyed by the Logto subject.

## Non-negotiables

- **NEVER** disable authentication or weaken TLS.
- **NEVER** self-mint symmetric (HS256) tokens or skip `id_token`/JWKS validation.
- **NEVER** commit secrets or `.env` files.
- Browsing fountains, map, detail, and leaderboards is **public**. Rating, adding
  fountains, and uploading photos **require auth**.

## Web BFF env vars (Phase 2 — implemented)

The following environment variables are required by the web app at **runtime**
(server-side). Set them in the shell for local dev; in production they come from
the k8s Secret / GitHub Environment (see `docs/setup/06-logto.md`).
**Never** set these in a `.env` file.

| Variable | Purpose |
|---|---|
| `LOGTO_ENDPOINT` | Logto tenant URL (`https://auth.fountainrank.com`) |
| `LOGTO_BASE_URL` | Web app's own base URL (e.g. `https://fountainrank.com`) |
| `LOGTO_APP_ID` | Logto web app's App ID (not a secret — GitHub `production` **variable**) |
| `LOGTO_APP_SECRET` | Logto web app's App Secret (GitHub `production` **secret**) |
| `LOGTO_COOKIE_SECRET` | Session-cookie encryption key — **≥ 32 chars** (GitHub `production` **secret**) |
| `LOG_LEVEL` | Logging level (e.g. `info`) |
| `LOG_FORMAT` | Log format (`json` in production) |

`NEXT_PUBLIC_API_BASE_URL` is a **build-time** env var (inlined by Next.js at
`next build`). For local dev use port **3020**; the Logto redirect URI must be
`http://localhost:3020/callback`.

## External registrations checklist

Mirror of spec §19 — action these as auth lands:

- **Google Cloud:** project; OAuth 2.0 clients for Web, iOS, Android (package
  name + SHA-1); OAuth consent screen. (Also the service account + Workspace
  domain-wide delegation for Gmail sending — see `email.md`.)
- **Apple Developer Program** (paid): App ID; **Sign in with Apple** (Services ID
  + key) wired into Logto; App Store Connect app record.
- **Logto:** application registrations — web app, native app, machine-to-machine;
  configure Google/Apple/email connectors; set redirect URIs per platform.
- **DNS:** `auth.fountainrank.com` record for the Logto endpoint.
