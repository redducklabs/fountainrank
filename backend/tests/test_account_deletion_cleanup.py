import pytest

from app.account_deletion_cleanup import (
    retry_pending_identity_deletions,
    retry_pending_storage_deletions,
)
from app.config import Settings
from app.logto_management import LogtoManagementError
from app.models import DeletedAccount, StorageCleanup


@pytest.mark.asyncio
async def test_retry_pending_identity_deletions_marks_success(session, monkeypatch):
    deleted = DeletedAccount(logto_user_id="logto|deleted")
    session.add(deleted)
    await session.commit()
    calls: list[str] = []

    async def fake_delete_user(self, logto_user_id: str) -> None:
        calls.append(logto_user_id)

    monkeypatch.setattr("app.logto_management.LogtoManagementClient.delete_user", fake_delete_user)

    succeeded, failed = await retry_pending_identity_deletions(session, Settings())

    assert (succeeded, failed) == (1, 0)
    assert calls == ["logto|deleted"]
    await session.refresh(deleted)
    assert deleted.identity_delete_status == "done"
    assert deleted.identity_delete_attempts == 1
    assert deleted.identity_delete_error is None


@pytest.mark.asyncio
async def test_retry_pending_identity_deletions_leaves_failure_pending(session, monkeypatch):
    deleted = DeletedAccount(logto_user_id="logto|deleted")
    session.add(deleted)
    await session.commit()

    async def fake_delete_user(self, logto_user_id: str) -> None:
        raise LogtoManagementError("down")

    monkeypatch.setattr("app.logto_management.LogtoManagementClient.delete_user", fake_delete_user)

    succeeded, failed = await retry_pending_identity_deletions(session, Settings())

    assert (succeeded, failed) == (0, 1)
    await session.refresh(deleted)
    assert deleted.identity_delete_status == "pending"
    assert deleted.identity_delete_attempts == 1
    # The ledger records the failure reason, not just the exception class, so an operator can
    # tell a misconfiguration from a transient 5xx.
    assert deleted.identity_delete_error == "LogtoManagementError: down"


@pytest.mark.asyncio
async def test_retry_pending_storage_deletions_marks_success(session, monkeypatch):
    row = StorageCleanup(object_key="photos/full.jpg", reason="moderation_delete")
    session.add(row)
    await session.commit()
    deleted_keys: list[str] = []

    class FakeStorage:
        def delete_object(self, key: str) -> None:
            deleted_keys.append(key)

    monkeypatch.setattr("app.account_deletion_cleanup.get_storage", lambda settings: FakeStorage())

    succeeded, failed = await retry_pending_storage_deletions(session, Settings())

    assert (succeeded, failed) == (1, 0)
    assert deleted_keys == ["photos/full.jpg"]
    await session.refresh(row)
    assert row.status == "done"
    assert row.attempts == 1


@pytest.mark.asyncio
async def test_retry_pending_storage_deletions_leaves_failure_pending(session, monkeypatch):
    row = StorageCleanup(object_key="photos/full.jpg", reason="moderation_delete")
    session.add(row)
    await session.commit()

    class FakeStorage:
        def delete_object(self, key: str) -> None:
            raise RuntimeError("down")

    monkeypatch.setattr("app.account_deletion_cleanup.get_storage", lambda settings: FakeStorage())

    succeeded, failed = await retry_pending_storage_deletions(session, Settings())

    assert (succeeded, failed) == (0, 1)
    await session.refresh(row)
    assert row.status == "pending"
    assert row.attempts == 1
