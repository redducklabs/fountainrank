"""Shared content-report chokepoint (#11, spec §7). One entry point for every report
(photo/note/fountain): per-type category validation, idempotent insert, and rate limiting,
so all three report endpoints have byte-for-byte identical semantics.

Ordering is **dedupe-BEFORE-rate**: an existing pending report by the same reporter on the
same item is an idempotent 204 that consumes NO rate budget, regardless of the reporter's
quota state. Only a genuinely NEW report is rate-limited. The per-user advisory lock
serializes a user's report requests, so the "already pending?" check + insert is race-free
for that user; `ON CONFLICT DO NOTHING` remains a backstop. The raw free-text `note` is
NEVER logged (may contain PII).
"""

import logging
import uuid

from fastapi import HTTPException
from fastapi import status as http_status
from sqlalchemy import select
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.ext.asyncio import AsyncSession

from app.locks import CONTENT_REPORT_LOCK_NS
from app.models import ContentReport
from app.rate_limit import RateLimited, acquire_user_lock, enforce_report_rate

logger = logging.getLogger(__name__)

# Per-type allowed category subset (spec §6). The DB CHECK allows the superset; the
# chokepoint enforces the per-type subset (422 on mismatch); the frontends offer exactly
# these. `photo` is unchanged from the pre-#11 photo path.
ALLOWED_CATEGORIES: dict[str, frozenset[str]] = {
    "photo": frozenset({"inappropriate", "not_a_fountain", "spam", "other"}),
    "note": frozenset({"spam", "abuse", "inappropriate", "inaccurate", "other"}),
    "fountain": frozenset({"not_a_fountain", "spam", "inappropriate", "inaccurate", "other"}),
}


async def create_content_report(
    session: AsyncSession,
    *,
    content_type: str,
    content_id: uuid.UUID,
    fountain_id: uuid.UUID,
    reporter_user_id: uuid.UUID,
    category: str,
    note: str | None,
) -> None:
    """Idempotent, rate-limited report insert (spec §7). Category validated per content_type;
    a duplicate pending report is a silent no-op (idempotent 204) that consumes no rate budget;
    a NEW report is rate-limited. Commits. NEVER logs the raw note (PII)."""
    allowed = ALLOWED_CATEGORIES.get(content_type)
    if allowed is None:  # defensive: internal misuse of the soft-polymorphic boundary
        raise HTTPException(
            http_status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail=f"unknown content_type: {content_type}",
        )
    if category not in allowed:
        raise HTTPException(
            http_status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail=f"invalid category for {content_type}: {category}",
        )

    # Serialize this user's report requests so dedupe-check + insert is race-free.
    await acquire_user_lock(session, CONTENT_REPORT_LOCK_NS, reporter_user_id)

    # Idempotent: an existing PENDING report by this reporter for this item -> no-op 204.
    existing = (
        await session.execute(
            select(ContentReport.id)
            .where(
                ContentReport.content_type == content_type,
                ContentReport.content_id == content_id,
                ContentReport.reporter_user_id == reporter_user_id,
                ContentReport.status == "pending",
            )
            .limit(1)
        )
    ).first()
    if existing is not None:
        await session.commit()  # releases the lock; no rate charge
        logger.info(
            "content report duplicate ignored",
            extra={
                "content_type": content_type,
                "content_id": str(content_id),
                "user_id": str(reporter_user_id),
            },
        )
        return

    # NEW report: apply the rate limit (lock already held).
    try:
        await enforce_report_rate(session, reporter_user_id)
    except RateLimited as exc:
        await session.rollback()
        logger.info(
            "content report rate limited",
            extra={"user_id": str(reporter_user_id), "reason": exc.reason},
        )
        raise HTTPException(
            http_status.HTTP_429_TOO_MANY_REQUESTS,
            detail=exc.reason,
            headers={"Retry-After": str(exc.retry_after)},
        ) from exc

    stmt = (
        pg_insert(ContentReport)
        .values(
            content_type=content_type,
            content_id=content_id,
            fountain_id=fountain_id,
            reporter_user_id=reporter_user_id,
            category=category,
            note=note,
        )
        .on_conflict_do_nothing(  # backstop; the lock already prevents same-user races
            index_elements=["content_type", "content_id", "reporter_user_id"],
            index_where=(ContentReport.status == "pending"),
        )
        .returning(ContentReport.id)
    )
    inserted = (await session.execute(stmt)).first() is not None
    await session.commit()
    # Deliberately logs only ids/type/category — NEVER the free-text note (may contain PII).
    logger.info(
        "content reported",
        extra={
            "content_type": content_type,
            "content_id": str(content_id),
            "fountain_id": str(fountain_id),
            "user_id": str(reporter_user_id),
            "category": category,
            "inserted": inserted,
        },
    )
