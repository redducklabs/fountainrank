"""Migration 0024 round-trip and exact write_attempts metadata assertions."""

import os
import subprocess
import uuid
from pathlib import Path

import asyncpg
import pytest
from sqlalchemy.engine import make_url

from app.config import get_settings

BACKEND = Path(__file__).resolve().parents[1]


def _urls() -> tuple[str, str, str, str]:
    url = make_url(get_settings().database_url)
    database = f"write_attempts_migtest_{uuid.uuid4().hex[:12]}"
    admin_dsn = f"postgresql://{url.username}:{url.password}@{url.host}:{url.port}/postgres"
    database_dsn = f"postgresql://{url.username}:{url.password}@{url.host}:{url.port}/{database}"
    alembic_url = url.set(database=database).render_as_string(hide_password=False)
    return database, admin_dsn, database_dsn, alembic_url


def _run_alembic(arguments: list[str], database_url: str) -> None:
    subprocess.run(
        ["uv", "run", "alembic", *arguments],
        check=True,
        cwd=BACKEND,
        env={**os.environ, "DATABASE_URL": database_url},
    )


async def _assert_metadata(connection: asyncpg.Connection) -> None:
    constraints = {
        row["conname"]: row["definition"]
        for row in await connection.fetch(
            "SELECT conname, pg_get_constraintdef(oid) AS definition "
            "FROM pg_constraint WHERE conrelid='write_attempts'::regclass"
        )
    }
    assert "fk_write_attempts_user" in constraints
    assert "ON DELETE CASCADE" in constraints["fk_write_attempts_user"]
    assert constraints["ck_write_attempts_rate_budget"] == (
        "CHECK (((budget)::text = ANY "
        "((ARRAY['contribution_write'::character varying, "
        "'profile_sync'::character varying])::text[])))"
    )
    endpoint_check = constraints["ck_write_attempts_rate_endpoint"]
    for endpoint in (
        "fountain_create",
        "rating_submit",
        "attribute_submit",
        "condition_submit",
        "note_submit",
        "profile_sync",
    ):
        assert endpoint in endpoint_check

    indexes = {
        row["indexname"]: row["indexdef"]
        for row in await connection.fetch(
            "SELECT indexname, indexdef FROM pg_indexes WHERE tablename='write_attempts'"
        )
    }
    assert "ix_write_attempts_user_budget_created" in indexes
    assert "(user_id, budget, created_at)" in indexes["ix_write_attempts_user_budget_created"]
    assert "ix_write_attempts_created_at" in indexes
    assert "(created_at)" in indexes["ix_write_attempts_created_at"]


@pytest.mark.asyncio
async def test_write_attempts_migration_upgrade_downgrade_upgrade() -> None:
    database, admin_dsn, database_dsn, alembic_url = _urls()
    admin = await asyncpg.connect(dsn=admin_dsn)
    await admin.execute(f'CREATE DATABASE "{database}"')
    try:
        _run_alembic(["upgrade", "0023_ratings_is_proximate"], alembic_url)
        _run_alembic(["upgrade", "0024_write_attempts"], alembic_url)
        connection = await asyncpg.connect(dsn=database_dsn)
        await _assert_metadata(connection)
        await connection.close()

        _run_alembic(["downgrade", "0023_ratings_is_proximate"], alembic_url)
        connection = await asyncpg.connect(dsn=database_dsn)
        exists = await connection.fetchval(
            "SELECT to_regclass('public.write_attempts') IS NOT NULL"
        )
        await connection.close()
        assert exists is False

        _run_alembic(["upgrade", "0024_write_attempts"], alembic_url)
        connection = await asyncpg.connect(dsn=database_dsn)
        await _assert_metadata(connection)
        await connection.close()
    finally:
        await admin.execute(f'DROP DATABASE IF EXISTS "{database}" WITH (FORCE)')
        await admin.close()
