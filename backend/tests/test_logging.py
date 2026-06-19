import json
import logging
import sys

from fastapi import FastAPI
from fastapi.responses import JSONResponse
from httpx import ASGITransport, AsyncClient

from app.logging_config import JsonFormatter, redact_url
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
        return JSONResponse(status_code=500, content={"detail": "internal server error"})

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


async def test_real_app_stamps_request_id_and_allows_cors(client):
    resp = await client.get("/healthz")
    assert resp.headers.get("x-request-id")

    resp = await client.get("/healthz", headers={"Origin": "https://fountainrank.com"})
    assert resp.headers.get("access-control-allow-origin") == "https://fountainrank.com"
