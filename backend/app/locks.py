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

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

log = logging.getLogger(__name__)

# "FNTR" — the single global add/merge serialization key (low write volume).
ADD_FOUNTAIN_LOCK_KEY = 0x464E5452

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
