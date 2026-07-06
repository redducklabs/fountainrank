"""Real data-migration test for 0021_content_reports (#11).

The shared test DB is externally pinned at head, and the async Alembic env can't be stepped
in-process (``env.py`` calls ``asyncio.run``, which can't run inside pytest-asyncio's loop), so
this drives Alembic via **subprocess** against an **isolated temporary database**. A fresh temp
DB keeps the shared test DB untouched and lets us seed ``photo_reports`` (which no longer exists
at head). Asserts the upgrade migrates existing photo reports intact (ids, category, status,
resolution, the JOINed fountain_id) and drops ``photo_reports``, and that the downgrade recreates
``photo_reports`` (0019 shape) and round-trips the photo rows.
"""

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
    u = make_url(get_settings().database_url)  # postgresql+asyncpg://…/fountainrank
    tmp = f"cr_migtest_{uuid.uuid4().hex[:12]}"
    admin_dsn = f"postgresql://{u.username}:{u.password}@{u.host}:{u.port}/postgres"
    tmp_pg = f"postgresql://{u.username}:{u.password}@{u.host}:{u.port}/{tmp}"  # asyncpg.connect
    # render_as_string(hide_password=False): SQLAlchemy's URL.__str__ masks the password as
    # "***", which would make the subprocess Alembic env fail auth against the temp DB.
    tmp_alembic = u.set(database=tmp).render_as_string(hide_password=False)  # env DATABASE_URL
    return tmp, admin_dsn, tmp_pg, tmp_alembic


def _run_alembic(rev: str, database_url: str) -> None:
    subprocess.run(
        ["uv", "run", "alembic", "upgrade", rev]
        if not rev.startswith("down:")
        else ["uv", "run", "alembic", "downgrade", rev[len("down:") :]],
        check=True,
        cwd=BACKEND,
        env={**os.environ, "DATABASE_URL": database_url},
    )


@pytest.mark.asyncio
async def test_photo_reports_data_migration_roundtrip():
    tmp, admin_dsn, tmp_pg, tmp_alembic = _urls()
    admin = await asyncpg.connect(dsn=admin_dsn)
    await admin.execute(f'CREATE DATABASE "{tmp}"')
    try:
        # 1) up to just-before this migration
        _run_alembic("0020_condition_award_window", tmp_alembic)

        # 2) seed user + fountain + photo + a PENDING and a RESOLVED photo_reports row (raw)
        c = await asyncpg.connect(dsn=tmp_pg)
        uid, fid, pid = uuid.uuid4(), uuid.uuid4(), uuid.uuid4()
        rep_pending, rep_resolved = uuid.uuid4(), uuid.uuid4()
        await c.execute(
            "INSERT INTO users (id, logto_user_id, display_name, email) VALUES ($1,$2,$3,$4)",
            uid,
            "m",
            "M",
            "m@e.com",
        )
        await c.execute(
            "INSERT INTO fountains (id, location, added_by_user_id, created_source) "
            "VALUES ($1, ST_SetSRID(ST_MakePoint(0,0),4326)::geography, $2, 'user')",
            fid,
            uid,
        )
        await c.execute(
            "INSERT INTO fountain_photos (id, fountain_id, user_id, storage_key, thumbnail_key, "
            "content_type, width, height, byte_size) VALUES "
            "($1,$2,$3,'k','t','image/jpeg',10,10,10)",
            pid,
            fid,
            uid,
        )
        await c.execute(
            "INSERT INTO photo_reports (id, photo_id, reporter_user_id, category, note, status) "
            "VALUES ($1,$2,$3,'spam','hi','pending')",
            rep_pending,
            pid,
            uid,
        )
        await c.execute(
            "INSERT INTO photo_reports (id, photo_id, reporter_user_id, category, status, "
            "resolution, resolved_by_user_id, resolved_at) VALUES "
            "($1,$2,$3,'other','resolved','hidden',$3, now())",
            rep_resolved,
            pid,
            uid,
        )
        await c.close()

        # 3) apply the migration under test
        _run_alembic("0021_content_reports", tmp_alembic)
        c = await asyncpg.connect(dsn=tmp_pg)
        rows = {r["id"]: r for r in await c.fetch("SELECT * FROM content_reports")}
        assert set(rows) == {rep_pending, rep_resolved}
        assert rows[rep_pending]["content_type"] == "photo"
        assert rows[rep_pending]["content_id"] == pid
        assert rows[rep_pending]["fountain_id"] == fid  # <- the JOIN got fountain_id right
        assert rows[rep_pending]["category"] == "spam" and rows[rep_pending]["note"] == "hi"
        assert rows[rep_resolved]["status"] == "resolved"
        assert rows[rep_resolved]["resolution"] == "hidden"
        assert not await c.fetch(
            "SELECT 1 FROM information_schema.tables WHERE table_name='photo_reports'"
        )
        await c.close()

        # 4) downgrade recreates photo_reports (0019 shape) + copies photo rows back
        _run_alembic("down:0020_condition_award_window", tmp_alembic)
        c = await asyncpg.connect(dsn=tmp_pg)
        back = {r["id"] for r in await c.fetch("SELECT id FROM photo_reports")}
        assert back == {rep_pending, rep_resolved}
        idx = {
            r["indexname"]
            for r in await c.fetch(
                "SELECT indexname FROM pg_indexes WHERE tablename='photo_reports'"
            )
        }
        assert (
            "uq_photo_reports_photo_reporter_pending" in idx
            and "ix_photo_reports_reporter_pending_created" in idx
        )
        checks = {
            r["conname"]
            for r in await c.fetch(
                "SELECT conname FROM pg_constraint "
                "WHERE conrelid='photo_reports'::regclass AND contype='c'"
            )
        }
        # NAMING_CONVENTION renders short CHECK names to ck_<table>_<name> (the stars_range
        # trap), so the DB connames are the rendered forms, NOT 'category'/'status'/'resolution'.
        assert {
            "ck_photo_reports_category",
            "ck_photo_reports_status",
            "ck_photo_reports_resolution",
        } <= checks
        assert not await c.fetch(
            "SELECT 1 FROM information_schema.tables WHERE table_name='content_reports'"
        )
        await c.close()
    finally:
        await admin.execute(f'DROP DATABASE IF EXISTS "{tmp}" WITH (FORCE)')
        await admin.close()
