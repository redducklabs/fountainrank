# User profile sync — real email/name/avatar from social logins (design)

**Date:** 2026-06-19
**Status:** Proposed (brainstormed + owner-approved; pending Codex Loop A)
**Relates to:** `docs/specs/2026-06-19-web-logto-auth-design.md` (web Logto BFF, shipped `v0.4.0`);
the Phase 2a backend JWT seam (`backend/app/auth.py`, `app/logto_auth.py`, `app/config.py`);
`claude_help/oauth-sso.md`.
**Fixes the deliberately-deferred limitation** from Phase 2a §3/§4.5/§8: "updating an existing
user's profile on subsequent logins" and "`/oidc/userinfo` backfill" were out of scope; the web
client now exists and surfaced the gap (the backend shows a synthetic email/name because the
resource access token carries only `sub`).

---

## 1. Goal & scope

On login, have the **backend** learn the user's **real** `email`, `name`, and `avatar` from
Logto (sourced from the social connector profile) and store them on the `User` record, replacing
the synthetic fallbacks — so `/account`, and anywhere the backend exposes a user, shows real data.

**In scope:** web (`web/`) + backend (`backend/`). **Out of scope:** mobile (a later spec — it
will reuse the same backend sync endpoint by forwarding its own opaque token); copying avatars
into our own storage (we store the external avatar URL); per-field consent/privacy UI.

## 2. Background — verified state (2026-06-19)

- **Why the wrong values show:** `/account` renders what `GET /api/v1/me` returns. The backend
  builds that `User` in `get_current_user` (`backend/app/auth.py`) from the **resource access
  token** (`aud=https://api.fountainrank.com`), which by OIDC design carries only `sub` — not
  `email`/`name`/`picture`. So it applied NOT-NULL fallbacks: `email =
  f"{sub}@users.noreply.fountainrank.com"`, `display_name = name|username|sub`. `avatar_url` is
  never set. `get_or_create_user` is **INSERT-only** (race-safe `ON CONFLICT DO NOTHING`); it
  never updates an existing user.
- **The profile lives in the ID token / userinfo, not the resource token** (Context7-verified).
  With the `email`+`profile` scopes, Logto's ID token / userinfo carry `email`, `name`, `picture`.
- **The backend cannot call userinfo with the request's token** (Context7-verified): Logto's
  userinfo (`/oidc/me`) requires the **opaque** access token, **not** the resource JWT. The
  backend only receives the resource JWT, so it must be given the opaque token to call userinfo.
- **`@logto/next` exposes no raw ID-token string** (verified in the installed
  `@logto/node@3.1.10` `LogtoContext`: `isAuthenticated`, `claims?`, `accessToken?`, `userInfo?`,
  `scopes?`) — only decoded `claims` and the opaque `accessToken`. Hence the chosen mechanism is
  "forward the opaque token; the backend calls userinfo" (backend-authoritative, not trust-client).
- **Web config today** (`web/lib/logto.ts`): `resources: [API_RESOURCE]`, **no `scopes`**. The
  callback (`web/app/callback/route.ts`) is a route handler. `/account` is a `force-dynamic`
  server component reading `GET /api/v1/me`; it already conditionally renders an avatar `<img>`.
- **Backend config** (`app/config.py`): `logto_endpoint`; derived `logto_issuer =
  f"{logto_endpoint.rstrip('/')}/oidc"`, `logto_jwks_uri = f"{logto_issuer}/jwks"`. `User`
  columns: `id`, `logto_user_id` (=sub), `display_name`, `email`, `avatar_url` (nullable),
  `is_admin`, `created_at`. M2M creds exist but are **not** used by this design.
- **Owner already fixed** the Google connector scopes to `openid profile email` (so Logto now has
  the Google email/name/avatar to hand out).

## 3. Design

### 3.1 Web — request the profile scopes (`web/lib/logto.ts`)

Add the profile scopes to `getLogtoConfig`:

```ts
import { UserScope } from "@logto/next";   // re-exported enum; or the string literals "email","profile"
// ...
scopes: [UserScope.Email, UserScope.Profile],
resources: [API_RESOURCE],
```

This makes the session's tokens grant `email`/`name`/`picture` at userinfo. (No other web config
change; the cookie/secret/build-safety design is unchanged.)

### 3.2 Web — sync on login from the callback (`web/app/callback/route.ts`)

After `handleSignIn` succeeds (and before the redirect), do a **best-effort** profile sync — a
mutation, correctly placed in the route handler (keeps `/account` a pure read). The callback (a
route handler, so it uses `getAccessToken`, not the RSC variant):

1. `const resourceToken = await getAccessToken(config, API_RESOURCE)` — to authenticate to the
   backend (the sync endpoint is auth-gated by the resource JWT, like every write).
2. `const opaqueToken = await getAccessToken(config)` — **no resource arg → the opaque,
   userinfo-capable access token** (plan-time: confirm a no-resource `getAccessToken` returns the
   opaque token given our scopes).
3. `POST {resolveApiBaseUrl()}/api/v1/me/sync` with `Authorization: Bearer ${resourceToken}` +
   `X-Request-ID` and JSON body `{ "userinfo_token": opaqueToken }`.

Wrapped in try/catch: **any failure logs (redacted, via the web logger) and is swallowed** —
sync never blocks the post-login redirect. Then `redirect("/account")` as today. (`handleSignIn`
failure path / NEXT_REDIRECT handling is unchanged.) A small `web/lib/server/sync.ts` helper
holds this so the route stays readable; it carries `import "server-only"`.

Because the callback always redirects to `/account`, every successful login both syncs the
profile **and** lands on the page that displays it — `/account` then renders the fresh stored
values via the unchanged `GET /api/v1/me`.

### 3.3 Backend — `POST /api/v1/me/sync` (`backend/app/routers/users.py`)

Auth-required (resource JWT, via the existing `get_current_user` dependency — so it also JIT-
provisions the user on first sight, exactly as today). Request body `SyncProfileRequest`
(`backend/app/schemas.py`): `{ userinfo_token: str }` (min length 1). Flow:

1. **Call Logto userinfo** — `GET {logto_userinfo_uri}` with `Authorization: Bearer
   {userinfo_token}` via an injectable async `httpx` client (so tests supply a fake — same
   dependency-injection style as `JwksCache`'s fetch coroutine). `logto_userinfo_uri` is a new
   derived config: `f"{logto_issuer}/me"` (plan-time: confirm `/oidc/me` against the live
   discovery `userinfo_endpoint`). Parse `sub`, `email`, `name`, `username`, `picture`.
2. **Security cross-check (critical):** the userinfo `sub` **MUST equal**
   `current_user.logto_user_id` (= the validated resource-JWT `sub`). Otherwise **`403`** — a
   caller must not be able to write someone else's profile onto their own row (or vice-versa) by
   forwarding a mismatched opaque token. Logged at `WARNING` (reason + both subs are the same
   validated identity space; never the tokens).
3. **Update the row** (`current_user` is already attached to the request session — mutate +
   flush/commit; no new upsert function, no `get_or_create_user` change needed):
   - `email` ← userinfo `email` **if present** (else leave the existing value — never overwrite a
     real email with nothing; this is also what self-heals older synthetic rows).
   - `display_name` ← `name` or `username` or the existing `display_name` or `sub`.
   - `avatar_url` ← `picture` (or leave/`None`).
4. Return the updated `MeResponse` (existing schema; already includes `avatar_url`).

`get_or_create_user` stays INSERT-only and unchanged; the **update** is localized to this
endpoint (mutating the already-loaded `current_user`). This is the deliberate lift of Phase 2a's
"don't update an existing user's profile" limitation, scoped to this explicit sync.

### 3.4 Data, self-healing, freshness

- `avatar_url` stores the **external** avatar URL (e.g. `lh3.googleusercontent.com/...`) — no
  copy into Spaces; `/account` renders it directly. (Avatar-hosting/proxy is a possible later
  concern, explicitly out of scope.)
- **Self-healing:** users provisioned earlier with a synthetic email get the real email on their
  next login's sync (it overwrites). No migration/backfill needed.
- **Freshness:** sync runs on every login (callback → every login lands on `/account`). Profile
  changes in the social account propagate on the next login.

## 4. Error handling

- `POST /api/v1/me/sync`: missing/invalid resource JWT → `401` (existing resolver); malformed body
  (no `userinfo_token`) → `422`; userinfo `sub` ≠ caller `sub` → `403`; userinfo unreachable /
  non-200 / unparseable → `502` (logged `WARNING`, never the token); success → `200` + `MeResponse`.
  No silent `500` for these expected failures; unexpected errors keep the centralized 500 path.
- Web callback sync is **best-effort**: on any non-200 / network error it logs (redacted) and
  proceeds to redirect — a sync failure never blocks login.
- **Never log** the opaque token, the resource token, the full userinfo response, or any secret —
  redact (reuse `web/lib/server/log.ts` on the web side; the backend's existing
  request-id-stamped logging + no-token rule on the backend side). Backend logs the **validated**
  `sub` only on success.

## 5. Testing

**Backend** (`backend/tests/test_me_sync.py`, no network — inject a fake userinfo client):
- success: userinfo returns `{sub, email, name, picture}` matching the caller → row updated; the
  returned `MeResponse` carries the **real** email/name/avatar; `logto_user_id` still absent.
- **sub mismatch → `403`** (userinfo `sub` ≠ authenticated `sub`); the row is NOT modified.
- userinfo non-200 / network error → `502`; row unchanged.
- missing `name` → `display_name` falls back; missing `picture` → `avatar_url` stays null.
- missing `email` in userinfo → existing email preserved (not nulled/synthetic-overwritten).
- a previously-synthetic user is updated to the real email (self-heal).
- 401 without a credential. Existing suite (109 + Phase-2a tests) stays green.

**Web** (`vitest`): the sync helper posts to `/api/v1/me/sync` with the resource bearer + the
`userinfo_token` body (mock `getAccessToken`); a thrown/failed sync is swallowed (best-effort).
`getLogtoConfig` now includes the `email`/`profile` scopes (assert). Build-safety unchanged.

**Local gate:** `run.ps1 check -Backend` + the web checks; `pnpm run generate` regenerates the
api-client for the new `/api/v1/me/sync` path. Generated `openapi.json`/`schema.d.ts` stay
gitignored. Live proof is the post-deploy sign-in (now showing the real `aronweiler@gmail.com` +
name + avatar).

## 6. Acceptance criteria

1. `POST /api/v1/me/sync` calls Logto userinfo with the forwarded opaque token, **enforces the
   `sub` cross-check (`403` on mismatch)**, updates `email`/`display_name`/`avatar_url` from the
   real profile, returns `MeResponse`, and never `500`s on the expected failure modes; all §5
   backend tests pass under `run.ps1 check`.
2. `web/lib/logto.ts` requests the `email`+`profile` scopes; the callback best-effort-syncs on
   every login (failure never blocks the redirect); `/account` shows the real email/name/avatar.
3. No token/secret is logged anywhere; the opaque token travels only server-to-server (web BFF →
   backend), never to the browser. No `.env` written; no AI attribution; no time estimates.
4. CI green + Codex `VERDICT: APPROVED` (Loop A spec + plan, Loop B PR) + every PR comment
   addressed → squash-merge; owner-gated `v*.*.*` deploy.

## 7. Owner tasks

- **Done:** Google connector scopes `openid profile email`.
- Ensure the Google (and later Apple) connector's **"Sync profile information"** is enabled (so
  Logto keeps `name`/`avatar` populated on the user, which userinfo then returns). Verify a fresh
  login shows the real name + avatar after deploy.

## 8. Risks / open points

- **`getAccessToken(config)` (no resource) returning a userinfo-capable opaque token** is assumed;
  verified at plan/impl time. If the SDK won't yield it, fall back to forwarding the decoded
  `claims` (trust-the-first-party-BFF) — a documented contingency, not the default.
- **Userinfo path** (`/oidc/me` vs `/oidc/userinfo`): derived as `{logto_issuer}/me`; confirmed
  against the live discovery `userinfo_endpoint` at impl time (endpoints are HTTPS since Phase 2a).
- **Sync on relogin only** (not real-time): a profile change in Google shows after the next login.
  Acceptable; real-time sync is out of scope.
- **Email-only accounts** (magic-link, no name/avatar): `display_name` falls back, `avatar_url`
  stays null — correct and expected.
