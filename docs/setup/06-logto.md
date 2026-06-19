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
  - **Redirect URI:** the web app's callback (Logto Next.js SDK default is
    `https://fountainrank.com/callback` — confirm against the SDK config we
    write in Phase 2).
  - **Post sign-out redirect URI:** `https://fountainrank.com`.
  - Record **App ID** and **App secret** → `LOGTO_APP_ID` / `LOGTO_APP_SECRET`.

- **Native** — type **Native** (Expo / React Native). Set:
  - **Redirect URI:** the app's custom scheme, e.g.
    `com.redducklabs.fountainrank://callback` (must match the Expo config).
  - Record the **App ID** (native apps are public clients — no secret).

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

- **Apple (social):**
  - Enter **Services ID** (client id), **Team ID**, **Key ID**, and upload the
    **`.p8`** key from `04-apple-and-app-stores.md`.
  - Copy Logto's Apple callback URI back into the Apple **Services ID** return
    URLs (`04`).

- **Email (passwordless magic link):**
  - **Primary:** the **custom Gmail-API connector** using
    `GOOGLE_SERVICE_ACCOUNT_JSON` + `GOOGLE_DELEGATED_USER` (built in Phase 2 per
    `claude_help/email.md`).
  - **Fallback:** Logto's built-in **SMTP connector** pointed at Workspace, if
    the custom connector is deferred.
  - Verify a test magic-link email actually sends and lands in the inbox (SPF/
    DKIM/DMARC from `02-dns.md` must be passing).

## Step 3 — Sign-in experience

**Sign-in experience →** enable email magic link + the Google/Apple social
buttons; set branding (logo, colors) to match the eventual style guide.

---

## Outputs to record

| Value | Becomes | Destination |
|---|---|---|
| `LOGTO_ENDPOINT` (`https://auth.fountainrank.com`) | web/mobile/backend config | GitHub Env **variable** |
| Web `LOGTO_APP_ID` / `LOGTO_APP_SECRET` | web config | id = variable, secret = **secret** |
| Native app ID | mobile config | variable |
| M2M app ID / secret | backend config | id = variable, secret = **secret** |

**Hand me:** the endpoint and app IDs (not secrets) so I can wire the
web/mobile/backend config in Phase 2. **You keep / set yourself:** the app
secrets and connector credentials, entered in Logto and mirrored into GitHub
Environment secrets where CI needs them.

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
