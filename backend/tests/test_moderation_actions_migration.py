"""Schema round-trip test for 0029_moderation_actions (#216)."""

import os
import subprocess
import uuid
from pathlib import Path

import asyncpg
import pytest
from sqlalchemy.engine import make_url

from app.config import get_settings

BACKEND = Path(__file__).resolve().parents[1]


def _urls():
    url = make_url(get_settings().database_url)
    database = f"ma_migtest_{uuid.uuid4().hex[:12]}"
    admin_dsn = f"postgresql://{url.username}:{url.password}@{url.host}:{url.port}/postgres"
    database_dsn = f"postgresql://{url.username}:{url.password}@{url.host}:{url.port}/{database}"
    alembic_url = url.set(database=database).render_as_string(hide_password=False)
    return database, admin_dsn, database_dsn, alembic_url


def _run_alembic(command: str, revision: str, database_url: str) -> None:
    subprocess.run(
        ["uv", "run", "alembic", command, revision],
        check=True,
        cwd=BACKEND,
        env={**os.environ, "DATABASE_URL": database_url},
    )


@pytest.mark.asyncio
async def test_moderation_actions_schema_upgrade_and_downgrade():
    database, admin_dsn, database_dsn, alembic_url = _urls()
    admin = await asyncpg.connect(dsn=admin_dsn)
    await admin.execute(f'CREATE DATABASE "{database}"')
    try:
        _run_alembic("upgrade", "0028_boundary_area", alembic_url)
        _run_alembic("upgrade", "0029_moderation_actions", alembic_url)

        connection = await asyncpg.connect(dsn=database_dsn)
        columns = {
            row["column_name"]: row["is_nullable"]
            for row in await connection.fetch(
                "SELECT column_name, is_nullable FROM information_schema.columns "
                "WHERE table_name='moderation_actions'"
            )
        }
        assert columns == {
            "id": "NO",
            "admin_user_id": "YES",
            "admin_actor_id": "NO",
            "action": "NO",
            "content_type": "NO",
            "content_id": "NO",
            "fountain_id": "YES",
            "reason": "YES",
            "details": "YES",
            "created_at": "NO",
        }
        constraints = {
            row["conname"]
            for row in await connection.fetch(
                "SELECT conname FROM pg_constraint WHERE conrelid='moderation_actions'::regclass"
            )
        }
        assert {
            "pk_moderation_actions",
            "fk_moderation_actions_admin",
            "fk_moderation_actions_fountain",
            "ck_moderation_actions_action",
            "ck_moderation_actions_content_type",
        } <= constraints
        indexes = {
            row["indexname"]
            for row in await connection.fetch(
                "SELECT indexname FROM pg_indexes WHERE tablename='moderation_actions'"
            )
        }
        assert {
            "ix_moderation_actions_target",
            "ix_moderation_actions_admin_created",
            "ix_moderation_actions_fountain_created",
        } <= indexes
        await connection.close()

        _run_alembic("downgrade", "0028_boundary_area", alembic_url)
        connection = await asyncpg.connect(dsn=database_dsn)
        exists = await connection.fetchval(
            "SELECT to_regclass('public.moderation_actions') IS NOT NULL"
        )
        assert exists is False
        await connection.close()
    finally:
        await admin.execute(f'DROP DATABASE IF EXISTS "{database}" WITH (FORCE)')
        await admin.close()
