import asyncio
import uuid

import pytest
from sqlalchemy import func, select, text
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from app.config import get_settings
from app.models import User, WriteAttempt
from app.rate_limit import (
    CONTRIBUTION_WRITES_PER_DAY,
    CONTRIBUTION_WRITES_PER_MIN,
    PROFILE_SYNCS_PER_MIN,
    RateLimited,
    get_write_attempt_reserver,
    reserve_write_attempt,
)


async def _user(session, suffix: str) -> User:
    user = User(
        logto_user_id=f"write-rate-{suffix}",
        email=f"write-rate-{suffix}@example.com",
        display_name=f"Write Rate {suffix}",
    )
    session.add(user)
    await session.commit()
    return user


async def _seed(
    session,
    user_id: uuid.UUID,
    count: int,
    *,
    budget: str = "contribution_write",
    endpoint: str = "fountain_create",
    age_seconds: int = 0,
) -> None:
    await session.execute(
        text(
            "INSERT INTO write_attempts (id, user_id, budget, endpoint, created_at) "
            "SELECT gen_random_uuid(), :user_id, :budget, :endpoint, "
            "clock_timestamp() - make_interval(secs => :age) "
            "FROM generate_series(1, :count)"
        ),
        {
            "user_id": user_id,
            "budget": budget,
            "endpoint": endpoint,
            "age": age_seconds,
            "count": count,
        },
    )
    await session.commit()


async def _count(session, user_id: uuid.UUID, budget: str) -> int:
    return (
        await session.execute(
            select(func.count())
            .select_from(WriteAttempt)
            .where(WriteAttempt.user_id == user_id, WriteAttempt.budget == budget)
        )
    ).scalar_one()


async def test_contribution_endpoints_share_one_minute_budget(session):
    user = await _user(session, "shared")
    user_id = user.id
    endpoints = [
        "fountain_create",
        "rating_submit",
        "attribute_submit",
        "condition_submit",
        "note_submit",
    ]
    for index in range(CONTRIBUTION_WRITES_PER_MIN):
        await reserve_write_attempt(
            session, user_id, "contribution_write", endpoints[index % len(endpoints)]
        )

    with pytest.raises(RateLimited) as error:
        await reserve_write_attempt(session, user_id, "contribution_write", "note_submit")

    assert error.value.reason == "contribution_writes_per_minute"
    assert 1 <= error.value.retry_after <= 60
    assert await _count(session, user_id, "contribution_write") == CONTRIBUTION_WRITES_PER_MIN


async def test_minute_boundary_and_rejection_do_not_insert(session):
    user = await _user(session, "minute-boundary")
    user_id = user.id
    await _seed(session, user_id, CONTRIBUTION_WRITES_PER_MIN, age_seconds=60)

    await reserve_write_attempt(session, user_id, "contribution_write", "rating_submit")
    assert await _count(session, user_id, "contribution_write") == CONTRIBUTION_WRITES_PER_MIN + 1

    await session.execute(
        text("DELETE FROM write_attempts WHERE user_id=:user_id"), {"user_id": user_id}
    )
    await session.commit()
    await _seed(session, user_id, CONTRIBUTION_WRITES_PER_MIN, age_seconds=1)

    with pytest.raises(RateLimited) as error:
        await reserve_write_attempt(session, user_id, "contribution_write", "rating_submit")
    assert error.value.reason == "contribution_writes_per_minute"
    assert 1 <= error.value.retry_after <= 60
    assert await _count(session, user_id, "contribution_write") == CONTRIBUTION_WRITES_PER_MIN


async def test_daily_limit_reason_and_retry_are_database_derived(session):
    user = await _user(session, "day")
    user_id = user.id
    # Outside the minute window but inside the rolling day.
    await _seed(session, user_id, CONTRIBUTION_WRITES_PER_DAY, age_seconds=120)

    with pytest.raises(RateLimited) as error:
        await reserve_write_attempt(session, user_id, "contribution_write", "condition_submit")

    assert error.value.reason == "contribution_writes_per_day"
    assert 1 <= error.value.retry_after <= 86400
    assert await _count(session, user_id, "contribution_write") == CONTRIBUTION_WRITES_PER_DAY


async def test_budget_and_user_isolation(session):
    first = await _user(session, "isolation-first")
    second = await _user(session, "isolation-second")
    await _seed(session, first.id, CONTRIBUTION_WRITES_PER_MIN)

    await reserve_write_attempt(session, first.id, "profile_sync", "profile_sync")
    await reserve_write_attempt(session, second.id, "contribution_write", "fountain_create")

    assert await _count(session, first.id, "profile_sync") == 1
    assert await _count(session, second.id, "contribution_write") == 1


async def test_dependency_reserver_delegates_with_request_session(session):
    user = await _user(session, "dependency")
    reserver = get_write_attempt_reserver(session)

    await reserver(user.id, "profile_sync", "profile_sync")

    assert await _count(session, user.id, "profile_sync") == 1


async def test_profile_sync_exact_reason(session):
    user = await _user(session, "profile")
    await _seed(
        session,
        user.id,
        PROFILE_SYNCS_PER_MIN,
        budget="profile_sync",
        endpoint="profile_sync",
    )

    with pytest.raises(RateLimited) as error:
        await reserve_write_attempt(session, user.id, "profile_sync", "profile_sync")
    assert error.value.reason == "profile_syncs_per_minute"
    assert 1 <= error.value.retry_after <= 60


async def test_limiter_logs_exclude_identity_and_token_data(session, caplog):
    user = await _user(session, "log-redaction")
    user_id = user.id
    secret_values = [user.logto_user_id, user.email, user.display_name, "secret.jwt.token"]

    with caplog.at_level("INFO", logger="app.rate_limit"):
        await reserve_write_attempt(session, user_id, "profile_sync", "profile_sync")

    records = [record for record in caplog.records if record.name == "app.rate_limit"]
    assert records
    admission = next(record for record in records if record.getMessage() == "write_rate_admitted")
    assert admission.window == "minute_and_day"
    assert admission.count == 1
    assert admission.day_count == 1
    rendered = " ".join(str(record.__dict__) for record in records)
    assert str(user_id) in rendered
    assert all(secret not in rendered for secret in secret_values)


async def test_committed_attempt_survives_later_domain_rollback(session):
    user = await _user(session, "rollback")
    user_id = user.id
    await reserve_write_attempt(session, user_id, "contribution_write", "note_submit")

    session.add(
        User(
            logto_user_id="rolled-back-domain-user",
            email="rolled-back@example.com",
            display_name="Rolled Back",
        )
    )
    await session.flush()
    await session.rollback()

    assert await _count(session, user_id, "contribution_write") == 1
    assert (
        await session.execute(
            select(func.count())
            .select_from(User)
            .where(User.logto_user_id == "rolled-back-domain-user")
        )
    ).scalar_one() == 0


async def test_uncommitted_provisioning_and_attempt_commit_atomically(session):
    user = User(
        logto_user_id="write-rate-new-admitted",
        email="new-admitted@example.com",
        display_name="New Admitted",
    )
    session.add(user)
    await session.flush()
    user_id = user.id

    await reserve_write_attempt(session, user_id, "contribution_write", "fountain_create")
    await session.rollback()  # cannot undo the limiter's admission commit

    assert await session.get(User, user_id) is not None
    assert await _count(session, user_id, "contribution_write") == 1


async def test_rejection_rolls_back_uncommitted_provisioning_and_reprovisions(session):
    subject = "write-rate-first-rejected"
    user = User(
        logto_user_id=subject,
        email="first-rejected@example.com",
        display_name="First Rejected",
    )
    session.add(user)
    await session.flush()
    user_id = user.id
    # Model a transaction that already contains enough attempts to reject. The required
    # rollback must remove both these uncommitted rows and the just-provisioned FK target.
    for _ in range(CONTRIBUTION_WRITES_PER_MIN):
        session.add(
            WriteAttempt(
                user_id=user_id,
                budget="contribution_write",
                endpoint="fountain_create",
            )
        )
    await session.flush()

    with pytest.raises(RateLimited):
        await reserve_write_attempt(session, user_id, "contribution_write", "fountain_create")

    assert await session.get(User, user_id) is None
    assert await _count(session, user_id, "contribution_write") == 0

    replacement = User(
        logto_user_id=subject,
        email="replacement@example.com",
        display_name="Replacement",
    )
    session.add(replacement)
    await session.flush()
    assert replacement.id != user_id


async def test_committed_admin_reconciliation_survives_rejection(session):
    user = await _user(session, "admin-reconciliation")
    user_id = user.id
    user.is_admin = True
    await session.commit()
    await _seed(session, user_id, CONTRIBUTION_WRITES_PER_MIN)

    with pytest.raises(RateLimited):
        await reserve_write_attempt(session, user_id, "contribution_write", "note_submit")

    reconciled = await session.get(User, user_id)
    assert reconciled is not None
    assert reconciled.is_admin is True


async def test_parallel_requests_never_over_admit(clean_db):
    settings = get_settings()
    participants = CONTRIBUTION_WRITES_PER_MIN + 5
    engine = create_async_engine(
        settings.database_url,
        pool_size=participants,
        max_overflow=0,
    )
    maker = async_sessionmaker(engine, expire_on_commit=False)
    try:
        async with maker() as setup:
            user = await _user(setup, "parallel")
            user_id = user.id

        ready = asyncio.Event()
        arrived = 0
        arrived_lock = asyncio.Lock()

        async def attempt() -> Exception | None:
            nonlocal arrived
            async with maker() as worker:
                async with arrived_lock:
                    arrived += 1
                    if arrived == participants:
                        ready.set()
                await ready.wait()
                try:
                    await reserve_write_attempt(
                        worker, user_id, "contribution_write", "attribute_submit"
                    )
                except RateLimited as error:
                    return error
                return None

        results = await asyncio.gather(*(attempt() for _ in range(participants)))
        rejected = [result for result in results if isinstance(result, RateLimited)]
        assert len(rejected) == participants - CONTRIBUTION_WRITES_PER_MIN
        assert all(error.reason == "contribution_writes_per_minute" for error in rejected)

        async with maker() as verify:
            assert (
                await _count(verify, user_id, "contribution_write") == CONTRIBUTION_WRITES_PER_MIN
            )
    finally:
        await engine.dispose()
