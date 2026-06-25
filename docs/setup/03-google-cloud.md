# 03 — Google Cloud (sign-in OAuth + Gmail sending)

Google covers **two distinct jobs** for FountainRank, both set up in the same
Google Cloud project:

1. **Google sign-in** — OAuth 2.0 clients that Logto's Google connector uses so
   users can log in with Google (web + native).
2. **Auth email sending** — a **service account with Google Workspace
   domain-wide delegation** that lets the backend/Logto send mail through the
   **Gmail API** (magic link, verification). This is the proven TherapyLink
   transport (deliberately off SendGrid).

**Unblocks:** Phase 2 Google sign-in, and **all** transactional auth email.

---

## ⚠️ Prerequisite decision — Google Workspace

The Gmail-API sending design **requires a Google Workspace account on the
`fountainrank.com` domain**. Domain-wide delegation does **not** work with a
free `@gmail.com` account.

- **Have Workspace on the domain?** → do the whole guide.
- **No Workspace?** → either (a) get Workspace (cleanest, matches the design),
  or (b) we fall back to **Logto's built-in SMTP connector** pointed at a
  mailbox. Tell me which; the SMTP fallback changes the email guide and skips
  the service-account section below.

The **sign-in** half (Step 2) works regardless of Workspace.

---

## Step 0 — Create the project

1. <https://console.cloud.google.com> → project picker → **New Project**.
2. Name `fountainrank`. Record the **Project ID** (e.g. `fountainrank-xxxxx`).

---

## Part A — Google sign-in (OAuth)

### Step 1 — OAuth consent screen / branding

1. **APIs & Services → OAuth consent screen** (newer console: **Google Auth
   Platform → Branding**).
2. **User type: External.**
3. App info: app name `FountainRank`, support email, app logo (optional), the
   home page `https://fountainrank.com`, privacy-policy and terms URLs (can be
   placeholders for now, required before going to production/verification).
4. **Authorized domains:** add `fountainrank.com`.
5. **Scopes:** add the non-sensitive sign-in scopes only — `openid`,
   `.../auth/userinfo.email`, `.../auth/userinfo.profile`. (Gmail _sending_ does
   **not** use this consent screen — it uses service-account delegation in Part
   B.)
6. While unverified, add yourself + testers under **Test users**. Submit for
   **verification** before public launch (verification review is slow — start
   early; only needed once you leave "testing" mode).

### Step 2 — OAuth 2.0 client IDs

Create under **APIs & Services → Credentials → Create Credentials → OAuth client
ID**. Per spec §19 we register Web, iOS, and Android.

- **Web application** (this is the one **Logto's Google connector** uses):
  - Authorized redirect URI is **Logto's callback URL**, which has the form
    `https://auth.fountainrank.com/callback/<connector-id>`. The exact
    `<connector-id>` is generated when you create the Google connector in Logto
    (Phase 2, `06-logto.md`) — so **create the client now and add/adjust the
    redirect URI when Logto is up**.
  - Record the **Client ID** and **Client secret**.

- **iOS** — use the owner-confirmed bundle identifier
  `com.redducklabs.fountainrank`; record the **Client ID**.

- **Android** — use package name `com.redducklabs.fountainrank` and the signing
  certificate **SHA-1 fingerprint** from Play App Signing / EAS build
  credentials. Create it after the SHA-1 exists; record the **Client ID**.

> With Logto brokering sign-in, the **Web** client is the critical one. The iOS
> bundle id and Android package name are now fixed; the Android OAuth client
> still waits on the Play App Signing SHA-1.

---

## Part B — Gmail sending (service account + domain-wide delegation)

### Step 3 — Enable the Gmail API

**APIs & Services → Library →** search **Gmail API → Enable** (in the
`fountainrank` project).

### Step 4 — Create the service account + key

1. **APIs & Services → Credentials → Create Credentials → Service account.**
2. Name `fountainrank-mailer`. No project roles are needed (it acts via
   delegation, not project IAM).
3. Open the service account → **Keys → Add key → Create new key → JSON**.
   A `.json` file downloads — **this is a secret**. This file's contents become
   `GOOGLE_SERVICE_ACCOUNT_JSON`.
4. On the service account's **Details** page, copy the **Unique ID / Client ID**
   (a long number) — you need it for the next step.
5. Ensure **"Enable Google Workspace Domain-wide Delegation"** is turned on for
   the service account.

### Step 5 — Authorize delegation in Workspace Admin

This is done in the **Google Workspace Admin console**
(<https://admin.google.com>), not Cloud Console — you must be a Workspace admin.

1. **Security → Access and data control → API controls → Domain-wide
   Delegation → Manage Domain Wide Delegation → Add new.**
2. **Client ID:** the service account's numeric Client ID from Step 4.4.
3. **OAuth scopes:** `https://www.googleapis.com/auth/gmail.send`
   (send-only — least privilege; do **not** grant full Gmail scope).
4. Authorize.

### Step 6 — Pick the delegated sender mailbox

Domain-wide delegation lets the service account **impersonate a real Workspace
mailbox**. Create/choose a mailbox like `noreply@fountainrank.com` (a real user
or a mailbox the admin controls). The connector impersonates this address.

- `GOOGLE_DELEGATED_USER` = the impersonated mailbox (e.g.
  `noreply@fountainrank.com`).
- `GOOGLE_WORKSPACE_DOMAIN` = `fountainrank.com`.
- `FROM_EMAIL` = the visible From address (usually same as the delegated user).

---

## Outputs to record

| Value                             | Becomes                       | Destination                                |
| --------------------------------- | ----------------------------- | ------------------------------------------ |
| Project ID                        | reference                     | tell me                                    |
| Web OAuth **Client ID**           | Logto Google connector        | `06-logto.md`                              |
| Web OAuth **Client secret**       | Logto Google connector        | **secret** — set in Logto                  |
| iOS / Android OAuth Client IDs    | native sign-in                | `06-logto.md` (when created)               |
| Service-account **JSON key**      | `GOOGLE_SERVICE_ACCOUNT_JSON` | GitHub Env **secret**                      |
| Service-account numeric Client ID | Workspace delegation          | used in Step 5 only                        |
| `GOOGLE_DELEGATED_USER`           | impersonated mailbox          | GitHub Env **variable**                    |
| `GOOGLE_WORKSPACE_DOMAIN`         | `fountainrank.com`            | GitHub Env **variable**                    |
| `FROM_EMAIL`                      | sender address                | GitHub Env **variable** (shared with `02`) |

**Hand me:** Project ID, the delegated user, the Workspace domain, and the
`FROM_EMAIL` (not secrets). **You keep / set yourself:** the service-account
JSON (GitHub secret) and the OAuth client secret (entered into Logto in
Phase 2).

---

## Security notes

- The service-account JSON key is a **long-lived secret** that can send mail as
  your domain — store it only in GitHub Environment secrets / cluster secrets,
  never in the repo, never in a committed file.
- Use the **`gmail.send` scope only**. Never grant broader Gmail/Workspace
  scopes to the delegated service account.
- Prefer a dedicated, low-privilege mailbox (`noreply@`) as the delegated user.
- Rotate the JSON key periodically; delete old keys in the console after
  rotation.
