# Email

Transactional auth email (magic link, verification) is **owned by Logto** and
delivered through Google. See spec §11.

## Transport

- **Primary:** Logto's built-in **HTTP email connector** calls an authenticated webhook on
  the FastAPI backend (`POST /internal/email`, in-cluster, shared bearer token), which sends
  via the **Gmail API** using a Google **service account with domain-wide delegation**
  (scope `gmail.send`) impersonating `noreply@fountainrank.com`. No SMTP, no app password,
  no custom Logto connector image. See `docs/specs/2026-06-19-email-gmail-connector-design.md`.
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
