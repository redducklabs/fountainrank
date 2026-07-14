import asyncio
import logging
from dataclasses import dataclass
from datetime import datetime

from sqlalchemy import func, select, text
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import get_settings
from app.db import get_sessionmaker
from app.logging_config import configure_logging

logger = logging.getLogger("app.write_attempt_cleanup")

RETENTION_DAYS = 30
BATCH_SIZE = 10_000
MAX_BATCHES = 10


@dataclass(frozen=True)
class CleanupResult:
    deleted: int
    batches: int
    capped: bool
    cutoff: datetime


async def cleanup_write_attempts(
    session: AsyncSession,
    *,
    batch_size: int = BATCH_SIZE,
    max_batches: int = MAX_BATCHES,
) -> CleanupResult:
    """Delete attempts older than one fixed database-derived 30-day cutoff in batches."""
    if batch_size <= 0 or max_batches <= 0:
        raise ValueError("batch_size and max_batches must be positive")

    cutoff = (
        await session.execute(select(func.now() - text(f"interval '{RETENTION_DAYS} days'")))
    ).scalar_one()
    deleted = 0
    batches = 0
    capped = False

    for batch_number in range(max_batches):
        rows = (
            await session.execute(
                text(
                    "WITH doomed AS ("
                    " SELECT id FROM write_attempts WHERE created_at < :cutoff "
                    " ORDER BY created_at, id LIMIT :batch_size"
                    ") "
                    "DELETE FROM write_attempts AS attempts USING doomed "
                    "WHERE attempts.id = doomed.id RETURNING attempts.id"
                ),
                {"cutoff": cutoff, "batch_size": batch_size},
            )
        ).all()
        batch_deleted = len(rows)
        deleted += batch_deleted
        batches = batch_number + 1
        await session.commit()
        if batch_deleted < batch_size:
            break
    else:
        capped = True

    level = logging.WARNING if capped else logging.INFO
    logger.log(
        level,
        "write_attempt_cleanup_complete",
        extra={"count": deleted, "cutoff": cutoff.isoformat(), "cap": capped},
    )
    return CleanupResult(deleted=deleted, batches=batches, capped=capped, cutoff=cutoff)


async def _main_async() -> int:
    async with get_sessionmaker()() as session:
        await cleanup_write_attempts(session)
    return 0


def main() -> None:
    settings = get_settings()
    configure_logging(level=settings.log_level, fmt=settings.log_format)
    try:
        exit_code = asyncio.run(_main_async())
    except Exception:
        logger.exception("write_attempt_cleanup_failed")
        raise SystemExit(1) from None
    raise SystemExit(exit_code)


if __name__ == "__main__":
    main()
