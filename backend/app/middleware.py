"""Request-context ASGI middleware.

Pure-ASGI (not BaseHTTPMiddleware) so the request-id contextvar it sets is visible
to the endpoint and to the exception handler that run below it in the same task.
Assigns/propagates an ``X-Request-ID`` and logs each completed request with method,
path, status, and latency. Failed requests are logged (with a stack trace) by the
app's exception handler, so this middleware does not log them again.
"""

import logging
import time
import uuid

from starlette.types import ASGIApp, Message, Receive, Scope, Send

from app.logging_config import request_id_var

logger = logging.getLogger("app.request")

# Liveness/readiness probes hit these constantly; log them at DEBUG so production
# INFO logs stay readable.
_QUIET_PATHS = frozenset({"/healthz", "/readyz"})


class RequestContextMiddleware:
    def __init__(self, app: ASGIApp) -> None:
        self.app = app

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return

        headers = dict(scope.get("headers") or [])
        request_id = headers.get(b"x-request-id", b"").decode() or uuid.uuid4().hex
        request_id_var.set(request_id)

        start = time.perf_counter()
        status_code = 500

        async def send_wrapper(message: Message) -> None:
            nonlocal status_code
            if message["type"] == "http.response.start":
                status_code = message["status"]
                message["headers"] = [
                    *(message.get("headers") or []),
                    (b"x-request-id", request_id.encode()),
                ]
            await send(message)

        # On exception, propagate: the app's exception handler logs it with a stack
        # trace (and the same request_id, still set on this task's context).
        await self.app(scope, receive, send_wrapper)

        duration_ms = round((time.perf_counter() - start) * 1000, 2)
        client = scope.get("client")
        logger.log(
            logging.DEBUG if scope.get("path") in _QUIET_PATHS else logging.INFO,
            "request completed",
            extra={
                "method": scope.get("method"),
                "path": scope.get("path"),
                "status_code": status_code,
                "duration_ms": duration_ms,
                "client": client[0] if client else None,
            },
        )
