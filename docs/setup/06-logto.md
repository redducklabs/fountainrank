# 06 — Logto (app registrations + connectors)

Logto is the self-hosted OIDC identity authority, deployed **into the cluster**
on `auth.fountainrank.com` with its own Postgres database (see
`claude_help/oauth-sso.md` and spec §10). This guide is the **in-Logto admin
configuration** you do once Logto is running.

**Unblocks:** Phase 2 auth end-to-end (web + mobile + email magic link).

> **Sequencing:** do this **after** (a) Logto is deployed by 0e, and (b) you've
> created the Google OAuth client (`03`) and Apple Sign-in artifacts (`04`).
>
> **Admin console access (port-forward).** The admin console is served on the
> container's port **3002**, which is intentionally **not** exposed publicly. Reach
> it over a local port-forward (no internet-facing admin surface):
>
> ```bash
> kubectl config use-context do-sfo3-fountainrank-production-cluster
> kubectl -n fountainrank port-forward deploy/logto 3002:3002
> # then open http://localhost:3002
> ```
>
> On first boot you set the initial admin credentials — keep them in your password
> manager (Logto admin can mint tokens for any user).

---

## Step 0 — API Resource (backend audience)

In **API resources → Create API resource**, set the **API identifier** to
`https://api.fountainrank.com`. This indicator becomes the `aud` of the JWT access
tokens the web/mobile clients request for the backend; the backend validates exactly
this audience. (No scopes are required for Phase 2a — the backend authenticates the
subject; per-scope authorization is a later concern.)

## Step 1 — Applications

In the Logto admin console → **Applications → Create**:

- **Web** — type **Traditional Web** (Next.js). Set:
  - **Redirect URIs:** `http://localhost:3020/callback` (local dev, port 3020)
    **and** `https://fountainrank.com/callback` (production).
  - **Post sign-out redirect URI:** `https://fountainrank.com`.
  - Record **App ID** and **App secret** → `LOGTO_APP_ID` / `LOGTO_APP_SECRET`.

- **Native** — type **Native** (Expo / React Native). Set:
  - **Redirect URI:** the app's custom scheme, e.g.
    `com.redducklabs.fountainrank://callback` (must match the Expo config).
  - **Post sign-out redirect URI:** `com.redducklabs.fountainrank://callback`
    (the same custom-scheme callback). The mobile app performs a real RP-initiated logout
    (`endSessionUrl` + `WebBrowser.openAuthSessionAsync`); Logto **rejects** the end-session
    request if this URI is not registered, in which case sign-out degrades to the local-only
    path (`end-session failed` log). This makes logout *clean* (ends the Logto session
    server-side), but it is **not** what fixes the #6 silent re-login — `prompt=login` (below)
    is. Register it so logout is complete, but the bug is fixed with or without it.
  - Record the **App ID** (native apps are public clients — no secret).
  - Mobile build variable: `EXPO_PUBLIC_LOGTO_APP_ID`.
  - Enable mobile sign-in config only after the Native app type and exact
    redirect URI are confirmed in this doc; then set
    `EXPO_PUBLIC_LOGTO_NATIVE_AUTH_CONFIRMED=true` for the build. A lone app id
    must not enable sign-in.

  Current native app record:
  - Type: Native (owner-confirmed 2026-06-23).
  - Public App ID: `oikth3qbmnrhqd9jmkbc8`.
  - Redirect URI: **pending owner confirmation; do not set
    `EXPO_PUBLIC_LOGTO_NATIVE_AUTH_CONFIRMED=true` until this exact URI is
    confirmed in Logto** —
    `com.redducklabs.fountainrank://callback`.

- **Machine-to-Machine** — for the backend / any server-to-server calls.
  - Record **App ID** + **App secret**.

`LOGTO_ENDPOINT` = `https://auth.fountainrank.com`.

## Step 2 — Connectors

**Connectors →** add and configure:

- **Google (social):**
  - Paste the **Web OAuth Client ID + secret** from `03-google-cloud.md`.
  - Logto shows this connector's **callback URI**
    (`https://auth.fountainrank.com/callback/<connector-id>`). **Copy it back
    into the Google web client's Authorized redirect URIs** (`03` Step 2).
  - **Prompts:** `select_account` (already configured). This forces Google's account chooser
    **once the flow reaches Google**. It is NOT the cause of the #6 silent-re-login bug and toggling
    it does nothing for that bug: when Logto still holds a live session it returns a token without
    re-running the Google connector at all, so `select_account` is never consulted. The #6 fix is at
    the Logto-session layer (`prompt=login` + RP-initiated logout, both in the mobile code) — see the
    close-criteria note below.

- **Apple (social):**
  - Enter **Services ID** (client id), **Team ID**, **Key ID**, and upload the
    **`.p8`** key from `04-apple-and-app-stores.md`.
  - Copy Logto's Apple callback URI back into the Apple **Services ID** return
    URLs (`04`).

- **Email (passwordless verification code) — HTTP email connector:**
  - Logto OSS has no Gmail-API connector. Use the built-in **HTTP email connector**: it
    POSTs `{to, type, payload:{code,locale}}` to an endpoint we host on the backend.
  - **Endpoint:** `http://fountainrank-backend-service/internal/email` (in-cluster; email
    traffic never leaves the cluster).
  - **Authorization token:** set it to the same value as the `LOGTO_EMAIL_WEBHOOK_TOKEN`
    GitHub secret — the backend constant-time compares it.
  - Sending is via the Gmail API (service account + domain-wide delegation impersonating
    `noreply@fountainrank.com`); no SMTP, no app password.
  - Verify a test code email sends and lands (SPF/DKIM/DMARC from `02-dns.md` must pass).

## Step 3 — Sign-in experience

**Sign-in experience →** enable email magic link + the Google/Apple social
buttons; set branding (logo, colors) to match the eventual style guide.

---

## Outputs to record

| Value                                              | Becomes                                                   | Destination                        |
| -------------------------------------------------- | --------------------------------------------------------- | ---------------------------------- |
| `LOGTO_ENDPOINT` (`https://auth.fountainrank.com`) | web/mobile/backend config                                 | GitHub Env **variable**            |
| Web `LOGTO_APP_ID` / `LOGTO_APP_SECRET`            | web config                                                | id = variable, secret = **secret** |
| Native app ID                                      | mobile config (`EXPO_PUBLIC_LOGTO_APP_ID`)                | variable                           |
| Native auth confirmation flag                      | mobile config (`EXPO_PUBLIC_LOGTO_NATIVE_AUTH_CONFIRMED`) | variable                           |
| M2M app ID / secret                                | backend account deletion                                  | id = variable, secret = **secret** |
| Management API resource / base URL                 | backend account deletion                                  | Optional GitHub Env variables      |

**Hand me:** the endpoint and app IDs (not secrets) so I can wire the
web/mobile/backend config in Phase 2. **You keep / set yourself:** the app
secrets and connector credentials, entered in Logto and mirrored into GitHub
Environment secrets where CI needs them.

---

## Owner task — set production GitHub secrets before next deploy

The Phase 2a deploy used placeholder values for `LOGTO_APP_ID` and the web
secrets. Now that the web Logto integration is implemented you **must** replace
them before the next deploy. The k8s Secret is recreated from these values on
every deploy run.

**GitHub → Settings → Environments → `production`:**

| Item                            | Type                      | Value                                                                         |
| ------------------------------- | ------------------------- | ----------------------------------------------------------------------------- |
| `LOGTO_APP_ID`                  | **Variable** (not secret) | The real App ID from Step 1 above                                             |
| `LOGTO_APP_SECRET`              | **Secret**                | The real App Secret from Step 1 above                                         |
| `LOGTO_COOKIE_SECRET`           | **Secret**                | A random string ≥ 32 characters (generate with `openssl rand -base64 32`)     |
| `LOGTO_M2M_APP_ID`              | **Variable** (not secret) | M2M app ID — reused by backend account deletion (already set)                 |
| `LOGTO_M2M_APP_SECRET`          | **Secret**                | M2M app secret — reused by backend account deletion (already set)            |
| `LOGTO_MANAGEMENT_RESOURCE`     | **Variable** (optional)   | Only for Logto **Cloud**; self-hosted defaults to `https://default.logto.app/api` |
| `LOGTO_MANAGEMENT_API_BASE_URL` | **Variable** (optional)   | Management API HTTP base URL when it differs from `{LOGTO_ENDPOINT}/api`      |

> **The M2M app must hold the `Logto Management API access` role** (the `all` scope on the
> Management API resource). Without it the token request succeeds but `DELETE /api/v1/users/:id`
> returns 403, and every account deletion strands at `identity_delete_status='pending'`.

Do **not** paste the actual secret values here or into any file tracked by git.

---

## Security notes

- Keep the **initial Logto admin account** credentials in your password manager;
  Logto admin can mint tokens for any user.
- **Never** disable connectors' security settings, weaken token TTLs
  arbitrarily, or self-mint symmetric tokens — the backend validates Logto JWTs
  via JWKS (`iss`/`aud`), and that contract must hold (see
  `claude_help/oauth-sso.md`).
- Verify both social callbacks round-trip (Google ↔ Logto, Apple ↔ Logto)
  before relying on them in the apps.

### Close criteria for the mobile sign-out fix (#6)

**Root cause:** the silent re-login was at the **Logto session layer**, not the Google connector.
Before the fix, mobile sign-out never ended the Logto session (the `@logto/rn` sign-out browser
navigation is a no-op) and sign-in used `prompt=consent`, so Logto silently reused its live session
and returned a token **without ever re-running the Google connector** — which is why the Google
`select_account` prompt (already enabled) had no effect on the bug.

**The fix is code, and it is `prompt=login`** (`mobile/lib/auth/config.ts`): it forces Logto to
re-authenticate on every sign-in, so a surviving session can no longer be reused. The RP-initiated
logout is a clean-up that also ends the session server-side (and needs the post-logout redirect URI
registered to succeed), but `prompt=login` alone stops the silent re-login.

**No new console change is required for the bug itself:** `select_account` is already enabled, and
once `prompt=login` forces the flow back through the sign-in experience, Google's chooser appears
normally. Registering the Native post-logout redirect URI is optional polish (a fully clean logout),
not a prerequisite.

**#6 is closed when** the mobile app carrying this code is released and a device test confirms:
sign out, tap sign in → the Logto sign-in screen appears (not a silent re-login), and choosing Google
shows the account chooser. Because the fix is in the mobile bundle, it ships via a **mobile store
release**, not the backend/web `deploy.yml`.
