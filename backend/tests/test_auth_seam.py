import asyncio

import pytest
from httpx import ASGITransport, AsyncClient
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import async_sessionmaker

from app.auth import get_or_create_user
from app.config import Settings, get_settings
from app.main import app
from app.models import User


async def test_get_or_create_user_is_idempotent(session):
    first = await get_or_create_user(
        session, logto_user_id="logto-abc", email="a@example.com", display_name="A"
    )
    await session.commit()
    again = await get_or_create_user(
        session, logto_user_id="logto-abc", email="ignored@example.com", display_name="ignored"
    )
    assert again.id == first.id  # reused, not duplicated


async def test_get_or_create_user_is_concurrency_safe(engine):
    # Two concurrent first requests for the same subject must converge on one row
    # without a 500 (the old SELECT-then-INSERT would lose one on the unique index).
    maker = async_sessionmaker(engine, expire_on_commit=False)

    async def provision() -> object:
        async with maker() as s:
            user = await get_or_create_user(
                s, logto_user_id="logto-race", email="r@example.com", display_name="R"
            )
            await s.commit()
            return user.id

    id_a, id_b = await asyncio.gather(provision(), provision())
    assert id_a == id_b  # same user; neither request errored

    async with maker() as s:
        count = (
            await s.execute(
                select(func.count()).select_from(User).where(User.logto_user_id == "logto-race")
            )
        ).scalar_one()
    assert count == 1  # exactly one row, no duplicate


@pytest.fixture
def settings_override():
    def _apply(**kwargs):
        app.dependency_overrides[get_settings] = lambda: Settings(**kwargs)

    yield _apply
    app.dependency_overrides.pop(get_settings, None)


async def test_write_rejected_when_dev_auth_disabled(settings_override):
    settings_override(dev_auth_enabled=False)
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        resp = await ac.post(
            "/api/v1/fountains",
            json={"location": {"latitude": 1.0, "longitude": 2.0}, "is_working": True},
            headers={"X-Dev-User": "logto-abc"},
        )
    assert resp.status_code == 401


async def test_write_rejected_when_header_missing(settings_override):
    settings_override(dev_auth_enabled=True)
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        resp = await ac.post(
            "/api/v1/fountains",
            json={"location": {"latitude": 1.0, "longitude": 2.0}, "is_working": True},
        )
    assert resp.status_code == 401
