import pytest
from sqlalchemy import func, select, text

from app.models import User, WriteAttempt
from app.write_attempt_cleanup import cleanup_write_attempts, main


async def _user(session, suffix: str) -> User:
    user = User(
        logto_user_id=f"cleanup-{suffix}",
        email=f"cleanup-{suffix}@example.com",
        display_name=f"Cleanup {suffix}",
    )
    session.add(user)
    await session.flush()
    return user


async def _seed(session, user_id, count: int, age: str) -> None:
    await session.execute(
        text(
            "INSERT INTO write_attempts (id, user_id, budget, endpoint, created_at) "
            "SELECT gen_random_uuid(), :user_id, 'contribution_write', 'note_submit', "
            f"now() - interval '{age}' FROM generate_series(1, :count)"
        ),
        {"user_id": user_id, "count": count},
    )


async def _count(session) -> int:
    return (await session.execute(select(func.count()).select_from(WriteAttempt))).scalar_one()


async def test_retains_rows_at_and_inside_thirty_days(session):
    user = await _user(session, "boundary")
    await _seed(session, user.id, 1, "30 days")
    await _seed(session, user.id, 1, "29 days 23 hours")
    await _seed(session, user.id, 1, "30 days 1 second")

    result = await cleanup_write_attempts(session, batch_size=10)

    assert result.deleted == 1
    assert result.capped is False
    assert await _count(session) == 2


async def test_batches_commit_and_stop_after_short_batch(session, monkeypatch):
    user = await _user(session, "batches")
    await _seed(session, user.id, 25, "31 days")
    commit_count = 0
    real_commit = session.commit

    async def counting_commit():
        nonlocal commit_count
        commit_count += 1
        await real_commit()

    monkeypatch.setattr(session, "commit", counting_commit)

    result = await cleanup_write_attempts(session, batch_size=10, max_batches=10)

    assert result.deleted == 25
    assert result.batches == 3
    assert commit_count == 3
    assert result.capped is False
    assert await _count(session) == 0


async def test_caps_at_ten_batches_and_warns(session, caplog):
    user = await _user(session, "cap")
    await _seed(session, user.id, 105, "31 days")

    with caplog.at_level("WARNING", logger="app.write_attempt_cleanup"):
        result = await cleanup_write_attempts(session, batch_size=10, max_batches=10)

    assert result.deleted == 100
    assert result.batches == 10
    assert result.capped is True
    assert await _count(session) == 5
    record = next(record for record in caplog.records if record.name == "app.write_attempt_cleanup")
    assert record.count == 100
    assert record.cap is True
    assert not hasattr(record, "user_id")


async def test_exact_run_capacity_is_not_reported_as_capped(session, caplog):
    user = await _user(session, "exact-capacity")
    await _seed(session, user.id, 100, "31 days")

    with caplog.at_level("INFO", logger="app.write_attempt_cleanup"):
        result = await cleanup_write_attempts(session, batch_size=10, max_batches=10)

    assert result.deleted == 100
    assert result.batches == 10
    assert result.capped is False
    assert await _count(session) == 0
    record = next(record for record in caplog.records if record.name == "app.write_attempt_cleanup")
    assert record.levelname == "INFO"
    assert record.cap is False


def test_cli_exits_zero_on_success(monkeypatch):
    def successful_run(coroutine):
        coroutine.close()
        return 0

    monkeypatch.setattr("app.write_attempt_cleanup.asyncio.run", successful_run)
    monkeypatch.setattr("app.write_attempt_cleanup.configure_logging", lambda **kwargs: None)
    with pytest.raises(SystemExit) as exit_info:
        main()
    assert exit_info.value.code == 0


def test_cli_exits_nonzero_on_unhandled_cleanup_failure(monkeypatch, caplog):
    def failing_run(coroutine):
        coroutine.close()
        raise RuntimeError("database unavailable")

    monkeypatch.setattr("app.write_attempt_cleanup.asyncio.run", failing_run)
    monkeypatch.setattr("app.write_attempt_cleanup.configure_logging", lambda **kwargs: None)
    with caplog.at_level("ERROR", logger="app.write_attempt_cleanup"):
        with pytest.raises(SystemExit) as exit_info:
            main()
    assert exit_info.value.code == 1
    assert any(record.getMessage() == "write_attempt_cleanup_failed" for record in caplog.records)
