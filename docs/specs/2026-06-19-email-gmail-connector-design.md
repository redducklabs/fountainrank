# Email — Logto → backend webhook → Gmail API (design)

**Date:** 2026-06-19
**Status:** Proposed (brainstormed + owner-approved Approach A; pending Codex Loop A)
**Relates to:** spec `2026-06-16…§11` (email); `claude_help/email.md`; `docs/setup/02-dns.md`,
`docs/setup/03-google-cloud.md` (Part B), `docs/setup/06-logto.md`. Follows Phase 2a
(`…-logto-infra-and-backend-jwt`), which made Logto usable.

---

## 1. Goal

Deliver Logto's transactional auth email (verification code for sign-in / register /
password-reset) through the **Gmail API** — no SMTP, no app password — by having Logto's
built-in **HTTP email connector** call an authenticated webhook on our FastAPI backend that
sends via a Google **service account with domain-wide delegation**, impersonating
`noreply@fountainrank.com`.

## 2. Background — verified

- **Logto OSS has no Gmail-API email connector.** Its built-in email connectors are SMTP +
  SaaS providers (SendGrid/Mailgun/SES/Postmark). The **HTTP email connector** is the unlock:
  when Logto needs to send an email it `POST`s a JSON payload to a configured `endpoint` and
  expects a `200`. It supports an **optional authorization token** for that endpoint (so the
  webhook can authenticate the caller). Payload shape:
  ```json
  { "to": "user@example.com", "type": "SignIn", "payload": { "code": "123456", "locale": "en" }, "ip": "..." }
  ```
  (`type` ∈ `SignIn` | `Register` | `ForgotPassword` | `Generic`.) This is distinct from
  Logto's *webhooks* feature (which uses an HMAC `logto-signature-sha-256`); the HTTP email
  connector uses a simple authorization token instead.
- **All Gmail-sending prerequisites are done (owner-confirmed):** service account + JSON key,
  domain-wide delegation for scope `https://www.googleapis.com/auth/gmail.send`, the
  `noreply@fountainrank.com` mailbox, and SPF + DKIM + DMARC passing on the domain.
- **Backend:** FastAPI app (`app/main.py` includes routers), in-cluster Service
  `fountainrank-backend-service:80 → 8000` (same `fountainrank` namespace as Logto). The
  backend already validates Logto JWTs (Phase 2a) and has structured logging + a config
  module. `pyjwt[crypto]` (RS256-capable) and `httpx` are already runtime deps.

## 3. Scope

**In scope**
- A backend webhook `POST /internal/email` (token-authenticated) that renders + sends the
  email via the Gmail API.
- A Gmail sender (OAuth2 JWT-bearer service-account flow with delegation) and minimal-clean
  Jinja2 templates (html + text) per Logto `type`.
- Config + secrets, and the infra wiring (deploy.yml secret keys + backend env).
- Docs: `06-logto.md` (HTTP email connector setup) + `email.md` (the realized architecture).

**Out of scope** (later / owner)
- The in-Logto **HTTP email connector configuration** (owner console step; documented here).
- Localization beyond English (fall back to English templates), branded/styled HTML beyond a
  clean baseline (no finalized style guide yet), true magic-**link** sign-in (we render the
  code; templates accommodate a `link` if Logto ever sends one), an `email_log` DB table /
  app-originated email (Logto owns auth-email rate-limiting — YAGNI here), web/mobile/Apple.

## 4. Design

### 4.1 Architecture

```
Logto (in-cluster)
  └─ HTTP email connector  ──POST──▶  http://fountainrank-backend-service/internal/email
       (endpoint + auth token)            (FastAPI; token-verified)
                                              └─ render template (type, code, locale)
                                              └─ Gmail API users.messages.send
                                                   (SA JWT-bearer + delegation → noreply@)
```
The connector calls the backend over the **in-cluster Service URL** — email traffic never
leaves the cluster. The route is on the existing backend app (it is *also* reachable via the
public ingress at `api.fountainrank.com/internal/email`, so the **auth token is the primary
gate**, constant-time compared; a future ingress path-exclusion is a noted hardening, not
required for correctness). The route is registered `include_in_schema=False` so it stays out
of the OpenAPI document and the generated api-client (a Logto→backend webhook, not public API).

### 4.2 Webhook — `POST /internal/email` (`app/routers/email_webhook.py`)

- **Auth:** require `Authorization: Bearer <token>`; constant-time compare
  (`hmac.compare_digest`) against `settings.logto_email_webhook_token`. Mismatch/missing →
  `401`. If the token (or Gmail creds) is **unconfigured** (local/dev) → `503`
  ("email not configured") — fail closed; never send unauthenticated.
- **Parse** the JSON body into a typed model: `to: str` (Logto already validated it; using
  `str` avoids pulling `email-validator` — a minimal `"@"` sanity check is enough), `type: str`,
  `payload: {code: str | None, link: str | None, locale: str | None, ...}`. Missing/blank `to`
  or an empty `payload` with neither `code` nor `link` → `422`. Unknown `type` → treated as
  `Generic` (do not error).
- **Render** (§4.4) → `(subject, html, text)`. **Send** (§4.3) synchronously so the response
  reflects the real outcome (the user is waiting on the code): success → `200 {"message":"sent"}`;
  Gmail/transport error → `502` (logged with the reason; Logto surfaces a send failure).
- **Logging:** one structured line per send — `to` (or a redacted/hashed form), `type`,
  outcome, latency. **Never** log the verification `code`, the `Authorization` token, or the
  service-account key. Failures log the Gmail error class/status, not secrets.

### 4.3 Gmail sender (`app/email/sender.py`)

OAuth2 **JWT-bearer** service-account flow with domain-wide delegation — no new auth deps
(reuses `pyjwt[crypto]` for RS256 + `httpx`), fully async. The sender's constructor does **no**
parsing or I/O (so building it can never raise — auth always precedes any credential work);
the service-account JSON is parsed + field-validated lazily at first token mint, and **every**
credential/assertion/token-shape failure (bad JSON, missing `client_email`/`private_key`,
invalid PEM, non-JSON or `access_token`-less token response, Gmail non-2xx) is converted to a
typed `EmailSendError` → `502` — never a `500`. Steps:

1. Parse `settings.google_service_account_json` → dict (client_email, private_key, …).
2. Build a short-lived assertion: `jwt.encode({iss: client_email, sub: <delegated_user>,
   scope: "…/gmail.send", aud: "https://oauth2.googleapis.com/token", iat, exp}, private_key,
   algorithm="RS256")`. `sub` = the impersonated `noreply@` mailbox (this is what delegation
   authorizes).
3. Exchange at `https://oauth2.googleapis.com/token`
   (`grant_type=urn:ietf:params:oauth:grant-type:jwt-bearer&assertion=…`) via `httpx` → access
   token. **Cache** it in-process until ~60s before `expires_in` (one token serves many sends),
   guarded by an `asyncio.Lock`.
4. Build the message with stdlib `email.message.EmailMessage` (From = `settings.from_email`,
   To, Subject, plain-text + HTML alternative), base64url-encode the bytes, and
   `httpx.post("https://gmail.googleapis.com/gmail/v1/users/me/messages/send",
   headers={Authorization: Bearer …}, json={"raw": …})`. Non-2xx → raise a typed
   `EmailSendError` (the webhook maps it to `502`). The HTTP client + token-fetch are
   injectable so tests run with no network.

> *Alternative considered:* `google-auth` + a transport (requests/aiohttp). Rejected for this
> lean async backend — it adds 2 deps (incl. a sync transport needing a threadpool) for a
> narrow, well-defined flow we can do with deps already present. Noted for Codex to weigh.

### 4.4 Templates (`app/email/templates.py`)

`render(type, payload, locale) -> (subject, html, text)` using **Jinja2** with autoescaping.
One subject + html + text per `type` (`SignIn`/`Register`/`ForgotPassword`/`Generic`),
minimal-but-clean (FountainRank name, the **code** shown prominently, a plain-text part).
Unknown `type` → `Generic`. `locale` other than English → English fallback (no i18n now). If
`payload.link` is present, render a button/URL in addition to the code (forward-compatible
with magic-link). Templates are small Python-defined Jinja2 strings (no FileSystemLoader/
packaging concerns); easily promoted to per-file branded templates when the style guide lands.

### 4.5 Config (`app/config.py`)

```python
google_service_account_json: str | None = None   # secret (the SA JSON key, as a string)
google_delegated_user: str | None = None          # e.g. noreply@fountainrank.com (impersonated sub)
from_email: str | None = None                      # visible From (usually == delegated user)
logto_email_webhook_token: str | None = None       # secret shared with the Logto connector
```
All default `None` so local dev/tests don't send (the webhook returns `503` unless injected).
A helper `email_configured` (token + service-account JSON + delegated user all present) gates
the webhook. Startup log includes `from_email` + `google_delegated_user` + `email_configured`
(booleans/non-secrets only — never the key or token).

### 4.6 Dependencies

- Add **`jinja2`** (templates), pinned latest stable at plan time. Auth/send reuse the
  existing `pyjwt[crypto]` + `httpx`; MIME is stdlib.

### 4.7 Infra wiring

- **`infra/k8s/backend.yaml`** — add container env: `GOOGLE_SERVICE_ACCOUNT_JSON` +
  `LOGTO_EMAIL_WEBHOOK_TOKEN` via `secretKeyRef` (`fountainrank-secrets` keys
  `google-service-account-json` / `logto-email-webhook-token`); `GOOGLE_DELEGATED_USER` +
  `FROM_EMAIL` as `${…}` envsubst values.
- **`.github/workflows/deploy.yml`** — pass the two new secrets into the `fountainrank-secrets`
  create step (`--from-literal=google-service-account-json=…`,
  `--from-literal=logto-email-webhook-token=…`) from `${{ secrets.* }}`, and add
  `GOOGLE_DELEGATED_USER FROM_EMAIL` (from `${{ vars.* }}`) to the `export …` line before the
  manifest `envsubst` apply.
- **`infra/k8s/secrets.yaml`** (reference-only) — document the two new keys.
- **GitHub `production` env:** secrets `GOOGLE_SERVICE_ACCOUNT_JSON`,
  `LOGTO_EMAIL_WEBHOOK_TOKEN`; variables `GOOGLE_DELEGATED_USER`, `FROM_EMAIL`.
  (Placeholders may be pre-created; owner sets real values.)

### 4.8 Owner tasks (after merge + deploy)

1. Set the `production` secrets/vars above (real service-account JSON, a strong random
   `LOGTO_EMAIL_WEBHOOK_TOKEN`, `noreply@fountainrank.com`, etc.).
2. In Logto admin → **Connectors → Email → HTTP email connector**: set `endpoint` =
   `http://fountainrank-backend-service/internal/email` (in-cluster) and the **authorization
   token** = the same `LOGTO_EMAIL_WEBHOOK_TOKEN`; enable email magic-code in the sign-in
   experience; send a **test email** and confirm delivery (SPF/DKIM/DMARC already pass).

## 5. Error handling

- `401` bad/missing token · `422` malformed/empty payload · `503` email-not-configured ·
  `502` Gmail/transport failure · `200` sent. **No path returns a silent `500`**; the
  centralized handler still catches the unexpected. Token-exchange and send failures raise
  typed errors mapped to `502` and logged with status/reason (never secrets/code).

## 6. Security

- Webhook gated by a constant-time bearer-token check; fail closed when unconfigured.
- Reached in-cluster (no public dependency); token still protects the public-ingress path.
- **Least privilege:** the SA holds only `gmail.send`; impersonates a single `noreply@`
  mailbox. Secrets (SA JSON, webhook token) live only in GitHub/k8s secrets, never the repo,
  never logged. The verification `code` is never logged.

## 7. Testing (`backend/tests/test_email_webhook.py`, `test_email_sender.py`)

No network: inject a fake token-fetch + a fake Gmail HTTP client.
- **Webhook:** valid token + payload → renders + calls sender → `200`; bad/missing token →
  `401`; unconfigured (no token/creds) → `503`; malformed/empty payload → `422`; unknown
  `type` → uses Generic, `200`; sender raises → `502`; assert the **code/token never appear in
  logs** (caplog over `record.__dict__`).
- **Sender:** builds an RS256 assertion with the right `iss`/`sub`/`scope`/`aud`; token cached
  + reused until near-expiry, refreshed after; success path posts a base64url `raw`; non-2xx →
  `EmailSendError`; token-endpoint failure → `EmailSendError`.
- **Templates:** each `type` renders a subject + html + text containing the code; autoescaping
  on; unknown type → Generic; non-English locale → English.
- **Config:** `email_configured` true only when token + SA JSON + delegated user all set.
- Local gate: `./run.ps1 check -Backend` (the new tests need no DB). An **optional, gated
  live-send** check (real creds) is a manual post-deploy step, not in CI.

## 8. Acceptance criteria

1. `POST /internal/email` authenticates by token, renders by `type`, sends via the Gmail API,
   and returns the right status for each case; all §7 tests pass under `./run.ps1 check`.
2. No new auth deps (PyJWT + httpx reused); only `jinja2` added. No model/migration changes
   (`alembic check` stays drift-free).
3. Infra: `backend.yaml` + `deploy.yml` wire the two secrets + two vars; manifests pass
   `kubeconform`. Secrets never in the repo; no AI attribution; no time estimates.
4. Docs updated (`06-logto.md` connector setup, `email.md` realized architecture).
5. CI green + Codex `VERDICT: APPROVED` + all PR comments addressed → squash-merge. Deploy
   owner-gated; the live send-test is a post-deploy owner step.

## 9. Risks / open points

- **No end-to-end send in CI** (no real creds) — CI proves the flow against injected fakes;
  the real send is a gated post-deploy check. Called out, not hidden.
- **Public reachability of `/internal/email`** is mitigated by the token; an ingress
  path-exclusion is a follow-up hardening if desired.
- **Token-exchange clock skew** — the assertion uses a 60s leeway margin and short exp; the
  cached access token refreshes ~60s early.
