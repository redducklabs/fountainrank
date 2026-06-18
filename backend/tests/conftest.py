import pytest
from httpx import ASGITransport, AsyncClient
from sqlalchemy import text as _sa_text
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

import app.db as _app_db
from app.config import get_settings
from app.main import app


@pytest.fixture
async def client():
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        yield ac


@pytest.fixture
async def engine():
    eng = create_async_engine(get_settings().database_url)
    yield eng
    await eng.dispose()


@pytest.fixture
async def session(engine):
    maker = async_sessionmaker(engine, expire_on_commit=False)
    async with maker() as s:
        yield s


@pytest.fixture(autouse=True)
async def clean_db(engine):
    # Isolation: wipe mutable domain tables before each test. rating_types is
    # migration-seeded reference data and is intentionally preserved.
    async with engine.begin() as conn:
        await conn.execute(_sa_text("TRUNCATE ratings, fountains, users RESTART IDENTITY CASCADE"))
    yield


@pytest.fixture(autouse=True)
async def reset_app_engine():
    """Dispose and reset the app-global engine singleton after each test.
    Each test runs in its own event loop (pytest-asyncio default); without
    this the shared engine retains connections bound to the previous loop,
    causing RuntimeError('Event loop is closed') on the next test."""
    yield
    if _app_db._engine is not None:
        await _app_db._engine.dispose()
        _app_db._engine = None
        _app_db._sessionmaker = None
