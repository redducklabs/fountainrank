"""Durable, Postgres-count-based per-user rate limiting for authenticated writes and the
fountain-photos feature: bursts must be bounded by database row counts — not an in-process
counter — so the limits hold across pods without a Redis dependency.

Three independent gates:
- **Authenticated JSON writes** (`reserve_write_attempt`) commit one admission attempt before
  domain work. Contribution endpoints share a budget; profile sync uses a separate budget.
- **Upload reservation** (`reserve_upload`/`finalize_upload`) is the *first authoritative
  gate* for an upload, evaluated **before** the request body is read or any Pillow/S3 work
  runs. It counts `upload_attempts` rows in two dimensions so that failed attempts still
  cost budget: (a) an *attempt-rate* window (`reserved`+`completed`+`failed`, non-expired)
  bounding sequential-failure abuse, and (b) a *success-quota* window (`completed` only)
  bounding the product limit. On success it inserts a `reserved` row that the caller must
  later `finalize_upload` to `completed` or `failed`.
- **Report rate** (`check_report_rate`) is a cheap insert-time check with no reservation:
  count `content_reports` by that reporter in rolling windows.

All gates run under a per-user Postgres advisory lock (`pg_advisory_xact_lock`, two-arg
form) so the count-then-insert is atomic against concurrent requests from the same user —
a plain count-then-insert races (concurrent requests all observe the same pre-count and all
proceed). The lock is transaction-scoped: it releases automatically on commit/rollback, and
callers should hold it only around the tiny reservation/count-and-insert — never across
CPU/S3 work — so it cannot starve the connection pool.
"""

import logging
import uuid
import zlib
from collections.abc import Awaitable, Callable
from typing import Literal

from fastapi import Depends
from sqlalchemy import func, select, text
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import Settings
from app.db import get_session
from app.locks import CONTENT_REPORT_LOCK_NS, PHOTO_UPLOAD_LOCK_NS, WRITE_RATE_LIMIT_LOCK_NS
from app.models import ContentReport, UploadAttempt, WriteAttempt

logger = logging.getLogger(__name__)

# Attempt-rate limit (design §6): counts all non-expired upload_attempts rows regardless of
# status (reserved + completed + failed) — this is what stops sequential abuse through
# failures, since a failed attempt still costs budget.
UPLOAD_ATTEMPTS_PER_MIN = 10
UPLOAD_ATTEMPTS_PER_DAY = 60
# Success-quota limit: counts only `completed` attempts — the product limit.
UPLOAD_COMPLETED_PER_DAY = 30
# Report rate limit: counts all content_reports by that reporter.
REPORTS_PER_MIN = 20
REPORTS_PER_DAY = 100

_MINUTE_WINDOW_SECONDS = 60
_DAY_WINDOW_SECONDS = 24 * 60 * 60

WriteBudget = Literal["contribution_write", "profile_sync"]
WriteEndpoint = Literal[
    "fountain_create",
    "rating_submit",
    "attribute_submit",
    "condition_submit",
    "note_submit",
    "profile_sync",
]

CONTRIBUTION_WRITES_PER_MIN = 20
CONTRIBUTION_WRITES_PER_DAY = 200
PROFILE_SYNCS_PER_MIN = 10
PROFILE_SYNCS_PER_DAY = 100

_WRITE_LIMITS: dict[WriteBudget, tuple[int, int, str, str]] = {
    "contribution_write": (
        CONTRIBUTION_WRITES_PER_MIN,
        CONTRIBUTION_WRITES_PER_DAY,
        "contribution_writes_per_minute",
        "contribution_writes_per_day",
    ),
    "profile_sync": (
        PROFILE_SYNCS_PER_MIN,
        PROFILE_SYNCS_PER_DAY,
        "profile_syncs_per_minute",
        "profile_syncs_per_day",
    ),
}

WriteAttemptReserver = Callable[[uuid.UUID, WriteBudget, WriteEndpoint], Awaitable[None]]


class RateLimited(Exception):
    """A per-user rate limit or quota was hit. The endpoint maps this to HTTP 429 with a
    `Retry-After: {retry_after}` header. `reason` is a short machine code for logging — it
    never contains sensitive data."""

    def __init__(self, reason: str, retry_after: int):
        self.reason = reason
        self.retry_after = retry_after
        super().__init__(reason)


def _user_lock_key(user_id: uuid.UUID) -> int:
    """Deterministic signed-32-bit hash of a user id for use as the advisory-lock `user_key`
    argument. Postgres advisory-lock args are signed int4, so this must NOT use Python's
    randomized `hash()` (which also varies per-process/run) — `zlib.crc32` is stable across
    processes and inputs, then mapped into the signed int32 range."""
    k = zlib.crc32(user_id.bytes)
    return k - 2**32 if k >= 2**31 else k


async def acquire_user_lock(session: AsyncSession, namespace: int, user_id: uuid.UUID) -> None:
    """Take the transaction-scoped per-user advisory lock for `namespace`. Releases
    automatically on commit/rollback of `session`'s current transaction."""
    key = _user_lock_key(user_id)
    await session.execute(
        text("SELECT pg_advisory_xact_lock(:ns, :uk)"), {"ns": namespace, "uk": key}
    )


async def reserve_write_attempt(
    session: AsyncSession,
    user_id: uuid.UUID,
    budget: WriteBudget,
    endpoint: WriteEndpoint,
) -> None:
    """Commit one durable authenticated-write admission attempt.

    A per-user transaction advisory lock makes count-and-insert race-free across pods.
    Rejections explicitly roll back before raising so the lock and any uncommitted auth
    provisioning are released together. Admissions commit before later domain work.
    """
    minute_limit, day_limit, minute_reason, day_reason = _WRITE_LIMITS[budget]
    await acquire_user_lock(session, WRITE_RATE_LIMIT_LOCK_NS, user_id)

    # MATERIALIZED guarantees clock_timestamp() is evaluated once. Counts, oldest rows,
    # and Retry-After therefore all use one PostgreSQL clock and never Python wall time.
    row = (
        await session.execute(
            text(
                "WITH clock AS MATERIALIZED (SELECT clock_timestamp() AS now), "
                "counts AS ("
                " SELECT count(*) FILTER (WHERE created_at > clock.now - interval '60 seconds') "
                "        AS minute_count, "
                " count(*) FILTER (WHERE created_at > clock.now - interval '86400 seconds') "
                "        AS day_count, "
                " min(created_at) FILTER "
                "   (WHERE created_at > clock.now - interval '60 seconds') AS minute_oldest, "
                " min(created_at) FILTER "
                "   (WHERE created_at > clock.now - interval '86400 seconds') AS day_oldest, "
                " clock.now AS now "
                " FROM clock LEFT JOIN write_attempts "
                "   ON user_id = :user_id AND budget = :budget "
                " GROUP BY clock.now"
                ") "
                "SELECT minute_count, day_count, "
                " GREATEST(1, ceil(extract(epoch FROM "
                "   (minute_oldest + interval '60 seconds' - now))))::integer AS minute_retry, "
                " GREATEST(1, ceil(extract(epoch FROM "
                "   (day_oldest + interval '86400 seconds' - now))))::integer AS day_retry "
                "FROM counts"
            ),
            {"user_id": user_id, "budget": budget},
        )
    ).one()

    if row.minute_count >= minute_limit:
        await session.rollback()
        logger.info(
            "write_rate_limited",
            extra={
                "user_id": str(user_id),
                "budget": budget,
                "endpoint": endpoint,
                "window": "minute",
                "count": row.minute_count,
                "retry_after": row.minute_retry,
            },
        )
        raise RateLimited(minute_reason, retry_after=row.minute_retry)

    if row.day_count >= day_limit:
        await session.rollback()
        logger.info(
            "write_rate_limited",
            extra={
                "user_id": str(user_id),
                "budget": budget,
                "endpoint": endpoint,
                "window": "day",
                "count": row.day_count,
                "retry_after": row.day_retry,
            },
        )
        raise RateLimited(day_reason, retry_after=row.day_retry)

    session.add(WriteAttempt(user_id=user_id, budget=budget, endpoint=endpoint))
    await session.commit()
    logger.info(
        "write_rate_admitted",
        extra={
            "user_id": str(user_id),
            "budget": budget,
            "endpoint": endpoint,
            "window": "minute_and_day",
            "count": row.minute_count + 1,
            "day_count": row.day_count + 1,
        },
    )


def get_write_attempt_reserver(
    session: AsyncSession = Depends(get_session),
) -> WriteAttemptReserver:
    """Overrideable FastAPI seam bound to the request's existing database session."""

    async def reserve(user_id: uuid.UUID, budget: WriteBudget, endpoint: WriteEndpoint) -> None:
        await reserve_write_attempt(session, user_id, budget, endpoint)

    return reserve


async def _count_since(
    session: AsyncSession, user_id: uuid.UUID, window_seconds: int, ttl_seconds: int | None
) -> int:
    """Count non-expired `upload_attempts` rows for `user_id` created within the last
    `window_seconds`, regardless of status (reserved + completed + failed). A `reserved` row
    older than `ttl_seconds` is excluded (it is an abandoned reservation, not live budget)."""
    conditions = [
        UploadAttempt.user_id == user_id,
        UploadAttempt.created_at > func.now() - text(f"interval '{window_seconds} seconds'"),
    ]
    stmt = select(func.count()).select_from(UploadAttempt).where(*conditions)
    if ttl_seconds is not None:
        stmt = stmt.where(
            ~(
                (UploadAttempt.status == "reserved")
                & (
                    UploadAttempt.created_at
                    < func.now() - text(f"interval '{ttl_seconds} seconds'")
                )
            )
        )
    return (await session.execute(stmt)).scalar_one()


async def _count_completed_since(
    session: AsyncSession, user_id: uuid.UUID, window_seconds: int
) -> int:
    stmt = (
        select(func.count())
        .select_from(UploadAttempt)
        .where(
            UploadAttempt.user_id == user_id,
            UploadAttempt.status == "completed",
            UploadAttempt.created_at > func.now() - text(f"interval '{window_seconds} seconds'"),
        )
    )
    return (await session.execute(stmt)).scalar_one()


async def _count_reports_since(
    session: AsyncSession, user_id: uuid.UUID, window_seconds: int
) -> int:
    stmt = (
        select(func.count())
        .select_from(ContentReport)
        .where(
            ContentReport.reporter_user_id == user_id,
            ContentReport.created_at > func.now() - text(f"interval '{window_seconds} seconds'"),
        )
    )
    return (await session.execute(stmt)).scalar_one()


async def reserve_upload(
    session: AsyncSession, user_id: uuid.UUID, settings: Settings
) -> uuid.UUID:
    """Authoritative upload rate gate, run BEFORE the request body is read or any Pillow/S3
    work happens. Under the per-user upload advisory lock, evaluate three checks (each ->
    `RateLimited`): the 60s and 24h attempt-rate windows, then the 24h success-quota window.
    Otherwise insert a `reserved` UploadAttempt row and return its id — the caller must
    later call `finalize_upload` to mark it `completed` or `failed`."""
    await acquire_user_lock(session, PHOTO_UPLOAD_LOCK_NS, user_id)

    ttl = settings.upload_reservation_ttl_seconds

    minute_count = await _count_since(session, user_id, _MINUTE_WINDOW_SECONDS, ttl)
    if minute_count >= UPLOAD_ATTEMPTS_PER_MIN:
        logger.info(
            "upload_rate_limited",
            extra={"user_id": str(user_id), "kind": "attempt_per_minute", "count": minute_count},
        )
        raise RateLimited("upload_attempts_per_minute", retry_after=_MINUTE_WINDOW_SECONDS)

    day_count = await _count_since(session, user_id, _DAY_WINDOW_SECONDS, ttl)
    if day_count >= UPLOAD_ATTEMPTS_PER_DAY:
        logger.info(
            "upload_rate_limited",
            extra={"user_id": str(user_id), "kind": "attempt_per_day", "count": day_count},
        )
        raise RateLimited("upload_attempts_per_day", retry_after=_DAY_WINDOW_SECONDS)

    completed_count = await _count_completed_since(session, user_id, _DAY_WINDOW_SECONDS)
    if completed_count >= UPLOAD_COMPLETED_PER_DAY:
        logger.info(
            "upload_quota_exhausted",
            extra={"user_id": str(user_id), "kind": "completed_per_day", "count": completed_count},
        )
        raise RateLimited("upload_completed_per_day", retry_after=_DAY_WINDOW_SECONDS)

    attempt = UploadAttempt(user_id=user_id, status="reserved")
    session.add(attempt)
    await session.flush()
    logger.info("upload_reserved", extra={"user_id": str(user_id), "attempt_id": str(attempt.id)})
    return attempt.id


async def finalize_upload(session: AsyncSession, attempt_id: uuid.UUID, status: str) -> None:
    """Mark a reserved UploadAttempt as `completed` or `failed`. A `failed` row still counts
    toward the attempt-rate window (design §6) — it is intentionally not deleted."""
    if status not in ("completed", "failed"):
        raise ValueError(f"invalid finalize status: {status!r}")
    attempt = await session.get(UploadAttempt, attempt_id)
    if attempt is None:
        logger.warning("finalize_upload_missing_attempt", extra={"attempt_id": str(attempt_id)})
        return
    attempt.status = status
    attempt.finalized_at = func.now()
    await session.flush()
    logger.info(
        "upload_finalized",
        extra={"attempt_id": str(attempt_id), "status": status, "user_id": str(attempt.user_id)},
    )


async def enforce_report_rate(session: AsyncSession, user_id: uuid.UUID) -> None:
    """Lock-free: raise RateLimited if the user is over the 60s/24h report windows. The
    CALLER must already hold the per-user report advisory lock (`CONTENT_REPORT_LOCK_NS`)."""
    minute_count = await _count_reports_since(session, user_id, _MINUTE_WINDOW_SECONDS)
    if minute_count >= REPORTS_PER_MIN:
        logger.info(
            "report_rate_limited",
            extra={"user_id": str(user_id), "kind": "report_per_minute", "count": minute_count},
        )
        raise RateLimited("reports_per_minute", retry_after=_MINUTE_WINDOW_SECONDS)

    day_count = await _count_reports_since(session, user_id, _DAY_WINDOW_SECONDS)
    if day_count >= REPORTS_PER_DAY:
        logger.info(
            "report_rate_limited",
            extra={"user_id": str(user_id), "kind": "report_per_day", "count": day_count},
        )
        raise RateLimited("reports_per_day", retry_after=_DAY_WINDOW_SECONDS)


async def check_report_rate(session: AsyncSession, user_id: uuid.UUID) -> None:
    """Public gate (kept for tests/back-compat): acquire the per-user report advisory lock,
    then enforce the 60s/24h `content_reports` windows."""
    await acquire_user_lock(session, CONTENT_REPORT_LOCK_NS, user_id)
    await enforce_report_rate(session, user_id)
