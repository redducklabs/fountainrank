import uuid
from datetime import UTC, datetime

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import get_settings
from app.models import Fountain, Rating


async def recompute_fountain_ranking(session: AsyncSession, fountain_id: uuid.UUID) -> None:
    """Recompute and store a fountain's denormalized rating fields. The caller owns
    the transaction (commit happens upstream)."""
    vote_count, average = (
        await session.execute(
            select(
                func.count(func.distinct(Rating.user_id)),
                func.avg(Rating.stars),
            ).where(Rating.fountain_id == fountain_id)
        )
    ).one()
    vote_count = int(vote_count or 0)
    average = float(average) if average is not None else None

    # Global mean rating C across all rating rows (IMDb-style weighted average).
    global_mean = (await session.execute(select(func.avg(Rating.stars)))).scalar()
    global_mean = float(global_mean) if global_mean is not None else None

    m = get_settings().ranking_confidence_m
    if average is None or global_mean is None or vote_count == 0:
        ranking_score = None
    else:
        v = vote_count
        ranking_score = (v / (v + m)) * average + (m / (v + m)) * global_mean

    fountain = (
        await session.execute(select(Fountain).where(Fountain.id == fountain_id))
    ).scalar_one()
    fountain.rating_count = vote_count
    fountain.average_rating = average
    fountain.ranking_score = ranking_score
    if vote_count > 0:
        fountain.last_rated_at = datetime.now(tz=UTC)
    else:
        # Make the no-ratings state complete + deterministic (e.g. after a rating is
        # retracted or denormalized state is repaired): clear the stale timestamp too.
        fountain.last_rated_at = None
    # Flush so callers can safely session.refresh() the fountain within the same
    # transaction and see the updated denormalized fields before commit.
    await session.flush()
