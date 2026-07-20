"""Schema and guarded downgrade test for 0030_account_sanctions (#13)."""

import os
import subprocess
import uuid
from pathlib import Path

import asyncpg
import pytest
from sqlalchemy.engine import make_url

from app.config import get_settings

BACKEND = Path(__file__).resolve().parents[1]


def _run_alembic(command: str, revision: str, database_url: str, *, succeeds: bool = True):
    return subprocess.run(
        ["uv", "run", "alembic", command, revision],
        check=succeeds,
        capture_output=not succeeds,
        text=True,
        cwd=BACKEND,
        env={**os.environ, "DATABASE_URL": database_url},
    )


@pytest.mark.asyncio
async def test_account_sanctions_schema_and_guarded_downgrade():
    url = make_url(get_settings().database_url)
    database = f"as_migtest_{uuid.uuid4().hex[:12]}"
    admin_dsn = f"postgresql://{url.username}:{url.password}@{url.host}:{url.port}/postgres"
    database_dsn = f"postgresql://{url.username}:{url.password}@{url.host}:{url.port}/{database}"
    alembic_url = url.set(database=database).render_as_string(hide_password=False)
    admin = await asyncpg.connect(dsn=admin_dsn)
    await admin.execute(f'CREATE DATABASE "{database}"')
    try:
        _run_alembic("upgrade", "0030_account_sanctions", alembic_url)
        connection = await asyncpg.connect(dsn=database_dsn)
        columns = {
            row["column_name"]: row["is_nullable"]
            for row in await connection.fetch(
                "SELECT column_name, is_nullable FROM information_schema.columns "
                "WHERE table_name='users' AND column_name LIKE '%sanction%' "
                "OR table_name='users' AND column_name='account_status'"
            )
        }
        assert columns == {
            "account_status": "NO",
            "sanction_reason": "YES",
            "sanctioned_at": "YES",
            "sanctioned_by_user_id": "YES",
        }
        await connection.execute(
            "INSERT INTO users (id, logto_user_id, display_name, email) VALUES ($1,$2,$3,$4)",
            uuid.uuid4(),
            "migration-admin",
            "Admin",
            "admin@example.com",
        )
        target_id = uuid.uuid4()
        await connection.execute(
            "INSERT INTO moderation_actions "
            "(id, actor_kind, action, content_type, content_id) "
            "VALUES ($1,'system','expire','user',$2)",
            uuid.uuid4(),
            target_id,
        )
        await connection.close()

        result = _run_alembic("downgrade", "0029_moderation_actions", alembic_url, succeeds=False)
        assert result.returncode != 0
        assert "refusing to discard account-sanction audit history" in result.stderr
    finally:
        await admin.execute(f'DROP DATABASE IF EXISTS "{database}" WITH (FORCE)')
        await admin.close()
