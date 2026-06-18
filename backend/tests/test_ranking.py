import uuid

from app.models import Fountain, Rating, User
from app.ranking import recompute_fountain_ranking


async def _make_fountain(session) -> Fountain:
    user = User(logto_user_id=f"u-{uuid.uuid4()}", email="u@example.com", display_name="U")
    session.add(user)
    await session.flush()
    f = Fountain(
        location="SRID=4326;POINT(-122.4194 37.7749)",
        is_working=True,
        added_by_user_id=user.id,
    )
    session.add(f)
    await session.flush()
    return f, user


async def test_recompute_with_no_ratings_is_zeroed(session):
    f, _ = await _make_fountain(session)
    await recompute_fountain_ranking(session, f.id)
    await session.refresh(f)
    assert f.rating_count == 0
    assert f.average_rating is None
    assert f.ranking_score is None


async def test_recompute_sets_denormalized_fields(session):
    f, user = await _make_fountain(session)
    for rt, stars in ((1, 5), (2, 3)):
        session.add(Rating(fountain_id=f.id, user_id=user.id, rating_type_id=rt, stars=stars))
    await session.flush()
    await recompute_fountain_ranking(session, f.id)
    await session.refresh(f)
    assert f.rating_count == 1  # one distinct user
    assert abs(f.average_rating - 4.0) < 1e-9  # mean of 5 and 3
    assert f.ranking_score is not None
    assert f.last_rated_at is not None


async def test_recompute_clears_state_when_ratings_removed(session):
    from sqlalchemy import delete

    f, user = await _make_fountain(session)
    session.add(Rating(fountain_id=f.id, user_id=user.id, rating_type_id=1, stars=4))
    await session.flush()
    await recompute_fountain_ranking(session, f.id)
    await session.refresh(f)
    assert f.last_rated_at is not None

    await session.execute(delete(Rating).where(Rating.fountain_id == f.id))
    await session.flush()
    await recompute_fountain_ranking(session, f.id)
    await session.refresh(f)
    assert f.rating_count == 0
    assert f.average_rating is None
    assert f.ranking_score is None
    assert f.last_rated_at is None  # cleared, not stale
