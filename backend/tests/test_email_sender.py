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
        if request.url.host == "oauth2.googleapis.com":
            captured["token_count"] = captured.get("token_count", 0) + 1
            captured["token_body"] = parse_qs(request.content.decode())
            if token_status != 200:
                return httpx.Response(token_status, json={"error": "bad"})
            return httpx.Response(200, json={"access_token": "ya29.test", "expires_in": 3600})
        if request.url.host == "gmail.googleapis.com":
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
    assert captured["token_body"]["grant_type"][0] == "urn:ietf:params:oauth:grant-type:jwt-bearer"
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
        if request.url.host == "oauth2.googleapis.com":
            return httpx.Response(200, text="<html>not json</html>")
        return httpx.Response(404)

    sender = GmailSender(settings, transport=httpx.MockTransport(handler))
    with pytest.raises(EmailSendError) as ei:
        await sender.send(to="u@x.com", subject="S", html="<b>h</b>", text="t")
    assert ei.value.reason == "token_response_invalid"


async def test_token_response_without_access_token_raises(settings):
    def handler(request):
        if request.url.host == "oauth2.googleapis.com":
            return httpx.Response(200, json={"no_token": True})
        return httpx.Response(404)

    sender = GmailSender(settings, transport=httpx.MockTransport(handler))
    with pytest.raises(EmailSendError) as ei:
        await sender.send(to="u@x.com", subject="S", html="<b>h</b>", text="t")
    assert ei.value.reason == "token_response_invalid"


async def test_blank_access_token_rejected(settings):
    # A present-but-blank access_token is a token-shape failure -> typed EmailSendError.
    def handler(request):
        if request.url.host == "oauth2.googleapis.com":
            return httpx.Response(200, json={"access_token": "  ", "expires_in": 3600})
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


async def test_header_injection_in_to_raises_typed_error(settings):
    # A CR/LF in `to` makes EmailMessage raise ValueError; the sender must wrap it as a
    # typed EmailSendError (-> 502), never let it escape as a 500.
    captured = {}
    sender = GmailSender(settings, transport=_transport(captured))
    with pytest.raises(EmailSendError) as ei:
        await sender.send(to="u@x.com\r\nBcc: evil@x.com", subject="S", html="<b>h</b>", text="t")
    assert ei.value.reason == "message_build_failed"
