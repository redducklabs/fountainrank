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
    # Always run the constant-time compare (even when no/blank token is sent) so the
    # missing-token and wrong-token paths are indistinguishable by response timing.
    token = _bearer(authorization) or ""
    if not hmac.compare_digest(token, settings.logto_email_webhook_token or ""):
        logger.warning("email webhook auth failed")
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, detail="unauthorized")
    try:
        req = _EmailRequest.model_validate(await request.json())
    except ValueError:  # JSONDecodeError + pydantic v2 ValidationError are both ValueError
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_CONTENT, detail="invalid request"
        ) from None
    if (
        not req.to.strip()
        or "@" not in req.to
        or any(ord(c) < 32 for c in req.to)  # reject CR/LF/control chars (header injection)
        or not (req.payload.code or req.payload.link)
    ):
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
