# Authentication & SSO (Logto)

FountainRank uses **self-hosted Logto** as the OIDC identity authority. See spec
§10 for the design.

## Architecture

- **Logto** runs in the cluster (its own Deployment + Service + Ingress on an
  `auth.` subdomain) with its own Postgres database. It owns the login UI,
  social SSO, email magic link, sessions, and token rotation.
- **Connectors:** Google, Apple, and email magic link (passwordless). Email is
  delivered via the Gmail-API connector — see `email.md`.
- **Web** (`web/`): Logto Next.js SDK, OIDC auth-code + PKCE, server-side session
  cookies.
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
