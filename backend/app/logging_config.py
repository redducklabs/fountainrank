"""Structured logging for the backend.

Logs are emitted as one-line JSON (production) or human-readable text (dev) to
stdout, so the platform (DOKS) captures them. A per-request correlation id is
carried on a contextvar and stamped onto every record, so any line — including a
stack trace from a failed request — can be tied back to the request that caused
it. See CLAUDE.md "Logging & Observability".
"""

import contextvars
import json
import logging
import re
import sys
from datetime import UTC, datetime
from typing import Any

# Per-request correlation id. Set by RequestContextMiddleware at the start of each
# request (each request runs in its own asyncio Task with its own context copy, so
# no reset is needed — the value never leaks between requests).
request_id_var: contextvars.ContextVar[str] = contextvars.ContextVar("request_id", default="-")

# Standard LogRecord attributes — everything else on a record is a custom `extra`
# field and is merged into the JSON payload.
_RESERVED_RECORD_ATTRS = {
    "name",
    "msg",
    "args",
    "levelname",
    "levelno",
    "pathname",
    "filename",
    "module",
    "exc_info",
    "exc_text",
    "stack_info",
    "lineno",
    "funcName",
    "created",
    "msecs",
    "relativeCreated",
    "thread",
    "threadName",
    "processName",
    "process",
    "taskName",
    "message",
    "asctime",
    "request_id",
}

_PASSWORD_IN_URL = re.compile(r"(://[^:/@]+:)[^@/]+(@)")


def redact_url(url: str) -> str:
    """Mask the password in a database/connection URL for safe logging."""
    return _PASSWORD_IN_URL.sub(r"\1***\2", url)


class RequestIdFilter(logging.Filter):
    """Stamp the current request id from the contextvar onto every record."""

    def filter(self, record: logging.LogRecord) -> bool:
        record.request_id = request_id_var.get()
        return True


class JsonFormatter(logging.Formatter):
    """One-line JSON formatter for log aggregation."""

    def format(self, record: logging.LogRecord) -> str:
        payload: dict[str, Any] = {
            "timestamp": datetime.fromtimestamp(record.created, tz=UTC).isoformat(),
            "level": record.levelname,
            "logger": record.name,
            "message": record.getMessage(),
            "request_id": getattr(record, "request_id", "-"),
        }
        for key, value in record.__dict__.items():
            if key not in _RESERVED_RECORD_ATTRS and not key.startswith("_"):
                payload[key] = value
        if record.exc_info:
            payload["exception"] = self.formatException(record.exc_info)
        if record.stack_info:
            payload["stack"] = self.formatStack(record.stack_info)
        return json.dumps(payload, default=str)


def configure_logging(level: str = "INFO", fmt: str = "json") -> None:
    """Install a single stdout handler on the root logger. Idempotent."""
    handler = logging.StreamHandler(sys.stdout)
    handler.addFilter(RequestIdFilter())
    if fmt == "json":
        handler.setFormatter(JsonFormatter())
    else:
        handler.setFormatter(
            logging.Formatter("%(asctime)s %(levelname)-7s %(name)s [%(request_id)s] %(message)s")
        )

    root = logging.getLogger()
    root.handlers.clear()
    root.addHandler(handler)
    root.setLevel(level.upper())

    # Route uvicorn's own loggers through our root handler. Silence its access log —
    # RequestContextMiddleware emits richer per-request lines, so the default access
    # log would only duplicate them.
    for name in ("uvicorn", "uvicorn.error"):
        logger = logging.getLogger(name)
        logger.handlers.clear()
        logger.propagate = True
    access = logging.getLogger("uvicorn.access")
    access.handlers.clear()
    access.propagate = False


def log_startup(settings: Any) -> None:
    """Log a single startup line with the resolved config (secrets redacted)."""
    logging.getLogger("app").info(
        "starting backend",
        extra={
            "app_name": settings.app_name,
            "log_level": settings.log_level,
            "log_format": settings.log_format,
            "dev_auth_enabled": settings.dev_auth_enabled,
            "email_configured": settings.email_configured,
            "from_email": settings.from_email,
            "google_delegated_user": settings.google_delegated_user,
            # Non-secret Logto resolved config — surfaced so wrong-issuer/wrong-audience
            # 401s are diagnosable from the startup line alone (no secrets here).
            "logto_issuer": settings.logto_issuer,
            "logto_audience": settings.logto_audience,
            "logto_jwks_cache_ttl_seconds": settings.logto_jwks_cache_ttl_seconds,
            "db_tls": bool(settings.db_ssl_root_cert),
            "database_url": redact_url(settings.database_url),
            # Non-secret Spaces metadata — no access/secret keys here.
            "photos_enabled": settings.photos_enabled,
            "spaces_region": settings.spaces_region,
        },
    )
