import uuid

import pytest
from sqlalchemy import select

from app.contributions import (
    ContributionSpec,
    dk_photo_first,
    points_for,
    reactivate_contribution_for_target,
    record_contributions,
    reverse_contribution_for_target,
)
from app.geo import point_geography
from app.models import ContributionEvent, Fountain, User, UserContributionStats


async def _mk_user(session, n: int) -> User:
    u = User(
        logto_user_id=f"contrib-photo-u{n}",
        email=f"photo-u{n}@example.com",
        display_name=f"PU{n}",
    )
    session.add(u)
    await session.flush()
    return u


async def _mk_fountain(session, creator: User) -> Fountain:
    f = Fountain(
        location=point_geography(37.5, -122.2),
        is_working=True,
        created_source="user",
        added_by_user_id=creator.id,
    )
    session.add(f)
    await session.flush()
    return f


async def _stats(session, user_id) -> UserContributionStats:
    return (
        await session.execute(
            select(UserContributionStats).where(UserContributionStats.user_id == user_id)
        )
    ).scalar_one()


async def _event_status(session, target_type, target_id) -> str:
    return (
        await session.execute(
            select(ContributionEvent.status).where(
                ContributionEvent.target_type == target_type,
                ContributionEvent.target_id == target_id,
            )
        )
    ).scalar_one()


def test_points_for_photo_first():
    assert points_for("photo_first") == 5


def test_dk_photo_first():
    fid = uuid.uuid4()
    assert dk_photo_first(fid) == f"photo_first:{fid}"


@pytest.mark.asyncio
async def test_record_photo_first_awards_once(session):
    u = await _mk_user(session, 1)
    fountain = await _mk_fountain(session, u)
    photo_id = uuid.uuid4()
    ids = await record_contributions(
        session,
        [
            ContributionSpec(
                user_id=u.id,
                event_type="photo_first",
                dedup_key=dk_photo_first(fountain.id),
                fountain_id=fountain.id,
                target_type="photo",
                target_id=photo_id,
            )
        ],
    )
    assert len(ids) == 1
    stats = await _stats(session, u.id)
    assert stats.total_points == 5

    # A second upload with the same dedup_key (same fountain) does not dedup a second time.
    photo_id_2 = uuid.uuid4()
    again = await record_contributions(
        session,
        [
            ContributionSpec(
                user_id=u.id,
                event_type="photo_first",
                dedup_key=dk_photo_first(fountain.id),
                fountain_id=fountain.id,
                target_type="photo",
                target_id=photo_id_2,
            )
        ],
    )
    assert again == []
    stats_after = await _stats(session, u.id)
    assert stats_after.total_points == 5


@pytest.mark.asyncio
async def test_reverse_contribution_for_target_flips_only_that_photo(session):
    u = await _mk_user(session, 2)
    fountain = await _mk_fountain(session, u)
    photo_id = uuid.uuid4()
    await record_contributions(
        session,
        [
            ContributionSpec(
                user_id=u.id,
                event_type="photo_first",
                dedup_key=dk_photo_first(fountain.id),
                fountain_id=fountain.id,
                target_type="photo",
                target_id=photo_id,
            )
        ],
    )
    assert (await _stats(session, u.id)).total_points == 5

    count = await reverse_contribution_for_target(session, "photo", photo_id)

    assert count == 1
    assert await _event_status(session, "photo", photo_id) == "reversed"
    assert (await _stats(session, u.id)).total_points == 0


@pytest.mark.asyncio
async def test_reactivate_contribution_for_target_flips_back(session):
    u = await _mk_user(session, 3)
    fountain = await _mk_fountain(session, u)
    photo_id = uuid.uuid4()
    await record_contributions(
        session,
        [
            ContributionSpec(
                user_id=u.id,
                event_type="photo_first",
                dedup_key=dk_photo_first(fountain.id),
                fountain_id=fountain.id,
                target_type="photo",
                target_id=photo_id,
            )
        ],
    )
    await reverse_contribution_for_target(session, "photo", photo_id)
    assert (await _stats(session, u.id)).total_points == 0

    count = await reactivate_contribution_for_target(session, "photo", photo_id)

    assert count == 1
    assert await _event_status(session, "photo", photo_id) == "awarded"
    assert (await _stats(session, u.id)).total_points == 5


@pytest.mark.asyncio
async def test_reverse_scoped_to_target_leaves_other_fountains_untouched(session):
    u = await _mk_user(session, 4)
    fountain_a = await _mk_fountain(session, u)
    fountain_b = await _mk_fountain(session, u)
    photo_a = uuid.uuid4()
    photo_b = uuid.uuid4()
    await record_contributions(
        session,
        [
            ContributionSpec(
                user_id=u.id,
                event_type="photo_first",
                dedup_key=dk_photo_first(fountain_a.id),
                fountain_id=fountain_a.id,
                target_type="photo",
                target_id=photo_a,
            ),
            ContributionSpec(
                user_id=u.id,
                event_type="photo_first",
                dedup_key=dk_photo_first(fountain_b.id),
                fountain_id=fountain_b.id,
                target_type="photo",
                target_id=photo_b,
            ),
        ],
    )
    assert (await _stats(session, u.id)).total_points == 10

    count = await reverse_contribution_for_target(session, "photo", photo_a)

    assert count == 1
    assert await _event_status(session, "photo", photo_a) == "reversed"
    assert await _event_status(session, "photo", photo_b) == "awarded"
    assert (await _stats(session, u.id)).total_points == 5  # only fountain_a's points removed


@pytest.mark.asyncio
async def test_reverse_and_reactivate_idempotent(session):
    u = await _mk_user(session, 5)
    fountain = await _mk_fountain(session, u)
    photo_id = uuid.uuid4()
    await record_contributions(
        session,
        [
            ContributionSpec(
                user_id=u.id,
                event_type="photo_first",
                dedup_key=dk_photo_first(fountain.id),
                fountain_id=fountain.id,
                target_type="photo",
                target_id=photo_id,
            )
        ],
    )

    first_reverse = await reverse_contribution_for_target(session, "photo", photo_id)
    second_reverse = await reverse_contribution_for_target(session, "photo", photo_id)

    assert first_reverse == 1
    assert second_reverse == 0  # already reversed — no double decrement
    assert (await _stats(session, u.id)).total_points == 0

    first_reactivate = await reactivate_contribution_for_target(session, "photo", photo_id)
    second_reactivate = await reactivate_contribution_for_target(session, "photo", photo_id)

    assert first_reactivate == 1
    assert second_reactivate == 0  # already awarded — no double increment
    assert (await _stats(session, u.id)).total_points == 5
