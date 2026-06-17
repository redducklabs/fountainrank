# Email

Transactional auth email (magic link, verification) is **owned by Logto** and
delivered through Google. See spec §11.

## Transport

- **Primary:** a **custom Logto email connector backed by the Gmail API** — a
  Google **service account with Google Workspace domain-wide delegation**,
  impersonating a Workspace sender. This mirrors the proven TherapyLink transport
  (TherapyLink deliberately moved off SendGrid to the Gmail API).
- **Fallback:** Logto's built-in **SMTP connector** pointed at Google Workspace,
  if the custom connector is deferred.
- Any future app-originated email (e.g., notifications) reuses the same Gmail-API
  sending approach from the backend — not a separate provider.

## Templates & tracking (reference patterns)

Reuse TherapyLink's structure: paired Jinja2 `*.html` + `*.txt` templates, and
the email-log / rate-limit tracking models for any app-side sending. For
magic-link style flows, place one-time tokens in the URL **fragment**
(`#token=...`), never the query string, so they are not logged or sent in a
Referer header.

## Secrets & deliverability

- **NEVER** commit email secrets. Reference env var **names** only — e.g.
  `GOOGLE_SERVICE_ACCOUNT_JSON`, `GOOGLE_WORKSPACE_DOMAIN`, `GOOGLE_DELEGATED_USER`,
  `FROM_EMAIL`, `BASE_URL`. Values live in GitHub Environment / cluster secrets.
- Configure **SPF, DKIM, and DMARC** on the sending domain so mail is delivered
  and not spoofable.
