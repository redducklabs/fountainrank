import logging

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from app.config import get_settings
from app.logging_config import configure_logging, log_startup, request_id_var
from app.middleware import RequestContextMiddleware
from app.routers import (
    attribute_types,
    email_webhook,
    fountains,
    health,
    leaderboard,
    rating_types,
    users,
)


def create_app() -> FastAPI:
    settings = get_settings()
    configure_logging(level=settings.log_level, fmt=settings.log_format)

    app = FastAPI(title=settings.app_name)

    # CORS for the browser web client (inner). RequestContextMiddleware is added
    # last so it is the OUTERMOST app middleware: it stamps the request-id contextvar
    # and logs every request (including CORS preflight) around everything below it.
    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.cors_allow_origins,
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
        expose_headers=["X-Request-ID"],
    )
    app.add_middleware(RequestContextMiddleware)

    app.include_router(health.router)
    app.include_router(rating_types.router)
    app.include_router(attribute_types.router)
    app.include_router(fountains.router)
    app.include_router(leaderboard.router)
    app.include_router(users.router)
    app.include_router(email_webhook.router)

    @app.exception_handler(Exception)
    async def unhandled_exception_handler(request: Request, exc: Exception) -> JSONResponse:
        # Centralized 500 logging: full stack trace + request context, never silent.
        logging.getLogger("app").error(
            "unhandled exception",
            exc_info=exc,
            extra={"method": request.method, "path": request.url.path},
        )
        # Starlette's ServerErrorMiddleware sends this response from ABOVE
        # RequestContextMiddleware, so the middleware's send_wrapper never adds the
        # correlation header on the 500 path — stamp it here so a failed request is
        # still traceable to its logs (request_id_var is set on this task's context).
        return JSONResponse(
            status_code=500,
            content={"detail": "internal server error"},
            headers={"X-Request-ID": request_id_var.get()},
        )

    log_startup(settings)
    return app


app = create_app()
