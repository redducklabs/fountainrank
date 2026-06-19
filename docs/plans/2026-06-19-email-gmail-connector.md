# Email — Logto → backend webhook → Gmail API Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver Logto's transactional auth email via the Gmail API (no SMTP/app-password) through an authenticated backend webhook that Logto's HTTP email connector calls.

**Architecture:** Logto HTTP email connector → `POST /internal/email` (token-auth) on the existing FastAPI backend → render a Jinja2 template by `type` → send via the Gmail API using an OAuth2 JWT-bearer service-account flow with domain-wide delegation (impersonating `noreply@fountainrank.com`). No new auth deps — reuse `pyjwt[crypto]` (RS256) + `httpx`.

**Tech Stack:** Python 3.13, FastAPI, PyJWT[crypto] (RS256 assertion), httpx (token + send), Jinja2 (templates), stdlib `email`/`hmac`/`base64`; Kubernetes (`infra/k8s`), `deploy.yml`, `uv` via `./run.ps1`.

**Spec:** `docs/specs/2026-06-19-email-gmail-connector-design.md`

## Global Constraints

- **Execution environment:** Windows host; the Bash tool is **Git Bash** (forward-slash paths under `/d/repos/fountainrank`); run the task runner as `powershell.exe -NoProfile -File run.ps1 <cmd>` (`pwsh` not on PATH). File tools use backslash paths.
- New dep (exact pin, repo `==` convention): **`jinja2==3.1.6`**. Auth/send reuse existing `pyjwt[crypto]==2.13.0` + `httpx==0.28.1`; MIME is stdlib. **No `email-validator`/`google-auth`/`requests`.**
- Gmail OAuth2 JWT-bearer: assertion `iss`=SA client_email, `sub`=delegated user, `scope`=`https://www.googleapis.com/auth/gmail.send`, `aud`=`https://oauth2.googleapis.com/token`, RS256-signed with the SA private key. Token endpoint `https://oauth2.googleapis.com/token`; send endpoint `https://gmail.googleapis.com/gmail/v1/users/me/messages/send` with `{"raw": <base64url MIME>}`.
- Webhook fails **closed**: `503` if unconfigured, `401` on bad/missing bearer token (constant-time `hmac.compare_digest`), `422` malformed/empty payload, `502` on Gmail/transport failure, `200` on send. No silent `500`.
- **Never** log/return the verification `code`, the webhook token, or the service-account key. No secrets in the repo. No AI attribution in commits/PR. No time estimates.
- No DB/model/migration changes (`alembic check` stays drift-free). Conventional Commits, frequent commits. IaC validated with `kubeconform`; deploy is owner-gated.

---

### Task 1: Config — email settings + `email_configured` + startup log

**Files:**
- Modify: `backend/app/config.py`, `backend/app/logging_config.py`
- Test: `backend/tests/test_config.py`, `backend/tests/test_logging.py`

**Interfaces:**
- Produces: `Settings.google_service_account_json: str | None`, `Settings.google_delegated_user: str | None`, `Settings.from_email: str | None`, `Settings.google_workspace_domain: str | None`, `Settings.logto_email_webhook_token: str | None`, and `Settings.email_configured -> bool`.

- [ ] **Step 1: Write the failing tests** (append to `backend/tests/test_config.py`; `Settings` is already imported there — add no import)

```python
def test_email_defaults_are_unset_and_not_configured():
    s = Settings()
    assert s.google_service_account_json is None
    assert s.google_delegated_user is None
    assert s.from_email is None
    assert s.logto_email_webhook_token is None
    assert s.email_configured is False


def test_email_configured_requires_token_json_and_delegated_user():
    s = Settings(
        google_service_account_json='{"client_email":"x"}',
        google_delegated_user="noreply@fountainrank.com",
        logto_email_webhook_token="t",
    )
    assert s.email_configured is True
    # Missing any one of the three -> not configured.
    assert Settings(
        google_service_account_json='{"client_email":"x"}',
        google_delegated_user="noreply@fountainrank.com",
    ).email_configured is False
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd /d/repos/fountainrank/backend && uv run pytest tests/test_config.py -k email -v`
Expected: FAIL — `AttributeError: 'Settings' object has no attribute 'google_service_account_json'`.

- [ ] **Step 3: Implement** — in `backend/app/config.py`, inside `class Settings`, after the Phase 2a Logto block (the `logto_jwks_uri` property), add:

```python
    # --- Email (Logto HTTP email connector -> Gmail API) ---
    # The Google service-account JSON key (whole file, as a string), the impersonated
    # Workspace mailbox (domain-wide delegation), the visible From, and the shared bearer
    # token Logto's HTTP email connector sends. All default None so local dev/tests do not
    # send (the webhook returns 503 unless these are set).
    google_service_account_json: str | None = None
    google_delegated_user: str | None = None
    from_email: str | None = None
    logto_email_webhook_token: str | None = None

    @property
    def email_configured(self) -> bool:
        return bool(
            self.logto_email_webhook_token
            and self.google_service_account_json
            and self.google_delegated_user
        )
```

- [ ] **Step 4: Run to verify pass**

Run: `cd /d/repos/fountainrank/backend && uv run pytest tests/test_config.py -v`
Expected: PASS. Then `uv run ruff check app/config.py tests/test_config.py` + `uv run ruff format --check app/config.py tests/test_config.py` — clean.

- [ ] **Step 5: Surface the non-secret email config in the startup log (+ test)**

In `backend/app/logging_config.py::log_startup`, add three non-secret fields to the `extra`
dict (right after `"dev_auth_enabled": settings.dev_auth_enabled,`):

```python
            "email_configured": settings.email_configured,
            "from_email": settings.from_email,
            "google_delegated_user": settings.google_delegated_user,
```

Append a test to `backend/tests/test_logging.py` (it already imports `log_startup`/logging
helpers and uses `caplog`; match the existing test style — if `log_startup` is not imported
there, add `from app.logging_config import log_startup` to its import block):

```python
def test_startup_log_includes_email_config_without_secrets(caplog):
    from app.config import Settings

    s = Settings(
        google_service_account_json='{"client_email":"x","private_key":"secretpem"}',
        logto_email_webhook_token="supersecrettoken",
        google_delegated_user="noreply@fountainrank.com",
        from_email="noreply@fountainrank.com",
    )
    with caplog.at_level("INFO"):
        log_startup(s)
    rec = next(r for r in caplog.records if r.getMessage() == "starting backend")
    assert rec.email_configured is True
    assert rec.google_delegated_user == "noreply@fountainrank.com"
    # The SA key and the webhook token must never appear in the startup line.
    assert all("secretpem" not in str(v) for v in rec.__dict__.values())
    assert all("supersecrettoken" not in str(v) for v in rec.__dict__.values())
```

Run: `cd /d/repos/fountainrank/backend && uv run pytest tests/test_logging.py -v` → PASS;
then `uv run ruff check app/logging_config.py tests/test_logging.py` + `format --check` clean.

- [ ] **Step 6: Commit**

```bash
cd /d/repos/fountainrank
git add backend/app/config.py backend/app/logging_config.py backend/tests/test_config.py backend/tests/test_logging.py
git commit -m "feat(backend): add email (Gmail connector) settings + email_configured + startup log"
```

---

### Task 2: Email templates (`app/email/templates.py`) + jinja2 dep

**Files:**
- Create: `backend/app/email/__init__.py` (empty), `backend/app/email/templates.py`
- Modify: `backend/pyproject.toml` (add `jinja2==3.1.6`)
- Test: `backend/tests/test_email_templates.py`

**Interfaces:**
- Produces: `render(email_type: str, payload: dict) -> tuple[str, str, str]` returning `(subject, html, text)`. Recognized types: `SignIn`, `Register`, `ForgotPassword`, `Generic`; any other → `Generic`.

- [ ] **Step 1: Add the dependency**

In `backend/pyproject.toml`, add `"jinja2==3.1.6",` to the `dependencies` list (after `"httpx==0.28.1",`). Then:

```bash
cd /d/repos/fountainrank/backend && uv sync && uv run python -c "import jinja2; print(jinja2.__version__)"
```
Expected: `3.1.6`.

- [ ] **Step 2: Write the failing test** — create `backend/tests/test_email_templates.py`:

```python
import pytest

from app.email.templates import render


@pytest.mark.parametrize("etype", ["SignIn", "Register", "ForgotPassword", "Generic"])
def test_render_includes_code_in_subject_html_text(etype):
    subject, html, text = render(etype, {"code": "123456"})
    assert subject  # non-empty subject per type
    assert "123456" in html
    assert "123456" in text
    assert "FountainRank" in html


def test_unknown_type_falls_back_to_generic():
    subject, html, text = render("SomethingElse", {"code": "999000"})
    generic_subject, _, _ = render("Generic", {"code": "999000"})
    assert subject == generic_subject
    assert "999000" in text


def test_autoescape_escapes_html_in_values():
    # A code is digits in practice, but escaping must be on so a hostile value can't inject.
    _, html, _ = render("SignIn", {"code": "<script>x</script>"})
    assert "<script>" not in html
    assert "&lt;script&gt;" in html


def test_link_rendered_when_present():
    _, html, text = render("SignIn", {"code": "123456", "link": "https://fountainrank.com/x"})
    assert "https://fountainrank.com/x" in html
    assert "https://fountainrank.com/x" in text
```

- [ ] **Step 3: Run to verify it fails**

Run: `cd /d/repos/fountainrank/backend && uv run pytest tests/test_email_templates.py -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'app.email'`.

- [ ] **Step 4: Implement** — create `backend/app/email/__init__.py` (empty file) and `backend/app/email/templates.py`:

```python
"""Render Logto auth emails (verification code) — minimal, clean, brand-light.

One subject + HTML + text per Logto email `type`, sharing a single body template whose
intro line varies by type. Jinja2 autoescaping is on (HTML), so any value is safely
escaped. A `link` (forward-compat with magic-link) is rendered when present. English only
for now; non-English locales fall back to this copy.
"""

from jinja2 import Environment, select_autoescape

_env = Environment(autoescape=select_autoescape(["html", "xml"]))

_SUBJECTS = {
    "SignIn": "Your FountainRank sign-in code",
    "Register": "Verify your FountainRank email",
    "ForgotPassword": "Reset your FountainRank password",
    "Generic": "Your FountainRank verification code",
}
_INTROS = {
    "SignIn": "Use this code to sign in to FountainRank:",
    "Register": "Use this code to verify your email and finish creating your FountainRank account:",
    "ForgotPassword": "Use this code to reset your FountainRank password:",
    "Generic": "Your FountainRank verification code:",
}

_HTML = _env.from_string(
    """<!doctype html><html><body style="font-family:system-ui,Arial,sans-serif;color:#111">
<p>{{ intro }}</p>
{% if code %}<p style="font-size:28px;font-weight:700;letter-spacing:3px">{{ code }}</p>{% endif %}
{% if link %}<p><a href="{{ link }}">Continue to FountainRank</a></p>{% endif %}
<p style="color:#666;font-size:13px">If you didn't request this, you can ignore this email.</p>
<p style="color:#666;font-size:13px">— FountainRank</p>
</body></html>"""
)
_TEXT = _env.from_string(
    """{{ intro }}

{% if code %}{{ code }}
{% endif %}{% if link %}{{ link }}
{% endif %}
If you didn't request this, you can ignore this email.
— FountainRank
"""
)


def render(email_type: str, payload: dict) -> tuple[str, str, str]:
    etype = email_type if email_type in _SUBJECTS else "Generic"
    ctx = {"intro": _INTROS[etype], "code": payload.get("code"), "link": payload.get("link")}
    return _SUBJECTS[etype], _HTML.render(**ctx), _TEXT.render(**ctx)
```

- [ ] **Step 5: Run to verify pass**

Run: `cd /d/repos/fountainrank/backend && uv run pytest tests/test_email_templates.py -v`
Expected: PASS. Then `uv run ruff check app/email/ tests/test_email_templates.py` + `uv run ruff format --check app/email/ tests/test_email_templates.py` — clean.

- [ ] **Step 6: Commit**

```bash
cd /d/repos/fountainrank
git add backend/pyproject.toml backend/uv.lock backend/app/email/__init__.py backend/app/email/templates.py backend/tests/test_email_templates.py
git commit -m "feat(backend): email templates (Jinja2, code/link, autoescaped) + jinja2 dep"
```

---

### Task 3: Gmail sender (`app/email/sender.py`)

**Files:**
- Create: `backend/app/email/sender.py`
- Test: `backend/tests/test_email_sender.py`

**Interfaces:**
- Consumes: `Settings` (`google_service_account_json`, `google_delegated_user`, `from_email`).
- Produces: `class EmailSendError(Exception)` (attr `reason`); `class GmailSender` with `__init__(settings, *, transport=None, now=time.time)` and `async send(self, *, to: str, subject: str, html: str, text: str) -> None`.

- [ ] **Step 1: Write the failing tests** — create `backend/tests/test_email_sender.py`:

```python
import asyncio
import base64
import json
from urllib.parse import parse_qs

import httpx
import jwt
import pytest
from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric import rsa

from app.config import Settings
from app.email.sender import EmailSendError, GmailSender

DELEGATED = "noreply@fountainrank.com"


@pytest.fixture
def sa_json():
    key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    pem = key.private_bytes(
        serialization.Encoding.PEM,
        serialization.PrivateFormat.PKCS8,
        serialization.NoEncryption(),
    ).decode()
    return json.dumps(
        {"client_email": "mailer@fountainrank.iam.gserviceaccount.com", "private_key": pem}
    )


@pytest.fixture
def settings(sa_json):
    return Settings(
        google_service_account_json=sa_json,
        google_delegated_user=DELEGATED,
        from_email=DELEGATED,
        logto_email_webhook_token="t",
    )


def _transport(captured, *, token_status=200, send_status=200):
    def handler(request: httpx.Request) -> httpx.Response:
        if "oauth2.googleapis.com" in str(request.url):
            captured["token_count"] = captured.get("token_count", 0) + 1
            captured["token_body"] = parse_qs(request.content.decode())
            if token_status != 200:
                return httpx.Response(token_status, json={"error": "bad"})
            return httpx.Response(200, json={"access_token": "ya29.test", "expires_in": 3600})
        if "gmail.googleapis.com" in str(request.url):
            captured["send_auth"] = request.headers.get("authorization")
            captured["send_body"] = json.loads(request.content.decode())
            captured["send_count"] = captured.get("send_count", 0) + 1
            if send_status != 200:
                return httpx.Response(send_status, json={"error": "nope"})
            return httpx.Response(200, json={"id": "msg-1"})
        return httpx.Response(404)

    return httpx.MockTransport(handler)


async def test_send_builds_correct_assertion_and_sends(settings, sa_json):
    captured = {}
    sender = GmailSender(settings, transport=_transport(captured))
    await sender.send(to="u@example.com", subject="S", html="<b>h</b>", text="t")
    # Assertion claims (decode without verifying signature — we only assert the shape).
    assertion = captured["token_body"]["assertion"][0]
    claims = jwt.decode(assertion, options={"verify_signature": False})
    assert claims["iss"] == "mailer@fountainrank.iam.gserviceaccount.com"
    assert claims["sub"] == DELEGATED
    assert claims["scope"] == "https://www.googleapis.com/auth/gmail.send"
    assert claims["aud"] == "https://oauth2.googleapis.com/token"
    assert (
        captured["token_body"]["grant_type"][0]
        == "urn:ietf:params:oauth:grant-type:jwt-bearer"
    )
    # Send used the bearer token and posted a base64url MIME with To + Subject.
    assert captured["send_auth"] == "Bearer ya29.test"
    raw = base64.urlsafe_b64decode(captured["send_body"]["raw"]).decode()
    assert "To: u@example.com" in raw
    assert "Subject: S" in raw


async def test_access_token_is_cached_across_sends(settings):
    captured = {}
    sender = GmailSender(settings, transport=_transport(captured))
    await sender.send(to="a@x.com", subject="S", html="<b>h</b>", text="t")
    await sender.send(to="b@x.com", subject="S", html="<b>h</b>", text="t")
    assert captured["send_count"] == 2
    assert captured["token_count"] == 1  # token fetched once, then cached across sends


async def test_token_endpoint_failure_raises(settings):
    sender = GmailSender(settings, transport=_transport({}, token_status=400))
    with pytest.raises(EmailSendError) as ei:
        await sender.send(to="u@x.com", subject="S", html="<b>h</b>", text="t")
    assert ei.value.reason == "token_request_failed"


async def test_gmail_send_failure_raises(settings):
    sender = GmailSender(settings, transport=_transport({}, send_status=500))
    with pytest.raises(EmailSendError) as ei:
        await sender.send(to="u@x.com", subject="S", html="<b>h</b>", text="t")
    assert ei.value.reason == "gmail_send_failed"


def _bad_settings(sa_json: str) -> Settings:
    return Settings(
        google_service_account_json=sa_json,
        google_delegated_user=DELEGATED,
        from_email=DELEGATED,
        logto_email_webhook_token="t",
    )


async def test_bad_service_account_json_raises():
    sender = GmailSender(_bad_settings("not json"), transport=_transport({}))
    with pytest.raises(EmailSendError) as ei:
        await sender.send(to="u@x.com", subject="S", html="<b>h</b>", text="t")
    assert ei.value.reason == "bad_service_account_json"


async def test_incomplete_service_account_raises():
    sender = GmailSender(_bad_settings('{"client_email":"x"}'), transport=_transport({}))
    with pytest.raises(EmailSendError) as ei:
        await sender.send(to="u@x.com", subject="S", html="<b>h</b>", text="t")
    assert ei.value.reason == "incomplete_service_account"


async def test_invalid_pem_raises():
    sender = GmailSender(
        _bad_settings('{"client_email":"x","private_key":"not-a-pem"}'), transport=_transport({})
    )
    with pytest.raises(EmailSendError) as ei:
        await sender.send(to="u@x.com", subject="S", html="<b>h</b>", text="t")
    assert ei.value.reason == "assertion_failed"


async def test_token_response_invalid_raises(settings):
    def handler(request):
        if "oauth2.googleapis.com" in str(request.url):
            return httpx.Response(200, text="<html>not json</html>")
        return httpx.Response(404)

    sender = GmailSender(settings, transport=httpx.MockTransport(handler))
    with pytest.raises(EmailSendError) as ei:
        await sender.send(to="u@x.com", subject="S", html="<b>h</b>", text="t")
    assert ei.value.reason == "token_response_invalid"


async def test_token_response_without_access_token_raises(settings):
    def handler(request):
        if "oauth2.googleapis.com" in str(request.url):
            return httpx.Response(200, json={"no_token": True})
        return httpx.Response(404)

    sender = GmailSender(settings, transport=httpx.MockTransport(handler))
    with pytest.raises(EmailSendError) as ei:
        await sender.send(to="u@x.com", subject="S", html="<b>h</b>", text="t")
    assert ei.value.reason == "token_response_invalid"


async def test_token_refreshed_after_expiry(settings):
    captured = {}
    clock = {"t": 1000.0}
    sender = GmailSender(settings, transport=_transport(captured), now=lambda: clock["t"])
    await sender.send(to="a@x.com", subject="S", html="<b>h</b>", text="t")  # exp = 1000 + 3600
    assert captured["token_count"] == 1
    clock["t"] = 4600.0 - 30  # within 60s of expiry -> must refresh
    await sender.send(to="b@x.com", subject="S", html="<b>h</b>", text="t")
    assert captured["token_count"] == 2


async def test_concurrent_sends_make_one_token_request(settings):
    captured = {}
    sender = GmailSender(settings, transport=_transport(captured))
    await asyncio.gather(
        sender.send(to="a@x.com", subject="S", html="<b>h</b>", text="t"),
        sender.send(to="b@x.com", subject="S", html="<b>h</b>", text="t"),
    )
    assert captured["token_count"] == 1  # lock + double-check prevents a duplicate fetch
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd /d/repos/fountainrank/backend && uv run pytest tests/test_email_sender.py -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'app.email.sender'`.

- [ ] **Step 3: Implement** — create `backend/app/email/sender.py`:

```python
"""Send mail via the Gmail API using an OAuth2 JWT-bearer service-account flow with
domain-wide delegation (impersonating the configured `noreply@` mailbox). No google-auth:
we RS256-sign a short assertion with PyJWT and exchange it for an access token over httpx,
cache the token until ~60s before expiry, then POST a base64url MIME to the Gmail send
endpoint. The constructor does no parsing/I/O (it cannot raise — so auth always runs first);
the service-account JSON is parsed lazily and every credential/token failure becomes a typed
EmailSendError. The transport is injectable so tests run with no network."""

import asyncio
import base64
import json
import time
from collections.abc import Callable
from email.message import EmailMessage

import httpx
import jwt

from app.config import Settings

_TOKEN_ENDPOINT = "https://oauth2.googleapis.com/token"
_GMAIL_SEND = "https://gmail.googleapis.com/gmail/v1/users/me/messages/send"
_SCOPE = "https://www.googleapis.com/auth/gmail.send"
_JWT_BEARER = "urn:ietf:params:oauth:grant-type:jwt-bearer"


class EmailSendError(Exception):
    """A transactional email could not be sent. `reason` is a short code for logging —
    never carries the verification code, token, or key material."""

    def __init__(self, reason: str):
        self.reason = reason
        super().__init__(reason)


class GmailSender:
    def __init__(
        self,
        settings: Settings,
        *,
        transport: httpx.AsyncBaseTransport | None = None,
        now: Callable[[], float] = time.time,
    ):
        # No parsing/I/O here — construction must never raise (auth runs before any cred work).
        self._sa_json = settings.google_service_account_json
        self._delegated = settings.google_delegated_user
        self._from = settings.from_email or settings.google_delegated_user
        self._transport = transport
        self._now = now
        self._token: str | None = None
        self._token_exp = 0.0
        self._lock = asyncio.Lock()

    def _client(self) -> httpx.AsyncClient:
        return httpx.AsyncClient(transport=self._transport, timeout=10.0)

    def _credentials(self) -> tuple[str, str]:
        try:
            sa = json.loads(self._sa_json or "{}")
        except (ValueError, TypeError) as exc:
            raise EmailSendError("bad_service_account_json") from exc
        client_email = sa.get("client_email")
        private_key = sa.get("private_key")
        if not client_email or not private_key:
            raise EmailSendError("incomplete_service_account")
        return client_email, private_key

    async def _access_token(self) -> str:
        now = self._now()
        if self._token and now < self._token_exp - 60:
            return self._token
        async with self._lock:
            now = self._now()
            if self._token and now < self._token_exp - 60:
                return self._token
            client_email, private_key = self._credentials()
            try:
                assertion = jwt.encode(
                    {
                        "iss": client_email,
                        "sub": self._delegated,
                        "scope": _SCOPE,
                        "aud": _TOKEN_ENDPOINT,
                        "iat": int(now),
                        "exp": int(now) + 3600,
                    },
                    private_key,
                    algorithm="RS256",
                )
            except Exception as exc:  # invalid PEM / unusable key
                raise EmailSendError("assertion_failed") from exc
            try:
                async with self._client() as client:
                    resp = await client.post(
                        _TOKEN_ENDPOINT,
                        data={"grant_type": _JWT_BEARER, "assertion": assertion},
                    )
            except httpx.HTTPError as exc:
                raise EmailSendError("token_request_failed") from exc
            if resp.status_code != 200:
                raise EmailSendError("token_request_failed")
            try:
                data = resp.json()
                token = data["access_token"]
                expires_in = float(data.get("expires_in", 3600))
            except (ValueError, KeyError, TypeError) as exc:
                raise EmailSendError("token_response_invalid") from exc
            self._token = token
            self._token_exp = now + expires_in
            return token

    async def send(self, *, to: str, subject: str, html: str, text: str) -> None:
        token = await self._access_token()
        msg = EmailMessage()
        msg["From"] = self._from
        msg["To"] = to
        msg["Subject"] = subject
        msg.set_content(text)
        msg.add_alternative(html, subtype="html")
        raw = base64.urlsafe_b64encode(msg.as_bytes()).decode()
        try:
            async with self._client() as client:
                resp = await client.post(
                    _GMAIL_SEND,
                    headers={"Authorization": f"Bearer {token}"},
                    json={"raw": raw},
                )
        except httpx.HTTPError as exc:
            raise EmailSendError("gmail_send_failed") from exc
        if resp.status_code // 100 != 2:
            raise EmailSendError("gmail_send_failed")
```

- [ ] **Step 4: Run to verify pass**

Run: `cd /d/repos/fountainrank/backend && uv run pytest tests/test_email_sender.py -v`
Expected: PASS. Then `uv run ruff check app/email/sender.py tests/test_email_sender.py` + `uv run ruff format --check` the same — clean.

- [ ] **Step 5: Commit**

```bash
cd /d/repos/fountainrank
git add backend/app/email/sender.py backend/tests/test_email_sender.py
git commit -m "feat(backend): Gmail sender (JWT-bearer service-account delegation, cached token)"
```

---

### Task 4: Webhook route + main wiring + conftest reset

**Files:**
- Create: `backend/app/routers/email_webhook.py`
- Modify: `backend/app/main.py` (register the router), `backend/tests/conftest.py` (reset the sender singleton)
- Test: `backend/tests/test_email_webhook.py`

**Interfaces:**
- Consumes: `render` (Task 2), `GmailSender`/`EmailSendError` (Task 3), `Settings`/`get_settings`.
- Produces: FastAPI router with `POST /internal/email`; dependency `get_gmail_sender(settings) -> GmailSender | None` (process singleton when configured, else None).

- [ ] **Step 1: Write the failing tests** — create `backend/tests/test_email_webhook.py`:

```python
import pytest
from httpx import ASGITransport, AsyncClient

from app.config import Settings, get_settings
from app.email.sender import EmailSendError
from app.main import app
from app.routers.email_webhook import get_gmail_sender

TOKEN = "secret-webhook-token"
PRIVATE_KEY_MARKER = "PRIVATEKEYMARKER"
SA_JSON = '{"client_email":"x","private_key":"' + PRIVATE_KEY_MARKER + '"}'


class FakeSender:
    def __init__(self):
        self.sent = []
        self.raise_reason = None

    async def send(self, *, to, subject, html, text):
        if self.raise_reason:
            raise EmailSendError(self.raise_reason)
        self.sent.append({"to": to, "subject": subject})


@pytest.fixture
def configured():
    fake = FakeSender()
    app.dependency_overrides[get_settings] = lambda: Settings(
        logto_email_webhook_token=TOKEN,
        google_service_account_json=SA_JSON,
        google_delegated_user="noreply@fountainrank.com",
    )
    app.dependency_overrides[get_gmail_sender] = lambda: fake
    yield fake
    app.dependency_overrides.pop(get_settings, None)
    app.dependency_overrides.pop(get_gmail_sender, None)


async def _post(headers, body):
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        return await ac.post("/internal/email", headers=headers, json=body)


VALID_BODY = {
    "to": "u@example.com",
    "type": "SignIn",
    "payload": {"code": "123456", "locale": "en"},
}


async def test_valid_request_sends_and_returns_200(configured):
    resp = await _post({"Authorization": f"Bearer {TOKEN}"}, VALID_BODY)
    assert resp.status_code == 200
    assert configured.sent and configured.sent[0]["to"] == "u@example.com"


async def test_bad_token_is_401(configured):
    resp = await _post({"Authorization": "Bearer wrong"}, VALID_BODY)
    assert resp.status_code == 401
    assert not configured.sent


async def test_missing_token_is_401(configured):
    resp = await _post({}, VALID_BODY)
    assert resp.status_code == 401


async def test_unconfigured_is_503():
    # No overrides -> default Settings has email_configured False.
    app.dependency_overrides.pop(get_settings, None)
    app.dependency_overrides.pop(get_gmail_sender, None)
    resp = await _post({"Authorization": "Bearer whatever"}, VALID_BODY)
    assert resp.status_code == 503


async def test_empty_payload_is_422(configured):
    resp = await _post(
        {"Authorization": f"Bearer {TOKEN}"},
        {"to": "u@example.com", "type": "SignIn", "payload": {"locale": "en"}},
    )
    assert resp.status_code == 422


async def test_unknown_type_still_sends(configured):
    resp = await _post(
        {"Authorization": f"Bearer {TOKEN}"},
        {"to": "u@example.com", "type": "Weird", "payload": {"code": "111222"}},
    )
    assert resp.status_code == 200


async def test_sender_failure_is_502(configured):
    configured.raise_reason = "gmail_send_failed"
    resp = await _post({"Authorization": f"Bearer {TOKEN}"}, VALID_BODY)
    assert resp.status_code == 502


async def test_secrets_never_logged_on_success_and_failure(configured, caplog):
    # Capture ALL loggers (not just app.email), across a success AND a sender-failure path.
    with caplog.at_level("INFO"):
        await _post({"Authorization": f"Bearer {TOKEN}"}, VALID_BODY)
        configured.raise_reason = "gmail_send_failed"
        await _post({"Authorization": f"Bearer {TOKEN}"}, VALID_BODY)
    assert caplog.records  # something was logged
    for rec in caplog.records:
        for value in rec.__dict__.values():
            assert "123456" not in str(value)  # the verification code
            assert TOKEN not in str(value)  # the webhook token
            assert PRIVATE_KEY_MARKER not in str(value)  # service-account key material
        assert "123456" not in rec.getMessage()


async def test_auth_checked_before_body_parse(configured):
    # A bad token with a NON-JSON body must be 401 (auth first), never 422 (parse first).
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        resp = await ac.post(
            "/internal/email",
            headers={"Authorization": "Bearer wrong", "Content-Type": "application/json"},
            content=b"not-json{{{",
        )
    assert resp.status_code == 401
    assert not configured.sent


async def test_malformed_creds_with_bad_token_is_401_not_500():
    # email_configured is True but the SA JSON is malformed; a bad token must still be 401.
    # get_gmail_sender is NOT overridden -> the real (lazy) sender is built and must not 500.
    app.dependency_overrides[get_settings] = lambda: Settings(
        logto_email_webhook_token=TOKEN,
        google_service_account_json="not json",
        google_delegated_user="noreply@fountainrank.com",
    )
    try:
        resp = await _post({"Authorization": "Bearer wrong"}, VALID_BODY)
        assert resp.status_code == 401
    finally:
        app.dependency_overrides.pop(get_settings, None)
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd /d/repos/fountainrank/backend && uv run pytest tests/test_email_webhook.py -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'app.routers.email_webhook'`.

- [ ] **Step 3: Implement the router** — create `backend/app/routers/email_webhook.py`:

```python
"""Logto HTTP email connector webhook. Logto POSTs {to, type, payload:{code,...}} here when
it needs to send an auth email; we authenticate the shared bearer token (constant-time),
render the template, and send via the Gmail API. Fails closed: 503 unconfigured, 401 bad
token, 422 bad payload, 502 send failure, 200 sent. Never logs the code/token/key."""

import hmac
import logging
import time

from fastapi import APIRouter, Depends, Header, HTTPException, Request, status
from pydantic import BaseModel

from app.config import Settings, get_settings
from app.email.sender import EmailSendError, GmailSender
from app.email.templates import render

router = APIRouter(prefix="/internal", tags=["internal"])
logger = logging.getLogger("app.email")

_sender: GmailSender | None = None


def get_gmail_sender(settings: Settings = Depends(get_settings)) -> GmailSender | None:
    # Construction does no parsing/I/O (lazy creds), so resolving this dependency before the
    # in-handler auth check cannot raise or leak — auth still gates the actual send.
    global _sender
    if not settings.email_configured:
        return None
    if _sender is None:
        _sender = GmailSender(settings)
    return _sender


class _Payload(BaseModel):
    code: str | None = None
    link: str | None = None
    locale: str | None = None


class _EmailRequest(BaseModel):
    to: str
    type: str = "Generic"
    payload: _Payload = _Payload()


def _bearer(authorization: str | None) -> str | None:
    if not authorization:
        return None
    scheme, _, token = authorization.partition(" ")
    return token.strip() if scheme.lower() == "bearer" and token.strip() else None


# include_in_schema=False keeps this internal webhook out of the OpenAPI doc (and therefore
# out of the generated api-client) — it is Logto-to-backend only, not a public API.
@router.post("/email", include_in_schema=False)
async def send_email(
    request: Request,
    authorization: str | None = Header(default=None),
    settings: Settings = Depends(get_settings),
    sender: GmailSender | None = Depends(get_gmail_sender),
) -> dict:
    # Auth BEFORE any body processing: 503 if unconfigured, 401 on bad/missing token.
    if not settings.email_configured or sender is None:
        raise HTTPException(status.HTTP_503_SERVICE_UNAVAILABLE, detail="email not configured")
    token = _bearer(authorization)
    if not token or not hmac.compare_digest(token, settings.logto_email_webhook_token or ""):
        logger.warning("email webhook auth failed")
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, detail="unauthorized")
    try:
        req = _EmailRequest.model_validate(await request.json())
    except ValueError:  # JSONDecodeError + pydantic v2 ValidationError are both ValueError
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_CONTENT, detail="invalid request"
        ) from None
    if not req.to.strip() or "@" not in req.to or not (req.payload.code or req.payload.link):
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, detail="invalid request")
    subject, html, text = render(req.type, req.payload.model_dump())
    to_domain = req.to.rpartition("@")[2]  # log the domain only, never the full address/code
    start = time.monotonic()
    try:
        await sender.send(to=req.to, subject=subject, html=html, text=text)
    except EmailSendError as exc:
        logger.error(
            "email send failed",
            extra={
                "reason": exc.reason,
                "email_type": req.type,
                "to_domain": to_domain,
                "latency_ms": round((time.monotonic() - start) * 1000),
            },
        )
        raise HTTPException(status.HTTP_502_BAD_GATEWAY, detail="send failed") from exc
    logger.info(
        "email sent",
        extra={
            "email_type": req.type,
            "to_domain": to_domain,
            "latency_ms": round((time.monotonic() - start) * 1000),
        },
    )
    return {"message": "sent"}
```

`HTTPException` is handled by FastAPI's default handler (before the generic `Exception` handler in `main.py`), so each `raise` returns the intended status with a JSON body. `from None` on the parse path avoids chaining the parse error. `except ValueError` covers both a non-JSON body (`json.JSONDecodeError`) and a schema mismatch (Pydantic v2 `ValidationError` subclasses `ValueError`).

- [ ] **Step 4: Register the router** — in `backend/app/main.py`, add `email_webhook` to the routers import and include it:

Change `from app.routers import fountains, health, rating_types` to `from app.routers import email_webhook, fountains, health, rating_types`, and add after `app.include_router(fountains.router)`:

```python
    app.include_router(email_webhook.router)
```

- [ ] **Step 5: Add the sender-singleton reset fixture** — append to `backend/tests/conftest.py`:

```python
@pytest.fixture(autouse=True)
def reset_email_sender():
    """Reset the process-singleton Gmail sender after each test (order-independence)."""
    yield
    import app.routers.email_webhook as _ew

    _ew._sender = None
```

- [ ] **Step 6: Run to verify pass**

Run: `cd /d/repos/fountainrank/backend && uv run pytest tests/test_email_webhook.py -v`
Expected: PASS (all cases). Then `uv run ruff check app/routers/email_webhook.py app/main.py tests/test_email_webhook.py tests/conftest.py` + `uv run ruff format --check` the same — clean.

- [ ] **Step 7: Commit**

```bash
cd /d/repos/fountainrank
git add backend/app/routers/email_webhook.py backend/app/main.py backend/tests/conftest.py backend/tests/test_email_webhook.py
git commit -m "feat(backend): /internal/email webhook (token-auth, render, Gmail send, fail-closed)"
```

---

### Task 5: Infra wiring — backend env + deploy.yml secrets/vars

**Files:**
- Modify: `infra/k8s/backend.yaml`, `.github/workflows/deploy.yml`, `infra/k8s/secrets.yaml`

**Interfaces:**
- Consumes: GitHub `production` secrets `GOOGLE_SERVICE_ACCOUNT_JSON`, `LOGTO_EMAIL_WEBHOOK_TOKEN`; variables `GOOGLE_DELEGATED_USER`, `FROM_EMAIL`.
- Produces: the backend pod with the four email env vars; `fountainrank-secrets` carrying the two new keys.

- [ ] **Step 1: Add env to `infra/k8s/backend.yaml`** — inside the backend container's `env:` list, after the `DB_SSL_ROOT_CERT` entry, add:

```yaml
            # Email (Logto HTTP email connector -> Gmail API). Secrets from fountainrank-secrets;
            # delegated user + From are non-secret, substituted from GitHub env vars at deploy.
            - name: GOOGLE_SERVICE_ACCOUNT_JSON
              valueFrom:
                secretKeyRef:
                  name: fountainrank-secrets
                  key: google-service-account-json
            - name: LOGTO_EMAIL_WEBHOOK_TOKEN
              valueFrom:
                secretKeyRef:
                  name: fountainrank-secrets
                  key: logto-email-webhook-token
            - name: GOOGLE_DELEGATED_USER
              value: "${GOOGLE_DELEGATED_USER}"
            - name: FROM_EMAIL
              value: "${FROM_EMAIL}"
```

- [ ] **Step 2: Wire the secrets in `.github/workflows/deploy.yml`** — in the "Create app + registry secrets imperatively" step, add to its `env:` block:

```yaml
          GOOGLE_SERVICE_ACCOUNT_JSON: ${{ secrets.GOOGLE_SERVICE_ACCOUNT_JSON }}
          LOGTO_EMAIL_WEBHOOK_TOKEN: ${{ secrets.LOGTO_EMAIL_WEBHOOK_TOKEN }}
```

and add two `--from-literal` lines to the `kubectl create secret generic fountainrank-secrets` command (after the `logto-db-url` line):

```bash
            --from-literal=google-service-account-json="$GOOGLE_SERVICE_ACCOUNT_JSON" \
            --from-literal=logto-email-webhook-token="$LOGTO_EMAIL_WEBHOOK_TOKEN" \
```

- [ ] **Step 3: Pass the non-secret vars to envsubst** — in the "Render + apply workloads" step of `deploy.yml`, add an `env:` block to the step and the two vars to the `export` line:

The step becomes:
```yaml
      - name: Render + apply workloads
        env:
          GOOGLE_DELEGATED_USER: ${{ vars.GOOGLE_DELEGATED_USER }}
          FROM_EMAIL: ${{ vars.FROM_EMAIL }}
        run: |
          export NAMESPACE ENVIRONMENT IMAGE_TAG REGISTRY DOMAIN GOOGLE_DELEGATED_USER FROM_EMAIL
          for f in backend web logto ingress; do
            envsubst < "infra/k8s/$f.yaml" | kubectl apply -f -
          done
```

(Only the `env:` block and the two names appended to `export` are new; the loop is unchanged.)

- [ ] **Step 4: Document the new keys in `infra/k8s/secrets.yaml`** — under `stringData:`, add:

```yaml
  # REQUIRED for email (set empty disables sending -> the /internal/email webhook 503s).
  # The Google service-account JSON key (whole file) used for Gmail-API sending via
  # domain-wide delegation; created imperatively in deploy.yml from the production env secret.
  google-service-account-json: ""
  # Shared bearer token the Logto HTTP email connector sends to /internal/email; the backend
  # constant-time compares it. From the production env secret LOGTO_EMAIL_WEBHOOK_TOKEN.
  logto-email-webhook-token: ""
```

- [ ] **Step 5: Validate the manifest renders + passes kubeconform**

Run (Git Bash):
```bash
cd /d/repos/fountainrank
NAMESPACE=fountainrank ENVIRONMENT=production IMAGE_TAG=test \
  REGISTRY=registry.digitalocean.com/fountainrank DOMAIN=fountainrank.com \
  GOOGLE_DELEGATED_USER=noreply@fountainrank.com FROM_EMAIL=noreply@fountainrank.com \
  envsubst < infra/k8s/backend.yaml | "$(go env GOPATH)/bin/kubeconform" -strict -kubernetes-version 1.34.0 -summary -
```
Expected: `Valid: 2, Invalid: 0, Errors: 0`, no leftover `${...}`. (If kubeconform is absent: `go install github.com/yannh/kubeconform/cmd/kubeconform@v0.6.7`.)

- [ ] **Step 6: Commit**

```bash
cd /d/repos/fountainrank
git add infra/k8s/backend.yaml .github/workflows/deploy.yml infra/k8s/secrets.yaml
git commit -m "build(infra): wire Gmail service-account + webhook-token secrets into backend deploy"
```

---

### Task 6: Docs + full local CI mirror

**Files:**
- Modify: `docs/setup/06-logto.md` (HTTP email connector setup), `claude_help/email.md` (realized architecture)

**Interfaces:**
- Consumes: everything above. Produces: accurate operator + design docs, and a green full CI mirror.

- [ ] **Step 1: Update `docs/setup/06-logto.md`** — replace the **Email (passwordless magic link)** bullet under `## Step 2 — Connectors` with:

```markdown
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
```

- [ ] **Step 2: Update `claude_help/email.md`** — replace the `## Transport` section's **Primary** bullet with the realized architecture:

```markdown
- **Primary:** Logto's built-in **HTTP email connector** calls an authenticated webhook on
  the FastAPI backend (`POST /internal/email`, in-cluster, shared bearer token), which sends
  via the **Gmail API** using a Google **service account with domain-wide delegation**
  (scope `gmail.send`) impersonating `noreply@fountainrank.com`. No SMTP, no app password,
  no custom Logto connector image. See `docs/specs/2026-06-19-email-gmail-connector-design.md`.
```

- [ ] **Step 3: Full backend check**

Run: `cd /d/repos/fountainrank && powershell.exe -NoProfile -File run.ps1 check -Backend`
Expected: ruff ✓, format ✓, `alembic upgrade` ✓, `alembic check` (drift-free) ✓, pytest — all pass (the existing suite + the new email tests).

- [ ] **Step 4: Full local CI mirror**

Run: `cd /d/repos/fountainrank && powershell.exe -NoProfile -File run.ps1 check`
Expected: backend + frontend lint/typecheck/test + web build + mobile all green. The `/internal/email` route is registered `include_in_schema=False`, so it does **not** appear in the OpenAPI schema and `pnpm run generate` produces **no** api-client change. Afterward run `git status --short` and confirm the only modified file is the owner's `docs/setup/04-apple-and-app-stores.md` — **no `packages/api-client/` diff**. If a client diff appears, STOP and investigate (the route leaked into the schema); do not blindly commit generated output.

- [ ] **Step 5: Commit**

```bash
cd /d/repos/fountainrank
git add docs/setup/06-logto.md claude_help/email.md
git commit -m "docs: document the HTTP-email-connector -> backend -> Gmail-API email path"
```

---

## After all tasks

Open the PR → CI green → **Codex Loop B** to `VERDICT: APPROVED` → address all comments → squash-merge. **Owner, post-merge (gated):** set the `production` secrets/vars (`GOOGLE_SERVICE_ACCOUNT_JSON`, `LOGTO_EMAIL_WEBHOOK_TOKEN`, `GOOGLE_DELEGATED_USER`, `FROM_EMAIL`), deploy (tag `v*.*.*`), configure Logto's HTTP email connector (endpoint + token), and send a test email.

## Self-review notes (coverage vs spec)

§4.1 architecture → Tasks 3+4. §4.2 webhook (auth/parse/render/send/codes/logging) → Task 4. §4.3 Gmail sender → Task 3. §4.4 templates → Task 2. §4.5 config → Task 1. §4.6 deps (`jinja2` only) → Task 2. §4.7 infra → Task 5. §4.8 owner tasks → "After all tasks". §5 error handling (401/422/503/502/200, no silent 500) → Task 4. §6 security (constant-time token, least-priv, no secret logging) → Tasks 3+4. §7 testing → Tasks 1–4. §8 acceptance → all + PR/Codex gate.
