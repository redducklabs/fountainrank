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
