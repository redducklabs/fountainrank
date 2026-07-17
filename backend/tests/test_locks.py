import logging

import pytest
from sqlalchemy import func, select, text
from sqlalchemy.exc import DBAPIError
from sqlalchemy.ext.asyncio import async_sessionmaker

from app.config import Settings
from app.locks import (
    ADD_FOUNTAIN_LOCK_KEY,
    PG_LOCK_NOT_AVAILABLE,
    InteractiveWriteBusy,
    acquire_add_fountain_lock,
    interactive_lock_timeout,
)
from app.logging_config import RequestIdFilter, request_id_var
from app.models import Fountain


def test_add_fountain_lock_key_is_fntr():
    assert ADD_FOUNTAIN_LOCK_KEY == 0x464E5452


def test_router_uses_shared_lock_key():
    import app.routers.fountains as f

    assert f.ADD_FOUNTAIN_LOCK_KEY is ADD_FOUNTAIN_LOCK_KEY


def test_pg_lock_not_available_is_55p03():
    # SQLSTATE lock_not_available — the code Postgres raises on a `lock_timeout` expiry.
    assert PG_LOCK_NOT_AVAILABLE == "55P03"


async def test_acquire_add_fountain_lock_logs_wait_and_acquired(session, caplog):
    with caplog.at_level(logging.INFO, logger="app.locks"):
        await acquire_add_fountain_lock(session, context="unit-test")
    msgs = [r.message for r in caplog.records if r.name == "app.locks"]
    assert "advisory_lock_wait" in msgs
    assert "advisory_lock_acquired" in msgs


# --- interactive_lock_timeout (spec 2026-07-17 §1) ------------------------------------


async def test_interactive_lock_timeout_applies_and_is_transaction_local(session):
    """set_config applies the bound inside the transaction and it clears on rollback (no reset)."""
    settings = Settings(add_lock_timeout_ms=1234)
    async with interactive_lock_timeout(session, settings, context="unit"):
        cur = (await session.execute(text("SELECT current_setting('lock_timeout')"))).scalar_one()
        assert cur == "1234ms"
    # Still set within the same open transaction (there is deliberately no reset).
    cur_open = (await session.execute(text("SELECT current_setting('lock_timeout')"))).scalar_one()
    assert cur_open == "1234ms"
    await session.rollback()
    cur_after = (await session.execute(text("SELECT current_setting('lock_timeout')"))).scalar_one()
    assert cur_after == "0"  # transaction-local: cleared on rollback


async def test_lock_timeout_expiry_surfaces_dbapi_error_with_55p03(engine):
    """Pin the EXACT wrapper/sqlstate shape of a lock_timeout expiry under the installed
    asyncpg/SQLAlchemy: a base DBAPIError whose `orig.sqlstate` is 55P03 (asserted, not assumed)."""
    maker = async_sessionmaker(engine, expire_on_commit=False)
    holder = maker()
    await holder.execute(select(func.pg_advisory_xact_lock(ADD_FOUNTAIN_LOCK_KEY)))
    try:
        async with maker() as s:
            await s.execute(text("SELECT set_config('lock_timeout', '300ms', true)"))
            with pytest.raises(DBAPIError) as ei:
                await s.execute(select(func.pg_advisory_xact_lock(ADD_FOUNTAIN_LOCK_KEY)))
            assert getattr(ei.value.orig, "sqlstate", None) == PG_LOCK_NOT_AVAILABLE
    finally:
        await holder.rollback()
        await holder.close()


async def test_interactive_lock_timeout_maps_55p03_to_busy_and_rolls_back(engine, caplog):
    """A lock-wait expiry inside the context: the helper rolls the session back (usable after; no
    write persists), logs ONE WARNING with context/elapsed_ms and no driver internals, and raises
    InteractiveWriteBusy."""
    maker = async_sessionmaker(engine, expire_on_commit=False)
    holder = maker()
    await holder.execute(select(func.pg_advisory_xact_lock(ADD_FOUNTAIN_LOCK_KEY)))
    settings = Settings(add_lock_timeout_ms=300)
    try:
        async with maker() as s:
            with caplog.at_level(logging.WARNING, logger="app.locks"):
                with pytest.raises(InteractiveWriteBusy):
                    async with interactive_lock_timeout(s, settings, context="add_fountain"):
                        # A write that must be discarded when the lock wait aborts the txn.
                        await s.execute(
                            text(
                                "INSERT INTO fountains (id, location, is_hidden, created_source) "
                                "VALUES (gen_random_uuid(), "
                                "ST_SetSRID(ST_MakePoint(0,0),4326)::geography, false, "
                                "'admin_import')"
                            )
                        )
                        # Blocks on the held advisory lock → 55P03 at the 300ms bound.
                        await s.execute(select(func.pg_advisory_xact_lock(ADD_FOUNTAIN_LOCK_KEY)))
            # Session was rolled back and is usable again.
            assert (await s.execute(text("SELECT 1"))).scalar_one() == 1
            # No fountain persisted (the write was rolled back with the aborted transaction).
            assert (await s.execute(select(func.count()).select_from(Fountain))).scalar_one() == 0
    finally:
        await holder.rollback()
        await holder.close()

    warnings = [r for r in caplog.records if r.getMessage() == "interactive_write_lock_timeout"]
    assert len(warnings) == 1
    rec = warnings[0]
    assert rec.levelno == logging.WARNING
    assert rec.context == "add_fountain"
    assert isinstance(rec.elapsed_ms, int) and rec.elapsed_ms >= 0
    # No driver internals: no SQLSTATE, no SQL text, no driver name, no lock-holder identity.
    assert not hasattr(rec, "sqlstate")
    leaked = " ".join(str(v) for v in rec.__dict__.values())
    assert "55P03" not in leaked
    assert "asyncpg" not in leaked.lower()
    assert "advisory" not in leaked.lower()
    assert "set_config" not in leaked.lower()


async def test_interactive_lock_timeout_warning_carries_correlation_id(engine, caplog):
    """The WARNING carries the request's correlation id (RequestIdFilter stamps it)."""
    maker = async_sessionmaker(engine, expire_on_commit=False)
    holder = maker()
    await holder.execute(select(func.pg_advisory_xact_lock(ADD_FOUNTAIN_LOCK_KEY)))
    settings = Settings(add_lock_timeout_ms=300)
    token = request_id_var.set("rid-lock-test")
    caplog.handler.addFilter(RequestIdFilter())
    try:
        async with maker() as s:
            with caplog.at_level(logging.WARNING, logger="app.locks"):
                with pytest.raises(InteractiveWriteBusy):
                    async with interactive_lock_timeout(s, settings, context="add_fountain"):
                        await s.execute(select(func.pg_advisory_xact_lock(ADD_FOUNTAIN_LOCK_KEY)))
    finally:
        caplog.handler.removeFilter(caplog.handler.filters[-1])
        request_id_var.reset(token)
        await holder.rollback()
        await holder.close()
    rec = next(r for r in caplog.records if r.getMessage() == "interactive_write_lock_timeout")
    assert rec.request_id == "rid-lock-test"


async def test_interactive_lock_timeout_propagates_non_55p03(session):
    """A non-lock-timeout database error propagates untouched — no rollback-and-remap of real
    failures to a spurious 503."""
    settings = Settings(add_lock_timeout_ms=8000)
    with pytest.raises(DBAPIError) as ei:
        async with interactive_lock_timeout(session, settings, context="add_fountain"):
            await session.execute(text("SELECT * FROM this_table_does_not_exist_xyz"))
    assert not isinstance(ei.value, InteractiveWriteBusy)
    assert getattr(ei.value.orig, "sqlstate", None) != PG_LOCK_NOT_AVAILABLE
