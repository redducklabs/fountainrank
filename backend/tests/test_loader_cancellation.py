"""Cancellation mechanics on a real server + real sockets (spec 2026-07-17, Verification 4).

Proves the fail-closed layers actually work on the installed PostgreSQL/asyncpg:

- a BUSY statement whose client dies without a protocol goodbye is aborted by
  ``client_connection_check_interval`` and releases its advisory lock to a queued waiter;
- the lock-wait coverage probe pins whether the connection check also culls a session that is
  WAITING on an advisory lock (the spec's bounds table row for waiters is written from this);
- a loader-configured ``lock_timeout`` fails the staged refresh fast (SQLSTATE 55P03) when the
  advisory lock is wedged, instead of waiting out the Job deadline.
"""

from __future__ import annotations

import asyncio
import time

import asyncpg
import pytest
from sqlalchemy import text
from sqlalchemy.exc import DBAPIError
from sqlalchemy.ext.asyncio import create_async_engine

from app.config import Settings, get_settings
from app.db import engine_connect_args
from app.locks import ADD_FOUNTAIN_LOCK_KEY, PG_LOCK_NOT_AVAILABLE

# A test-only advisory key: the mechanics are identical to ADD_FOUNTAIN_LOCK's, without
# interfering with concurrently running membership tests.
_TEST_LOCK_KEY = 987_654_321

_CULL_BOUND_S = 15.0  # generous CI bound; the configured check interval is 1 s

# An aborted transport surfaces as a connection error from the statement, or as asyncpg's
# InterfaceError when the transaction context's __aexit__ observes the closed connection first.
_DEAD_CLIENT_ERRORS = (
    asyncpg.PostgresConnectionError,
    asyncpg.exceptions.InterfaceError,
    ConnectionError,
    OSError,
)


def _asyncpg_url() -> str:
    return get_settings().database_url.replace("postgresql+asyncpg://", "postgresql://")


async def _connect_checked(marker: str) -> asyncpg.Connection:
    return await asyncpg.connect(
        _asyncpg_url(),
        server_settings={
            "application_name": marker,
            "client_connection_check_interval": "1000",
        },
    )


async def _backend_alive(probe: asyncpg.Connection, marker: str) -> bool:
    # Fresh snapshot each poll — pg_stat_activity is cached per transaction otherwise.
    await probe.execute("SELECT pg_stat_clear_snapshot()")
    return await probe.fetchval(
        "SELECT count(*) > 0 FROM pg_stat_activity "
        "WHERE datname = current_database() AND application_name = $1",
        marker,
    )


async def _wait_gone(probe: asyncpg.Connection, marker: str, bound_s: float) -> float | None:
    """Poll until the marked backend is gone; return elapsed seconds, or None if it survived."""
    started = time.monotonic()
    while time.monotonic() - started < bound_s:
        if not await _backend_alive(probe, marker):
            return time.monotonic() - started
        await asyncio.sleep(0.25)
    return None


async def test_busy_statement_aborts_on_dead_client_and_releases_lock():
    marker = "loader:boundary-load:314159"
    probe = await asyncpg.connect(_asyncpg_url())
    holder = await _connect_checked(marker)
    waiter = await asyncpg.connect(_asyncpg_url())
    try:

        async def hold_and_sleep():
            async with holder.transaction():
                await holder.fetchval("SELECT pg_advisory_xact_lock($1::int)", _TEST_LOCK_KEY)
                await holder.fetchval("SELECT pg_sleep(120)")

        busy_task = asyncio.create_task(hold_and_sleep())
        # Wait until the lock is actually held server-side.
        for _ in range(80):
            held = await probe.fetchval(
                "SELECT count(*) > 0 FROM pg_locks "
                "WHERE locktype = 'advisory' AND objid = $1 AND granted",
                _TEST_LOCK_KEY,
            )
            if held:
                break
            await asyncio.sleep(0.25)
        else:
            pytest.fail("advisory lock was never acquired")

        async def wait_for_lock():
            async with waiter.transaction():
                await waiter.fetchval("SELECT pg_advisory_xact_lock($1::int)", _TEST_LOCK_KEY)

        waiter_task = asyncio.create_task(wait_for_lock())
        await asyncio.sleep(1.0)  # let the waiter queue behind the holder

        # Kill the holder's socket with NO protocol goodbye — the incident's failure mode.
        holder._transport.abort()

        # The aborted client task must fail with a connection error, and be awaited (no
        # "Task exception was never retrieved" noise).
        with pytest.raises(_DEAD_CLIENT_ERRORS):
            await asyncio.wait_for(busy_task, timeout=_CULL_BOUND_S)

        # The server-side session dies within the check-interval bound...
        elapsed = await _wait_gone(probe, marker, _CULL_BOUND_S)
        assert elapsed is not None, "busy backend survived a dead client past the bound"
        # ...and the advisory lock is released to the queued waiter.
        await asyncio.wait_for(waiter_task, timeout=_CULL_BOUND_S)
    finally:
        for conn in (holder, waiter, probe):
            try:
                await conn.close(timeout=5)
            except Exception:
                pass


async def test_lock_wait_coverage_probe_waiter_is_culled():
    """Pins the empirical bounds-table row: on this PostgreSQL 17, the connection check DOES
    fire while a session waits on ``pg_advisory_xact_lock`` — a dead waiter is culled within
    the check interval, not only at ``lock_timeout``. (If this ever fails on an upgrade, the
    spec's waiter bound falls back to lock_timeout and this pin must be re-derived.)"""
    marker = "loader:boundary-load:271828"
    probe = await asyncpg.connect(_asyncpg_url())
    holder = await asyncpg.connect(_asyncpg_url())
    waiting = await _connect_checked(marker)
    try:
        # The holder keeps the lock for the whole test.
        holder_tx = holder.transaction()
        await holder_tx.start()
        await holder.fetchval("SELECT pg_advisory_xact_lock($1::int)", _TEST_LOCK_KEY)

        async def wait_forever():
            async with waiting.transaction():
                await waiting.fetchval("SELECT pg_advisory_xact_lock($1::int)", _TEST_LOCK_KEY)

        wait_task = asyncio.create_task(wait_forever())
        # Confirm the waiter is queued (advisory wait_event visible).
        for _ in range(80):
            await probe.execute("SELECT pg_stat_clear_snapshot()")
            queued = await probe.fetchval(
                "SELECT count(*) > 0 FROM pg_stat_activity "
                "WHERE application_name = $1 AND wait_event = 'advisory'",
                marker,
            )
            if queued:
                break
            await asyncio.sleep(0.25)
        else:
            pytest.fail("waiter never queued on the advisory lock")

        waiting._transport.abort()
        with pytest.raises(_DEAD_CLIENT_ERRORS):
            await asyncio.wait_for(wait_task, timeout=_CULL_BOUND_S)

        elapsed = await _wait_gone(probe, marker, _CULL_BOUND_S)
        assert elapsed is not None, (
            "waiting backend survived a dead client past the check-interval bound — "
            "the spec's waiter row must fall back to lock_timeout"
        )
        await holder_tx.rollback()
    finally:
        for conn in (holder, waiting, probe):
            try:
                await conn.close(timeout=5)
            except Exception:
                pass


async def test_staged_refresh_fails_fast_on_wedged_advisory_lock():
    from app.membership import RefreshScope, run_staged_membership_refresh

    settings = Settings(database_url=get_settings().database_url, db_lock_timeout_ms=2_000)
    loader_engine = create_async_engine(
        settings.database_url, connect_args=engine_connect_args(settings)
    )
    holder_engine = create_async_engine(get_settings().database_url)
    try:
        async with holder_engine.connect() as holder:
            # Wedge ADD_FOUNTAIN_LOCK in an open transaction (the orphaned-holder shape).
            await holder.execute(
                text("SELECT pg_advisory_xact_lock(:k)"), {"k": ADD_FOUNTAIN_LOCK_KEY}
            )
            started = time.monotonic()
            with pytest.raises(DBAPIError) as exc_info:
                await run_staged_membership_refresh(loader_engine, RefreshScope(country_code="us"))
            elapsed = time.monotonic() - started
            assert getattr(exc_info.value.orig, "sqlstate", None) == PG_LOCK_NOT_AVAILABLE
            # Fast failure at ~the 2 s bound — nothing like an unbounded wait.
            assert elapsed < 30
            await holder.rollback()
    finally:
        await loader_engine.dispose()
        await holder_engine.dispose()
