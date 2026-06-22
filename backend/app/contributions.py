"""Single chokepoint for emitting contribution events + maintaining user stats.

Every point-worthy contribution (add fountain, rate, observe attribute, the
first-X bonuses) flows through ``record_contributions``. The ``dedup_key`` unique
index makes inserts idempotent AND doubles as the "first-ever" detector: a bonus
event is emitted by attempting an insert with a fixed key; only the first attempt
wins (``ON CONFLICT DO NOTHING``). ``user_contribution_stats`` is incremented only
for events that were actually inserted, in the same transaction (the caller owns
the commit), so points can never diverge from the event log.
"""

from __future__ import annotations

import logging
import uuid
from dataclasses import dataclass

from sqlalchemy import func
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import ContributionEvent, UserContributionStats

logger = logging.getLogger(__name__)

# Default point values (spec §8); tunable. Later slices add verify_working /
# report_condition / add_note / confirmation_bonus.
POINTS: dict[str, int] = {
    "add_fountain": 10,
    "first_fountain_bonus": 5,
    "first_in_area_bonus": 15,
    "rate": 2,
    "first_rating_bonus": 5,
    "observe_attribute": 2,
}

# Allowed target_type per event_type (None = a pure bonus event with no source row).
# target_type is security-relevant (drives future moderation reversal), so the single
# writer constrains it. Grows as later slices add event/target kinds.
EVENT_TARGET_TYPES: dict[str, set[str | None]] = {
    "add_fountain": {"fountain"},
    "first_fountain_bonus": {None},
    "first_in_area_bonus": {None},
    "rate": {"rating"},
    "first_rating_bonus": {None},
    "observe_attribute": {"attribute_observation"},
}

# Which user_contribution_stats counter each event_type increments (besides total_points).
_STAT_COUNTER: dict[str, str] = {
    "add_fountain": "fountains_added",
    "rate": "ratings_count",
    "observe_attribute": "attributes_count",
}


def points_for(event_type: str) -> int:
    try:
        return POINTS[event_type]
    except KeyError:
        raise ValueError(f"unknown contribution event_type: {event_type!r}") from None


@dataclass
class ContributionSpec:
    user_id: uuid.UUID
    event_type: str
    dedup_key: str
    fountain_id: uuid.UUID | None = None
    location: object | None = None  # geography WKBElement, copied from the fountain
    target_type: str | None = None
    target_id: uuid.UUID | None = None
    event_metadata: dict | None = None
    parent_event_id: uuid.UUID | None = None


# --- dedup-key builders (spec §8) -------------------------------------------------
def dk_add_fountain(fountain_id: uuid.UUID) -> str:
    return f"add_fountain:{fountain_id}"


def dk_first_fountain(user_id: uuid.UUID) -> str:
    return f"first_fountain:{user_id}"


def dk_first_in_area(fountain_id: uuid.UUID) -> str:
    # Per-fountain key; the spatial "no other fountain within radius" precheck at the call
    # site is the actual gate (so imported fountains correctly occupy an area).
    return f"first_in_area:{fountain_id}"


def dk_rate(user_id: uuid.UUID, fountain_id: uuid.UUID, rating_type_id: int) -> str:
    return f"rate:{user_id}:{fountain_id}:{rating_type_id}"


def dk_first_rating(fountain_id: uuid.UUID) -> str:
    return f"first_rating:{fountain_id}"


def dk_observe_attr(user_id: uuid.UUID, fountain_id: uuid.UUID, attribute_type_id: int) -> str:
    return f"attr:{user_id}:{fountain_id}:{attribute_type_id}"


def _validate(spec: ContributionSpec) -> None:
    points_for(spec.event_type)  # raises ValueError on unknown event_type
    allowed = EVENT_TARGET_TYPES[spec.event_type]
    if spec.target_type not in allowed:
        raise ValueError(
            f"illegal target_type {spec.target_type!r} for event_type {spec.event_type!r}"
        )


async def record_contributions(
    session: AsyncSession, specs: list[ContributionSpec]
) -> list[uuid.UUID]:
    """Idempotently record contribution events and increment per-user stats.

    Returns the ids of events that were actually inserted (deduped specs are dropped).
    Caller owns the transaction.
    """
    if not specs:
        return []
    for spec in specs:
        _validate(spec)

    inserted: list = []
    for spec in specs:
        stmt = (
            pg_insert(ContributionEvent)
            .values(
                id=uuid.uuid4(),
                user_id=spec.user_id,
                fountain_id=spec.fountain_id,
                target_type=spec.target_type,
                target_id=spec.target_id,
                event_type=spec.event_type,
                points=points_for(spec.event_type),
                location=spec.location,
                dedup_key=spec.dedup_key,
                event_metadata=spec.event_metadata,
                parent_event_id=spec.parent_event_id,
            )
            .on_conflict_do_nothing(index_elements=["dedup_key"])
            .returning(
                ContributionEvent.id,
                ContributionEvent.user_id,
                ContributionEvent.event_type,
                ContributionEvent.points,
            )
        )
        row = (await session.execute(stmt)).first()
        if row is not None:
            inserted.append(row)

    # Aggregate increments per user (a batch may span users).
    per_user: dict[uuid.UUID, dict[str, int]] = {}
    for row in inserted:
        agg = per_user.setdefault(row.user_id, {"total_points": 0})
        agg["total_points"] += row.points
        counter = _STAT_COUNTER.get(row.event_type)
        if counter:
            agg[counter] = agg.get(counter, 0) + 1

    for user_id, agg in per_user.items():
        ins = pg_insert(UserContributionStats).values(user_id=user_id, **agg)
        set_ = {
            col: UserContributionStats.__table__.c[col] + getattr(ins.excluded, col) for col in agg
        }
        set_["updated_at"] = func.now()
        await session.execute(ins.on_conflict_do_update(index_elements=["user_id"], set_=set_))

    logger.info(
        "contribution_events recorded inserted=%d deduped=%d",
        len(inserted),
        len(specs) - len(inserted),
    )
    return [row.id for row in inserted]
