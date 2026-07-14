"""Migration 0025 hierarchy metadata and fail-closed cell preflight."""

from __future__ import annotations

import os
import subprocess
import uuid
from pathlib import Path

import asyncpg
import pytest
from sqlalchemy import text
from sqlalchemy.engine import make_url

from app.config import get_settings

BACKEND = Path(__file__).resolve().parents[1]


def _urls() -> tuple[str, str, str, str]:
    url = make_url(get_settings().database_url)
    database = f"place_hierarchy_migtest_{uuid.uuid4().hex[:12]}"
    admin_dsn = f"postgresql://{url.username}:{url.password}@{url.host}:{url.port}/postgres"
    database_dsn = f"postgresql://{url.username}:{url.password}@{url.host}:{url.port}/{database}"
    alembic_url = url.set(database=database).render_as_string(hide_password=False)
    return database, admin_dsn, database_dsn, alembic_url


def _run_alembic(arguments: list[str], database_url: str, *, check: bool = True):
    return subprocess.run(
        ["uv", "run", "alembic", *arguments],
        check=check,
        cwd=BACKEND,
        env={**os.environ, "DATABASE_URL": database_url},
        capture_output=True,
        text=True,
    )


@pytest.mark.asyncio
async def test_place_hierarchy_migration_fails_when_boundaries_have_no_cells() -> None:
    database, admin_dsn, database_dsn, alembic_url = _urls()
    admin = await asyncpg.connect(dsn=admin_dsn)
    await admin.execute(f'CREATE DATABASE "{database}"')
    try:
        _run_alembic(["upgrade", "0024_write_attempts"], alembic_url)
        connection = await asyncpg.connect(dsn=database_dsn)
        await connection.execute(
            """
            INSERT INTO place_boundaries
                (id, overture_id, subtype, class, name, country_code, slug,
                 is_canonical, fountain_count, boundary, created_at, updated_at)
            VALUES (gen_random_uuid(), 'missing-cells', 'country', 'land', 'Missing Cells',
                    'xx', 'missing-cells', false, 0,
                    ST_Multi(ST_GeomFromText('POLYGON((0 0,1 0,1 1,0 1,0 0))', 4326))
                        ::geography,
                    now(), now())
            """
        )
        await connection.close()

        result = _run_alembic(["upgrade", "0025_place_hierarchy"], alembic_url, check=False)

        assert result.returncode != 0
        assert "place_boundaries exist without place_boundary_cells" in (
            result.stderr + result.stdout
        )
    finally:
        await admin.execute(f'DROP DATABASE IF EXISTS "{database}" WITH (FORCE)')
        await admin.close()


@pytest.mark.asyncio
async def test_place_hierarchy_indexes_and_check_names(session) -> None:
    indexes = {
        row.indexname: row.indexdef
        for row in (
            await session.execute(
                text(
                    "SELECT indexname, indexdef FROM pg_indexes WHERE tablename='place_boundaries'"
                )
            )
        ).all()
    }
    assert "uq_place_boundaries_region_canonical" in indexes
    assert "uq_place_boundaries_city_canonical" in indexes

    constraints = set(
        (
            await session.execute(
                text(
                    "SELECT conname FROM pg_constraint "
                    "WHERE conrelid='place_scope_config'::regclass"
                )
            )
        )
        .scalars()
        .all()
    )
    assert "ck_place_scope_config_tiers_disjoint" in constraints
