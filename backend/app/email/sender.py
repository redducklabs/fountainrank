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
