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
mutation correctly placed in the route handler (keeps `/account` a pure read). A **`server-only`**
helper `web/lib/server/sync.ts` (its first line is `import "server-only"`, asserted in its test —
the token must never enter a client-capable module) does, from the route handler (so it uses
`getAccessToken`, not the RSC variant):

1. `const resourceToken = await getAccessToken(config, API_RESOURCE)` — to authenticate to the
   backend (the sync endpoint is auth-gated by the resource JWT, like every write).
2. `const opaqueToken = await getAccessToken(config)` — **no resource arg → the default,
   userinfo-capable opaque access token** (the SDK's empty-resource token from the auth-code
   exchange). **This is a hard requirement, not an assumption** (see the §6.1 probe): if this
   token is not accepted by Logto userinfo in our setup, the build does **NOT** silently fall back
   to trusting client-supplied claims — the contingency is the still-backend-authoritative
   Management-API path (§8).
3. `POST {resolveApiBaseUrl()}/api/v1/me/sync` with `Authorization: Bearer ${resourceToken}` +
   `X-Request-ID: <uuid>` and JSON body `{ "userinfo_token": opaqueToken }`, via a plain
   **server-side `fetch`** (NOT the browser-exposed api-client).

Wrapped in try/catch: **any failure logs a structured, redacted warning** (request id + backend
status/error-class + the authenticated subject when available; NEVER the tokens or the callback
query string) via `web/lib/server/log.ts`, and is **swallowed** — sync never blocks the post-login
redirect. Then `redirect("/account")` as today (`handleSignIn`/NEXT_REDIRECT handling unchanged).

Because the callback always redirects to `/account`, a **successful** login sync both refreshes
the stored profile and lands on the page that displays it — `/account` renders the stored values
via the unchanged `GET /api/v1/me`. On a sync failure the user lands on `/account` still showing
the last-synced (possibly synthetic) values until a later successful sync — acceptable and
logged, **not** silently presented as guaranteed-fresh.

### 3.3 Backend — `POST /api/v1/me/sync` (`backend/app/routers/users.py`)

Auth-required via the existing `get_current_user` dependency (so it JIT-provisions on first sight
exactly as today). The route declares **both** `current_user: Annotated[User, Depends(get_current_user)]`
**and** `session: Annotated[AsyncSession, Depends(get_session)]` — FastAPI dependency caching makes
them share one session, so mutating `current_user` and committing persists (the existing write
routes follow this pattern; `get_session` does not auto-commit — we commit explicitly). Request
body `SyncProfileRequest` (`backend/app/schemas.py`): `{ userinfo_token: str = Field(min_length=1) }`.

Flow:

1. **Call Logto userinfo** — `GET settings.logto_userinfo_uri` (§3.5) with
   `Authorization: Bearer {userinfo_token}` via an **injectable async httpx client** (a module
   singleton overridable in tests — mirrors `JwksCache`'s injected fetch, so tests are
   network-free). Client guardrails: a short explicit **timeout (~5s)**, **`follow_redirects=False`**,
   a bounded JSON read; **never** put the token in exception messages or logs.
2. **Parse into a typed model** `UserinfoClaims` (Pydantic, `extra="ignore"`): `sub: str`
   (required, non-empty), `email: str | None`, `email_verified: bool | None`, `name: str | None`,
   `username: str | None`, `picture: str | None`. A non-200, network/timeout error, malformed
   JSON, or a missing/empty `sub` → **`502`** (logged `WARNING` with request id + reason, no
   token); the row is left unchanged.
3. **Security cross-check (critical):** `claims.sub` **MUST equal** `current_user.logto_user_id`
   (the validated resource-JWT `sub`); else **`403`**, row unchanged. (Prevents an authenticated
   caller writing another user's profile onto their row — or theirs onto another's — by forwarding
   a mismatched opaque token. A matched-token replay can only refresh the caller's own row.)
4. **Update the session-attached `current_user`** (then `await session.commit()` and
   `await session.refresh(current_user)`), applying these **normalization/acceptance rules**:
   - **email** — accept the userinfo email ONLY if, after `.strip()`, it is a syntactically valid
     non-empty address (lightweight check, no new dep: exactly one `@`, non-empty local + domain,
     no whitespace), is **not** our synthetic `@users.noreply.fountainrank.com` domain, and — when
     `email_verified` is present — it is `True` (an **absent** `email_verified` is accepted:
     Logto's social/magic-link emails are connector-verified; an explicit `False` is rejected).
     Otherwise **preserve the existing `email`** (never overwrite a real email with
     blank/invalid/synthetic/unverified). This is what self-heals older synthetic rows.
   - **display_name** — first **non-empty-after-trim** of: `name`, `username`, the existing
     `display_name`, `sub`.
   - **avatar_url** — set to `picture` ONLY if it is a non-empty `https://` URL ≤ 2048 chars; a
     blank/invalid/non-`https` `picture` → leave the existing `avatar_url` unchanged (do not clear).
5. Return the updated `MeResponse` (existing schema; already includes `avatar_url`).

`get_or_create_user` stays INSERT-only and unchanged; the **update** is localized here (mutating
the already-loaded `current_user`). This is the deliberate, scoped lift of Phase 2a's
"don't update an existing user's profile" limitation.

### 3.4 Data, self-healing, freshness

- `avatar_url` stores the **external** avatar URL (e.g. `lh3.googleusercontent.com/...`) — no
  copy into Spaces; `/account` renders it directly. (Avatar-hosting/proxy is a possible later
  concern, explicitly out of scope.)
- **Self-healing:** users provisioned earlier with a synthetic email get the real email on their
  next login's sync (it overwrites). No migration/backfill needed.
- **Freshness:** sync runs on every login (callback → every login lands on `/account`). Profile
  changes in the social account propagate on the next **successful** login sync (a failed sync
  leaves the prior values until the next one — not silently presented as fresh).

### 3.5 Backend config — derived userinfo URI (`app/config.py`)

Add a derived (computed, not env) property, matching the existing `logto_issuer`/`logto_jwks_uri`
pattern (we **derive** rather than read OIDC discovery — Phase 2a deliberately avoided discovery
because the pre-fix issuer was emitted as `http://`):

```python
@property
def logto_userinfo_uri(self) -> str:
    return f"{self.logto_issuer}/me"   # -> https://auth.fountainrank.com/oidc/me
```

A config unit test asserts the value (incl. correct behavior regardless of a trailing slash on
`logto_endpoint`, since `logto_issuer` already strips it). Live OIDC discovery's
`userinfo_endpoint` is used only as an **operator verification** that `/oidc/me` is correct for
this Logto build — never as runtime behavior.

## 4. Error handling

- `POST /api/v1/me/sync`: missing/invalid resource JWT → `401` (existing resolver); malformed body
  (no `userinfo_token`) → `422`; userinfo unreachable / timeout / non-200 / unparseable / missing
  `sub` → `502` (row unchanged); userinfo `sub` ≠ caller `sub` → `403` (row unchanged); success →
  `200` + `MeResponse`. No silent `500` for these expected failures; unexpected errors keep the
  centralized 500 path. The userinfo httpx client uses a short timeout, `follow_redirects=False`,
  and never includes the token in exceptions.
- Web callback sync is **best-effort**: any non-200/network/timeout logs a redacted structured
  warning (request id + status/error-class + subject when available) and is swallowed — never
  blocks login; the user keeps the prior stored values until a later successful sync.
- **Never log** the opaque token, the resource token, the full userinfo body, or any secret —
  redact. Web: `web/lib/server/log.ts` (redacting). Backend: the existing request-id-stamped
  logging + the Phase 2a no-token rule; on success log the **validated** `sub` only. Repeated
  `502`s from one caller are visible via the per-request warning (rate limiting is a later concern).

## 5. Testing

**Backend** (`backend/tests/test_me_sync.py`, no network — inject a fake userinfo client):
- success: userinfo `{sub, email, email_verified: true, name, picture(https)}` matching the caller
  → row updated to the **real** email/name/avatar; `MeResponse` reflects them; `logto_user_id`
  still absent.
- **sub mismatch → `403`**, row NOT modified.
- userinfo non-200 / network error / timeout / malformed JSON / missing `sub` → `502`, row unchanged.
- **email guards — each preserves the existing real email:** blank/whitespace, syntactically
  invalid, the synthetic `@users.noreply.fountainrank.com` domain, and `email_verified: false`.
- absent `email_verified` with a valid email → accepted.
- **display_name** falls back through `name`→`username`→existing→`sub`, ignoring blank/whitespace.
- **avatar_url**: a valid `https` is set; blank / `http` / non-URL / oversized `picture` → the
  existing avatar is preserved (not cleared).
- a previously-synthetic user → updated to the real email (self-heal).
- `401` without a credential.
- `backend/tests/test_openapi.py` extended: asserts `POST /api/v1/me/sync`, `SyncProfileRequest`,
  and the `MeResponse` response are in the schema.
- a `config` test asserts `logto_userinfo_uri` (§3.5).
Existing suite (Phase 2a + web-auth, ~109 tests) stays green.

**Web** (`vitest`): the `server-only` sync helper — assert it begins with `import "server-only"`
(so it cannot be pulled into a client bundle); it posts to `/api/v1/me/sync` with the resource
bearer header + `{ userinfo_token }` body (mock `getAccessToken`); a thrown/failed sync is
swallowed (best-effort) and logs a **redacted** warning (assert no token in the emitted output).
`getLogtoConfig` now includes the `email`/`profile` scopes (assert). Build-safety unchanged.

**Local gate:** `run.ps1 check`; `pnpm run generate` regenerates the api-client for the new
`/api/v1/me/sync` path (gitignored — not committed). The genuine end-to-end proof is the
post-deploy sign-in showing the real `aronweiler@gmail.com` + name + avatar (§6.1).

## 6. Acceptance criteria

1. **The opaque-token → userinfo path is proven, not assumed (a documented gate):** an early
   implementation probe — exercising the **exact callback sequence** (read both tokens in the
   route handler **immediately after `handleSignIn`**, same request, before any `/account`
   round-trip, since the same-request session-cookie read/write is the part most likely to bite)
   — confirms `getAccessToken(config)` (no resource) yields a token Logto userinfo accepts (`200`
   + the caller's `sub`). The probe **result is recorded** (a committed probe helper/test or a
   handoff note with the Logto endpoint, `@logto/next` version, and observed `sub` match), not an
   untraceable manual check; and the live post-deploy sign-in shows the **real** email/name/avatar
   (only possible if the path works end-to-end). If the probe fails, switch to the Management-API
   contingency (§8) — **never** the trust-client-claims path.
2. `POST /api/v1/me/sync` calls userinfo with the forwarded opaque token, enforces the **`sub`
   cross-check (`403`)**, applies the email/name/avatar **normalization rules** (§3.3 step 4),
   updates the row, returns `MeResponse`, and never `500`s on the expected failures; all §5 tests
   pass under `run.ps1 check`.
3. **Token boundary (matches the shipped `/me` design):** the sync helper carries `import
   "server-only"` (asserted in a test); during a real sign-in the **browser network panel shows no
   `Authorization`-bearing call to `api.fountainrank.com` and no `userinfo_token` in any
   browser-visible payload**; web + backend logs show only request id / status / `sub`, never
   tokens or the callback query.
4. `web/lib/logto.ts` requests the `email`+`profile` scopes; the callback best-effort-syncs on
   every login (failure logged, never blocks the redirect); `/account` shows the real
   email/name/avatar **after a successful sync** (a failed sync logs + login still succeeds — no
   guaranteed-fresh claim).
5. No `.env` written; no AI attribution; no time estimates. CI green + Codex `VERDICT: APPROVED`
   (Loop A spec + plan, Loop B PR) + every PR comment addressed → squash-merge; owner-gated
   `v*.*.*` deploy.

## 7. Owner tasks

- **Done:** Google connector scopes `openid profile email`.
- Ensure the Google (and later Apple) connector's **"Sync profile information"** is enabled (so
  Logto keeps `name`/`avatar` populated on the user, which userinfo then returns). Verify a fresh
  login shows the real name + avatar after deploy.

## 8. Risks / open points

- **Opaque-token contingency (NOT the default):** the design REQUIRES `getAccessToken(config)` (no
  resource) to yield a userinfo-accepted token (§6.1 probe). If — contrary to expectation — Logto
  returns a resource-bound token from the auth-code exchange (because `resource` was requested at
  authorize) and userinfo rejects it, the contingency is the **Logto Management API (M2M)**: the
  backend (using the already-provisioned M2M creds) fetches the canonical profile by `sub` and
  applies the same normalization + `sub` check. Still **backend-authoritative**; we do **NOT** fall
  back to trusting BFF-supplied decoded claims. The §6.1 probe decides the path before the sync
  logic is finalized. **If the probe fails, the M2M path is NOT directly implementable from this
  spec** — it needs a narrow follow-up spec/plan (Management API endpoint, M2M scopes, token
  acquisition/caching, failure mapping, rate limiting) reviewed before implementation.
- **Userinfo path** derived as `settings.logto_issuer + "/me"` (§3.5), with a config test;
  discovery is operator-verification only (avoids reintroducing the Phase 2a `http://`-discovery
  issue).
- **Sync on relogin only** (not real-time): a profile change in the social account shows after the
  next successful login sync; a transient failure leaves the prior values (logged; login
  unaffected). Real-time sync is out of scope.
- **Email-only accounts** (magic-link, no name/avatar): `display_name` falls back, `avatar_url`
  stays null — correct and expected.
- **`502` amplification:** an authenticated caller hammering `/api/v1/me/sync` with junk tokens
  forces backend→Logto traffic (fixed URL, so not SSRF); mitigated by the auth gate + the short
  timeout + the per-request warning log. A rate limit is a later concern if abuse appears.
