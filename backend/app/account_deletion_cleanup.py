import argparse
import asyncio
import logging
from datetime import UTC, datetime

from fastapi.concurrency import run_in_threadpool
from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import Settings, get_settings
from app.db import get_sessionmaker
from app.logging_config import configure_logging
from app.logto_management import (
    LogtoManagementClient,
    LogtoManagementError,
    identity_error_detail,
)
from app.models import DeletedAccount, StorageCleanup
from app.storage import get_storage

logger = logging.getLogger("app.account_deletion_cleanup")


async def retry_pending_identity_deletions(
    session: AsyncSession, settings: Settings, *, limit: int = 100
) -> tuple[int, int]:
    rows = (
        (
            await session.execute(
                select(DeletedAccount.logto_user_id)
                .where(DeletedAccount.identity_delete_status == "pending")
                .order_by(DeletedAccount.deleted_at)
                .limit(limit)
            )
        )
        .scalars()
        .all()
    )
    succeeded = 0
    failed = 0
    client = LogtoManagementClient(settings)
    for logto_user_id in rows:
        now = datetime.now(tz=UTC)
        try:
            await client.delete_user(logto_user_id)
        except LogtoManagementError as exc:
            failed += 1
            await session.execute(
                update(DeletedAccount)
                .where(DeletedAccount.logto_user_id == logto_user_id)
                .values(
                    identity_delete_attempts=DeletedAccount.identity_delete_attempts + 1,
                    identity_delete_last_attempt_at=now,
                    identity_delete_error=identity_error_detail(exc),
                )
            )
            await session.commit()
            logger.warning(
                "pending logto identity delete retry failed",
                extra={"sub": logto_user_id},
                exc_info=exc,
            )
            continue
        succeeded += 1
        await session.execute(
            update(DeletedAccount)
            .where(DeletedAccount.logto_user_id == logto_user_id)
            .values(
                identity_delete_status="done",
                identity_delete_attempts=DeletedAccount.identity_delete_attempts + 1,
                identity_delete_last_attempt_at=now,
                identity_delete_error=None,
            )
        )
        await session.commit()
    return succeeded, failed


async def retry_pending_storage_deletions(
    session: AsyncSession, settings: Settings, *, limit: int = 100
) -> tuple[int, int]:
    rows = (
        (
            await session.execute(
                select(StorageCleanup)
                .where(StorageCleanup.status == "pending")
                .order_by(StorageCleanup.created_at)
                .limit(limit)
            )
        )
        .scalars()
        .all()
    )
    storage = get_storage(settings)
    if storage is None:
        if rows:
            logger.warning(
                "storage object delete retry skipped because storage is unavailable",
                extra={"pending_rows": len(rows)},
            )
        return 0, len(rows)

    succeeded = 0
    failed = 0
    for row in rows:
        now = datetime.now(tz=UTC)
        try:
            await run_in_threadpool(storage.delete_object, row.object_key)
        except Exception:
            failed += 1
            row.attempts += 1
            row.last_attempt_at = now
            await session.commit()
            logger.exception(
                "pending storage object delete retry failed",
                extra={"object_key": row.object_key, "attempts": row.attempts},
            )
            continue
        succeeded += 1
        row.attempts += 1
        row.last_attempt_at = now
        row.status = "done"
        await session.commit()
    return succeeded, failed


async def _main_async(limit: int) -> int:
    settings = get_settings()
    async with get_sessionmaker()() as session:
        identity_succeeded, identity_failed = await retry_pending_identity_deletions(
            session, settings, limit=limit
        )
        storage_succeeded, storage_failed = await retry_pending_storage_deletions(
            session, settings, limit=limit
        )
    logger.info(
        "account_deletion_cleanup_complete",
        extra={
            "identity_deletes_succeeded": identity_succeeded,
            "identity_deletes_failed": identity_failed,
            "storage_deletes_succeeded": storage_succeeded,
            "storage_deletes_failed": storage_failed,
        },
    )
    # Diagnostics already went through structured logging above. This ONE stdout line is the
    # CLI's machine-readable RESULT contract for operators/CI.
    print(  # documented CLI result contract
        " ".join(
            [
                f"identity_deletes_succeeded={identity_succeeded}",
                f"identity_deletes_failed={identity_failed}",
                f"storage_deletes_succeeded={storage_succeeded}",
                f"storage_deletes_failed={storage_failed}",
            ]
        )
    )
    return 1 if identity_failed or storage_failed else 0


def main() -> None:
    settings = get_settings()
    configure_logging(level=settings.log_level, fmt=settings.log_format)
    parser = argparse.ArgumentParser(description="Retry pending account deletion cleanup.")
    parser.add_argument("--limit", type=int, default=100)
    args = parser.parse_args()
    raise SystemExit(asyncio.run(_main_async(args.limit)))


if __name__ == "__main__":
    main()
