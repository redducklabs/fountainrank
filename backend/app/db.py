import logging
import ssl
from collections.abc import AsyncGenerator

from sqlalchemy.ext.asyncio import (
    AsyncEngine,
    AsyncSession,
    async_sessionmaker,
    create_async_engine,
)

from app.config import Settings, get_settings

log = logging.getLogger(__name__)

_engine: AsyncEngine | None = None
_sessionmaker: async_sessionmaker[AsyncSession] | None = None


def engine_connect_args(settings: Settings) -> dict[str, object]:
    """asyncpg connect args: TLS + optional per-connection startup GUCs.

    TLS: asyncpg's key is `ssl` (a SSLContext) — NOT pg8000's `ssl_context`, and NOT a libpq
    `?sslmode=` URL arg (asyncpg rejects those). No cert configured -> plaintext (local dev).

    server_settings: the loader-session GUCs (spec 2026-07-17 §2a) — application_name (the
    run-scoped reaper marker), client_connection_check_interval and lock_timeout (both `user`
    context on PG 17, sent as startup-packet GUCs; bare integers parse as milliseconds). Unset
    settings add nothing, so the serving backend's args are unchanged.
    """
    args: dict[str, object] = {}
    if settings.db_ssl_root_cert:
        # create_default_context() sets check_hostname=True + CERT_REQUIRED == verify-full.
        args["ssl"] = ssl.create_default_context(cafile=settings.db_ssl_root_cert)
    server_settings: dict[str, str] = {}
    if settings.db_application_name is not None:
        server_settings["application_name"] = settings.db_application_name
    if settings.db_client_connection_check_interval_ms is not None:
        server_settings["client_connection_check_interval"] = str(
            settings.db_client_connection_check_interval_ms
        )
    if settings.db_lock_timeout_ms is not None:
        server_settings["lock_timeout"] = str(settings.db_lock_timeout_ms)
    if server_settings:
        args["server_settings"] = server_settings
    return args


def log_session_config(settings: Settings | None = None) -> None:
    """Log the armed loader-session config (spec 2026-07-17 §2a observability).

    Called by the loader CLI entrypoints right after logging is configured, BEFORE any database
    work, so the fail-closed cancellation state is diagnosable from logs alone. Emits nothing
    when no loader setting is configured (the serving backend / local dev). Never logs the DSN.
    """
    settings = settings if settings is not None else get_settings()
    if (
        settings.db_application_name is None
        and settings.db_client_connection_check_interval_ms is None
        and settings.db_lock_timeout_ms is None
    ):
        return
    log.info(
        "loader_session_config",
        extra={
            "application_name": settings.db_application_name,
            "client_connection_check_interval_ms": (
                settings.db_client_connection_check_interval_ms
            ),
            "lock_timeout_ms": settings.db_lock_timeout_ms,
        },
    )


def get_engine() -> AsyncEngine:
    global _engine, _sessionmaker
    if _engine is None:
        settings = get_settings()
        _engine = create_async_engine(
            settings.database_url,
            pool_pre_ping=True,
            connect_args=engine_connect_args(settings),
        )
        # expire_on_commit=False avoids the GeoAlchemy2/AsyncSession expired-
        # attribute reload gotcha once geometry columns exist (Phase 1).
        _sessionmaker = async_sessionmaker(_engine, expire_on_commit=False)
    return _engine


def get_sessionmaker() -> async_sessionmaker[AsyncSession]:
    if _sessionmaker is None:
        get_engine()
    assert _sessionmaker is not None
    return _sessionmaker


async def get_session() -> AsyncGenerator[AsyncSession]:
    async with get_sessionmaker()() as session:
        yield session
