"""Shared Postgres advisory-lock keys.

Promoted from routers/fountains.py so the add-fountain endpoint and the OSM
importer serialize their spatial check-then-write against the SAME key (a
transaction-level advisory lock; releases on commit/rollback). Two writers
keyed differently would each pass the proximity check before the other commits
and both insert a near-duplicate.
"""

from __future__ import annotations

import logging
import time
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

from sqlalchemy import func, select, text
from sqlalchemy.exc import DBAPIError
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import Settings

log = logging.getLogger(__name__)

# "FNTR" — the single global add/merge serialization key (low write volume).
ADD_FOUNTAIN_LOCK_KEY = 0x464E5452

# SQLSTATE lock_not_available: Postgres raises this when a statement waits past `lock_timeout` for
# ANY lock — advisory, row, or table. Verified empirically (spec 2026-07-17 §1) to surface, under
# the installed asyncpg/SQLAlchemy, as a SQLAlchemy DBAPIError whose `orig.sqlstate` carries it.
PG_LOCK_NOT_AVAILABLE = "55P03"

# Per-user advisory-lock namespaces for the fountain-photos feature (design §6). Used with
# the two-argument `pg_advisory_xact_lock(namespace, user_key)` form, where `user_key` is a
# deterministic per-user hash — distinct from each other and from `ADD_FOUNTAIN_LOCK_KEY` so
# these locks can never collide.
PHOTO_UPLOAD_LOCK_NS = 0x50554C44  # "PULD" — upload-reservation rate gate.
CONTENT_REPORT_LOCK_NS = 0x50525054  # "PRPT" — content report rate gate.
WRITE_RATE_LIMIT_LOCK_NS = 0x57524154  # "WRAT" — authenticated JSON write gate.


async def acquire_add_fountain_lock(session: AsyncSession, *, context: str) -> None:
    """Take the transaction-level ``ADD_FOUNTAIN_LOCK``, logging the wait and the acquisition
    (with ``waited_ms``) so a cross-workflow lock wait is diagnosable from logs alone
    (spec 2026-07-15 §C.1). ``pg_advisory_xact_lock`` blocks until granted and releases on
    commit/rollback — so a long ``waited_ms`` means another holder is running."""
    log.info("advisory_lock_wait", extra={"lock": "ADD_FOUNTAIN_LOCK", "context": context})
    started = time.monotonic()
    await session.execute(select(func.pg_advisory_xact_lock(ADD_FOUNTAIN_LOCK_KEY)))
    log.info(
        "advisory_lock_acquired",
        extra={
            "lock": "ADD_FOUNTAIN_LOCK",
            "context": context,
            "waited_ms": round((time.monotonic() - started) * 1000),
        },
    )


class InteractiveWriteBusy(Exception):
    """An interactive write (POST /fountains, admin patch/delete) exceeded its bounded
    ``lock_timeout`` waiting on a lock — the advisory add lock, or a row/table lock a concurrently
    running membership refresh holds. The endpoint maps this to HTTP 503 ``{"detail": "busy"}`` with
    ``Retry-After``. Carries only ``context`` — never lock names, SQLSTATE, or driver internals
    (spec 2026-07-17 §1)."""

    def __init__(self, context: str):
        self.context = context
        super().__init__(context)


# set_config(text, text, is_local=true) → transaction-local; commit/rollback clears it, so the bound
# covers the WHOLE interactive transaction with no reset. The value is bound as TEXT (not a bare
# integer): asyncpg infers `$1` in `CAST($1 AS text)` as text and rejects an int bind, and
# set_config's 2nd arg is text regardless. The unit ('ms') is appended in SQL. No SET LOCAL (which
# cannot take binds).
_SET_LOCK_TIMEOUT_SQL = text("SELECT set_config('lock_timeout', CAST(:ms AS text) || 'ms', true)")


@asynccontextmanager
async def interactive_lock_timeout(
    session: AsyncSession, settings: Settings, *, context: str
) -> AsyncIterator[None]:
    """Run an interactive write transaction under a bounded ``lock_timeout`` so it never waits more
    than ``settings.add_lock_timeout_ms`` on ANY lock (spec 2026-07-17 §1).

    On a lock-wait expiry (SQLSTATE 55P03) roll the session back, log one WARNING, and raise
    :class:`InteractiveWriteBusy` (the endpoint → 503 busy). Any other error propagates untouched —
    no suppression, no remapping of real failures.

    The timeout is transaction-local and deliberately NOT reset — the whole transaction stays
    bounded and commit/rollback clears it. Enter this AFTER any reservation commit (which would
    otherwise clear a previously applied timeout and leave the domain transaction unbounded).
    """
    await session.execute(_SET_LOCK_TIMEOUT_SQL, {"ms": str(settings.add_lock_timeout_ms)})
    started = time.monotonic()
    try:
        yield
    except DBAPIError as exc:
        # Classify WITHOUT issuing any SQL: a 55P03 has already aborted the transaction, so any
        # statement before the rollback would raise InFailedSQLTransaction. Inspect the driver's
        # sqlstate on `orig` only. A non-55P03 error (a genuine failure) re-raises untouched.
        if getattr(exc.orig, "sqlstate", None) != PG_LOCK_NOT_AVAILABLE:
            raise
        elapsed_ms = round((time.monotonic() - started) * 1000)
        await session.rollback()
        # Named truthfully: the transaction-wide bound maps advisory, row, and table lock timeouts
        # alike, so this is NOT specifically an advisory wait — the existing advisory_lock_wait /
        # advisory_lock_acquired events stay reserved for the advisory acquisition. `elapsed_ms` is
        # time inside the bounded transaction (the helper's clock), not a specific lock's wait.
        # NEVER log the driver exception string, SQL text, payload fields, or lock-holder identity;
        # the request correlation id is stamped by RequestIdFilter.
        log.warning(
            "interactive_write_lock_timeout",
            extra={"context": context, "elapsed_ms": elapsed_ms},
        )
        raise InteractiveWriteBusy(context) from exc
