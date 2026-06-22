import uuid

import pytest
from sqlalchemy import func, select

from app.contributions import (
    ContributionSpec,
    points_for,
    record_contributions,
)
from app.models import ContributionEvent, User, UserContributionStats


async def _mk_user(session, n: int) -> User:
    u = User(logto_user_id=f"contrib-u{n}", email=f"u{n}@example.com", display_name=f"U{n}")
    session.add(u)
    await session.flush()
    return u


def test_points_for_defaults_and_unknown():
    assert points_for("add_fountain") == 10
    assert points_for("rate") == 2
    assert points_for("first_in_area_bonus") == 15
    assert points_for("verify_working") == 3
    assert points_for("report_condition") == 2
    with pytest.raises(ValueError):
        points_for("nope")


@pytest.mark.asyncio
async def test_condition_event_target_pair_validation(session):
    u = await _mk_user(session, 20)
    # Legal: verify_working / report_condition target a condition_report.
    ids = await record_contributions(
        session,
        [
            ContributionSpec(
                user_id=u.id,
                event_type="verify_working",
                dedup_key="verify:u20:f:20260622",
                target_type="condition_report",
            )
        ],
    )
    assert len(ids) == 1
    # Illegal pair: a condition event with the wrong target_type is rejected.
    with pytest.raises(ValueError):
        await record_contributions(
            session,
            [
                ContributionSpec(
                    user_id=u.id,
                    event_type="report_condition",
                    dedup_key="cond:bad",
                    target_type="rating",
                )
            ],
        )


async def _total_points(session, user_id) -> int:
    return (
        await session.execute(
            select(UserContributionStats.total_points).where(
                UserContributionStats.user_id == user_id
            )
        )
    ).scalar_one()


@pytest.mark.asyncio
async def test_record_inserts_event_and_creates_stats(session):
    u = await _mk_user(session, 1)
    ids = await record_contributions(
        session,
        [
            ContributionSpec(
                user_id=u.id,
                event_type="add_fountain",
                dedup_key="add_fountain:f1",
                target_type="fountain",
                target_id=uuid.uuid4(),
            )
        ],
    )
    assert len(ids) == 1
    stats = (
        await session.execute(
            select(UserContributionStats).where(UserContributionStats.user_id == u.id)
        )
    ).scalar_one()
    assert stats.total_points == 10
    assert stats.fountains_added == 1
    assert stats.ratings_count == 0


@pytest.mark.asyncio
async def test_dedup_idempotent(session):
    u = await _mk_user(session, 2)
    spec = ContributionSpec(
        user_id=u.id,
        event_type="add_fountain",
        dedup_key="add_fountain:dup",
        target_type="fountain",
        target_id=uuid.uuid4(),
    )
    first = await record_contributions(session, [spec])
    assert len(first) == 1
    second = await record_contributions(session, [spec])
    assert second == []
    assert await _total_points(session, u.id) == 10  # not double-counted
    n_events = (
        await session.execute(
            select(func.count())
            .select_from(ContributionEvent)
            .where(ContributionEvent.user_id == u.id)
        )
    ).scalar_one()
    assert n_events == 1


@pytest.mark.asyncio
async def test_first_bonus_once_per_key_but_per_user(session):
    u1 = await _mk_user(session, 3)
    u2 = await _mk_user(session, 4)
    # u1's first-fountain bonus fires once even if attempted twice.
    await record_contributions(
        session,
        [
            ContributionSpec(
                user_id=u1.id, event_type="first_fountain_bonus", dedup_key="first_fountain:u1"
            )
        ],
    )
    again = await record_contributions(
        session,
        [
            ContributionSpec(
                user_id=u1.id, event_type="first_fountain_bonus", dedup_key="first_fountain:u1"
            )
        ],
    )
    assert again == []
    # u2 gets its own.
    u2_ids = await record_contributions(
        session,
        [
            ContributionSpec(
                user_id=u2.id, event_type="first_fountain_bonus", dedup_key="first_fountain:u2"
            )
        ],
    )
    assert len(u2_ids) == 1
    assert await _total_points(session, u1.id) == 5
    assert await _total_points(session, u2.id) == 5


@pytest.mark.asyncio
async def test_stat_counters_per_type(session):
    u = await _mk_user(session, 5)
    await record_contributions(
        session,
        [
            ContributionSpec(
                user_id=u.id,
                event_type="rate",
                dedup_key="rate:u5:f:1",
                target_type="rating",
                target_id=uuid.uuid4(),
            ),
            ContributionSpec(
                user_id=u.id,
                event_type="rate",
                dedup_key="rate:u5:f:2",
                target_type="rating",
                target_id=uuid.uuid4(),
            ),
            ContributionSpec(
                user_id=u.id,
                event_type="observe_attribute",
                dedup_key="attr:u5:f:1",
                target_type="attribute_observation",
                target_id=uuid.uuid4(),
            ),
        ],
    )
    stats = (
        await session.execute(
            select(UserContributionStats).where(UserContributionStats.user_id == u.id)
        )
    ).scalar_one()
    assert stats.ratings_count == 2
    assert stats.attributes_count == 1
    assert stats.total_points == 2 + 2 + 2


@pytest.mark.asyncio
async def test_validation_rejects_bad_event_and_pair(session):
    u = await _mk_user(session, 6)
    with pytest.raises(ValueError):
        await record_contributions(
            session, [ContributionSpec(user_id=u.id, event_type="bogus", dedup_key="x")]
        )
    with pytest.raises(ValueError):
        await record_contributions(
            session,
            [
                ContributionSpec(
                    user_id=u.id, event_type="rate", dedup_key="y", target_type="fountain"
                )
            ],
        )
    with pytest.raises(ValueError):
        await record_contributions(
            session,
            [ContributionSpec(user_id=u.id, event_type="rate", dedup_key="z", target_type="weird")],
        )


@pytest.mark.asyncio
async def test_multi_user_batch(session):
    u1 = await _mk_user(session, 7)
    u2 = await _mk_user(session, 8)
    await record_contributions(
        session,
        [
            ContributionSpec(
                user_id=u1.id,
                event_type="add_fountain",
                dedup_key="add_fountain:fa",
                target_type="fountain",
                target_id=uuid.uuid4(),
            ),
            ContributionSpec(
                user_id=u2.id,
                event_type="add_fountain",
                dedup_key="add_fountain:fb",
                target_type="fountain",
                target_id=uuid.uuid4(),
            ),
        ],
    )
    assert await _total_points(session, u1.id) == 10
    assert await _total_points(session, u2.id) == 10
