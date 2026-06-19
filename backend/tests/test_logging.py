import json
import logging
import sys

from fastapi import FastAPI
from fastapi.responses import JSONResponse
from httpx import ASGITransport, AsyncClient

from app.logging_config import JsonFormatter, log_startup, redact_url, request_id_var
from app.middleware import RequestContextMiddleware


def test_json_formatter_emits_structured_record():
    record = logging.LogRecord("app", logging.INFO, __file__, 1, "hello", None, None)
    record.request_id = "rid-123"
    record.method = "GET"
    out = json.loads(JsonFormatter().format(record))
    assert out["level"] == "INFO"
    assert out["message"] == "hello"
    assert out["request_id"] == "rid-123"
    assert out["method"] == "GET"  # custom `extra` field is merged in
    assert "timestamp" in out


def test_json_formatter_includes_exception_traceback():
    try:
        raise ValueError("boom")
    except ValueError:
        record = logging.LogRecord(
            "app", logging.ERROR, __file__, 1, "failed", None, sys.exc_info()
        )
    out = json.loads(JsonFormatter().format(record))
    assert "ValueError: boom" in out["exception"]


def test_redact_url_masks_password():
    masked = redact_url("postgresql+asyncpg://user:secretpw@host:5432/db")
    assert "secretpw" not in masked
    assert "user" in masked and "host" in masked and "***" in masked


def _logging_app() -> FastAPI:
    app = FastAPI()
    app.add_middleware(RequestContextMiddleware)

    @app.exception_handler(Exception)
    async def handler(request, exc):
        logging.getLogger("app").error("unhandled exception", exc_info=exc)
        # Mirror app/main.py: stamp the correlation id on the error response too, since
        # the 500 response is sent by ServerErrorMiddleware (above this middleware), so
        # the middleware's send_wrapper never gets to add the header on this path.
        return JSONResponse(
            status_code=500,
            content={"detail": "internal server error"},
            headers={"X-Request-ID": request_id_var.get()},
        )

    @app.get("/ok")
    async def ok():
        return {"ok": True}

    @app.get("/boom")
    async def boom():
        raise ValueError("kaboom")

    return app


async def test_request_id_header_generated_when_absent():
    transport = ASGITransport(app=_logging_app())
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        resp = await ac.get("/ok")
    assert resp.status_code == 200
    assert resp.headers.get("x-request-id")


async def test_incoming_request_id_is_preserved():
    transport = ASGITransport(app=_logging_app())
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        resp = await ac.get("/ok", headers={"X-Request-ID": "trace-abc"})
    assert resp.headers.get("x-request-id") == "trace-abc"


async def test_unhandled_exception_returns_500_and_is_logged(caplog):
    # raise_app_exceptions=False: Starlette's ServerErrorMiddleware re-raises after the
    # handler runs, so we tell the transport to return the 500 response instead.
    transport = ASGITransport(app=_logging_app(), raise_app_exceptions=False)
    with caplog.at_level(logging.ERROR, logger="app"):
        async with AsyncClient(transport=transport, base_url="http://test") as ac:
            resp = await ac.get("/boom")
    assert resp.status_code == 500
    assert resp.json() == {"detail": "internal server error"}
    assert any("unhandled exception" in r.message for r in caplog.records)


async def test_unhandled_exception_is_access_logged(caplog):
    # A 500 must still produce the "request completed" access line (status, latency,
    # client) — not only the exception log. Regression guard: the middleware previously
    # skipped the access log when the app raised.
    transport = ASGITransport(app=_logging_app(), raise_app_exceptions=False)
    with caplog.at_level(logging.INFO, logger="app.request"):
        async with AsyncClient(transport=transport, base_url="http://test") as ac:
            resp = await ac.get("/boom")
    assert resp.status_code == 500
    completed = [r for r in caplog.records if r.getMessage() == "request completed"]
    assert completed, "request-completed access log must fire even on a 500"
    assert completed[0].status_code == 500


async def test_unhandled_exception_response_carries_request_id():
    # The error response must echo the correlation id so a client can tie their failed
    # request back to the server logs.
    transport = ASGITransport(app=_logging_app(), raise_app_exceptions=False)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        resp = await ac.get("/boom", headers={"X-Request-ID": "trace-err"})
    assert resp.status_code == 500
    assert resp.headers.get("x-request-id") == "trace-err"


async def test_real_app_stamps_request_id_and_allows_cors(client):
    resp = await client.get("/healthz")
    assert resp.headers.get("x-request-id")

    resp = await client.get("/healthz", headers={"Origin": "https://fountainrank.com"})
    assert resp.headers.get("access-control-allow-origin") == "https://fountainrank.com"


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
