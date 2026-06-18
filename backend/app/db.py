import ssl
from collections.abc import AsyncGenerator

from sqlalchemy.ext.asyncio import (
    AsyncEngine,
    AsyncSession,
    async_sessionmaker,
    create_async_engine,
)

from app.config import Settings, get_settings

_engine: AsyncEngine | None = None
_sessionmaker: async_sessionmaker[AsyncSession] | None = None


def engine_connect_args(settings: Settings) -> dict[str, object]:
    """asyncpg TLS args. asyncpg's key is `ssl` (a SSLContext) — NOT pg8000's
    `ssl_context`, and NOT a libpq `?sslmode=` URL arg (asyncpg rejects those).
    No cert configured -> {} (plaintext, for local dev)."""
    if not settings.db_ssl_root_cert:
        return {}
    # create_default_context() sets check_hostname=True + CERT_REQUIRED == verify-full.
    ctx = ssl.create_default_context(cafile=settings.db_ssl_root_cert)
    return {"ssl": ctx}


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
