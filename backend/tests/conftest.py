import pytest
from httpx import ASGITransport, AsyncClient
from sqlalchemy import text as _sa_text
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

import app.db as _app_db
from app.auth import get_current_user
from app.config import get_settings
from app.main import app
from app.models import User


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
    async with engine.begin() as conn:
        await conn.execute(
            _sa_text(
                "TRUNCATE fountain_import_events, osm_fountain_import_candidates, "
                "fountain_provenances, osm_fountain_import_runs, ratings, fountains, users "
                "RESTART IDENTITY CASCADE"
            )
        )
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


@pytest.fixture
async def test_user(clean_db, session) -> User:
    user = User(logto_user_id="dev-user-1", email="dev1@example.com", display_name="Dev One")
    session.add(user)
    await session.commit()
    await session.refresh(user)
    return user


@pytest.fixture
async def client(test_user) -> AsyncClient:
    # API tests run with the write-auth seam pinned to a known user. The seam's own
    # gating/provisioning is covered separately in tests/test_auth_seam.py.
    async def override_current_user() -> User:
        return test_user

    app.dependency_overrides[get_current_user] = override_current_user
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        yield ac
    app.dependency_overrides.pop(get_current_user, None)


@pytest.fixture(autouse=True)
def reset_jwks_cache():
    """Reset the app-global JWKS cache singleton after each test so a cache built from one
    test's settings can't leak into the next (order-independence)."""
    yield
    import app.auth as _app_auth

    _app_auth._jwks_cache = None


@pytest.fixture(autouse=True)
def reset_email_sender():
    """Reset the process-singleton Gmail sender after each test (order-independence)."""
    yield
    import app.routers.email_webhook as _ew

    _ew._sender = None
