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
from datetime import datetime, timedelta

from sqlalchemy import func, select, update
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import AttributeType, ContributionEvent, RatingType, UserContributionStats
from app.schemas import ViewerAwardState

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
    "verify_working": 3,
    "report_condition": 2,
    "add_note": 2,
    "photo_first": 5,
}

# The two coalesced condition event types the 24h point window (#124) covers.
CONDITION_EVENT_TYPES: tuple[str, str] = ("verify_working", "report_condition")
CONDITION_POINT_WINDOW = timedelta(hours=24)

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
    "verify_working": {"condition_report"},
    "report_condition": {"condition_report"},
    "add_note": {"note"},
    "photo_first": {"photo"},
}

# Which user_contribution_stats counter each event_type increments (besides total_points).
_STAT_COUNTER: dict[str, str] = {
    "add_fountain": "fountains_added",
    "rate": "ratings_count",
    "observe_attribute": "attributes_count",
    "verify_working": "verifications_count",
    "report_condition": "conditions_reported",
    "add_note": "notes_count",
}


def points_for(event_type: str) -> int:
    try:
        return POINTS[event_type]
    except KeyError:
        raise ValueError(f"unknown contribution event_type: {event_type!r}") from None


def condition_points_eligible_at(
    last_awarded_at: datetime | None, now: datetime
) -> datetime | None:
    """Given the user's most recent AWARDED condition-event time for a fountain and the
    current instant, return when they become eligible to earn condition points again — or
    None if they are eligible now. A prior award at exactly now - 24h is eligible (#124)."""
    if last_awarded_at is None:
        return None
    eligible_at = last_awarded_at + CONDITION_POINT_WINDOW
    return eligible_at if eligible_at > now else None


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
    # Optional authoritative timestamp. When set, record_contributions writes it to
    # ContributionEvent.created_at instead of the DB server_default — so the condition
    # point-window gate (#124) compares one clock (report_time), not insert-time skew.
    created_at: datetime | None = None


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


def dk_condition_award(report_id: uuid.UUID) -> str:
    # Per-report key: the rolling-24h query (#124) is the real limiter, so this only guards
    # exact double-processing of one report row (ON CONFLICT DO NOTHING).
    return f"cond_award:{report_id}"


def dk_note(user_id: uuid.UUID, fountain_id: uuid.UUID) -> str:
    return f"note:{user_id}:{fountain_id}"


def dk_photo_first(fountain_id: uuid.UUID) -> str:
    return f"photo_first:{fountain_id}"


def _validate(spec: ContributionSpec) -> None:
    points_for(spec.event_type)  # raises ValueError on unknown event_type
    allowed = EVENT_TARGET_TYPES[spec.event_type]
    if spec.target_type not in allowed:
        raise ValueError(
            f"illegal target_type {spec.target_type!r} for event_type {spec.event_type!r}"
        )


async def latest_awarded_condition_at(
    session: AsyncSession, user_id: uuid.UUID, fountain_id: uuid.UUID
) -> datetime | None:
    """Most recent AWARDED condition event created_at for (user, fountain), or None.
    Matches on event_type + status (NOT dedup_key), so legacy calendar-day rows count."""
    return (
        await session.execute(
            select(ContributionEvent.created_at)
            .where(
                ContributionEvent.user_id == user_id,
                ContributionEvent.fountain_id == fountain_id,
                ContributionEvent.event_type.in_(CONDITION_EVENT_TYPES),
                ContributionEvent.status == "awarded",
            )
            .order_by(ContributionEvent.created_at.desc())
            .limit(1)
        )
    ).scalar_one_or_none()


async def viewer_award_state(
    session: AsyncSession, user_id: uuid.UUID, fountain_id: uuid.UUID
) -> ViewerAwardState:
    """What `user_id` can still earn on `fountain_id`, per the dedup ledger (#204).

    Derived from `contribution_events.dedup_key`, NOT from content rows: the dedup key is
    permanent but content is not. A hidden note, a hidden attribute observation, or a deleted
    first photo all leave the key spent while the content disappears — so a content-derived
    preview promises points the insert will not award.

    Candidates come from the TYPE REGISTRIES, not from the fountain's existing content: a user can
    observe an attribute that has no consensus row yet, so building candidates from the detail
    response's `attributes` list would silently drop the attributes most likely to be earnable.
    NOTE: RatingType has no `is_active` flag (only place_type/sort_order) — do not filter on one.
    """
    rating_type_ids = list(
        (await session.execute(select(RatingType.id).where(RatingType.place_type == "fountain")))
        .scalars()
        .all()
    )
    attribute_type_ids = list(
        (
            await session.execute(
                select(AttributeType.id).where(
                    AttributeType.is_active.is_(True), AttributeType.place_type == "fountain"
                )
            )
        )
        .scalars()
        .all()
    )

    rate_keys = {dk_rate(user_id, fountain_id, rid): rid for rid in rating_type_ids}
    attr_keys = {dk_observe_attr(user_id, fountain_id, aid): aid for aid in attribute_type_ids}
    note_key = dk_note(user_id, fountain_id)
    photo_key = dk_photo_first(fountain_id)

    # ONE index scan on uq_contribution_events_dedup_key. Anything returned is already awarded;
    # anything absent is still earnable. (The two registry SELECTs above are separate and cheap —
    # do not try to fold them in here.)
    spent = set(
        (
            await session.execute(
                select(ContributionEvent.dedup_key).where(
                    ContributionEvent.dedup_key.in_([*rate_keys, *attr_keys, note_key, photo_key])
                )
            )
        )
        .scalars()
        .all()
    )

    return ViewerAwardState(
        unrated_rating_type_ids=[rid for key, rid in rate_keys.items() if key not in spent],
        unobserved_attribute_type_ids=[aid for key, aid in attr_keys.items() if key not in spent],
        note_earnable=note_key not in spent,
        photo_first_earnable=photo_key not in spent,
    )


@dataclass(frozen=True)
class ContributionResult:
    """What `record_contributions` actually inserted (#204).

    `points_by_user` is summed from the same RETURNING rows that drive the
    `user_contribution_stats` increment, so the number reported back to a user and the number
    added to their total are computed from one set of rows and cannot diverge.
    """

    event_ids: list[uuid.UUID]
    points_by_user: dict[uuid.UUID, int]

    def points_for(self, user_id: uuid.UUID) -> int:
        """Points credited to THIS user. Never the batch total — a batch may span users, and
        handing one actor another actor's points would be a real leak."""
        return self.points_by_user.get(user_id, 0)

    def __bool__(self) -> bool:
        # Mirrors the old list-return truthiness so any missed `if inserted:` call site keeps its
        # original meaning instead of silently becoming always-true.
        return bool(self.event_ids)


async def record_contributions(
    session: AsyncSession, specs: list[ContributionSpec]
) -> ContributionResult:
    """Idempotently record contribution events and increment per-user stats.

    Returns the ids of events actually inserted (deduped specs are dropped) and the points
    credited per user. Caller owns the transaction.
    """
    if not specs:
        return ContributionResult(event_ids=[], points_by_user={})
    for spec in specs:
        _validate(spec)

    inserted: list = []
    for spec in specs:
        values = dict(
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
        if spec.created_at is not None:
            values["created_at"] = spec.created_at
        stmt = (
            pg_insert(ContributionEvent)
            .values(**values)
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
        "contribution_events recorded inserted=%d deduped=%d points=%d",
        len(inserted),
        len(specs) - len(inserted),
        sum(row.points for row in inserted),
    )
    return ContributionResult(
        event_ids=[row.id for row in inserted],
        points_by_user={user_id: agg["total_points"] for user_id, agg in per_user.items()},
    )


async def reverse_contributions(session: AsyncSession, fountain_id: uuid.UUID) -> int:
    """Reverse every still-awarded contribution event tied to a fountain and decrement the
    affected users' denormalized stats — the inverse of ``record_contributions`` (#119).

    When a fountain is hard-deleted (admin moderation), points earned for content that has
    been removed must not persist, or the leaderboard rewards point-farming. Covers EVERY
    contributing user tied to the fountain (creator + raters/observers/verifiers/note authors),
    not just the creator, and every event_type (incl. the first-X bonus events, which also
    carry ``fountain_id``).

    Idempotent: only ``status='awarded'`` rows are flipped to ``reversed`` (the audit row
    survives), so a re-run or a double-delete is a no-op. Counters are clamped at 0 so any
    pre-existing inconsistency can't drive one negative. Caller owns the transaction.

    MUST run BEFORE the fountain row is deleted: ``contribution_events.fountain_id`` is
    ``ON DELETE SET NULL``, so once the fountain is gone the events can no longer be found by
    ``fountain_id``.

    Returns the number of events reversed.
    """
    reversed_rows = (
        await session.execute(
            update(ContributionEvent)
            .where(
                ContributionEvent.fountain_id == fountain_id,
                ContributionEvent.status == "awarded",
            )
            .values(status="reversed")
            .returning(
                ContributionEvent.user_id,
                ContributionEvent.event_type,
                ContributionEvent.points,
            )
        )
    ).all()

    if not reversed_rows:
        logger.info("contribution reversal no-op fountain_id=%s events=0", fountain_id)
        return 0

    # Aggregate the per-user decrements (a fountain's events span many users).
    per_user: dict[uuid.UUID, dict[str, int]] = {}
    for row in reversed_rows:
        agg = per_user.setdefault(row.user_id, {"total_points": 0})
        agg["total_points"] += row.points
        counter = _STAT_COUNTER.get(row.event_type)
        if counter:
            agg[counter] = agg.get(counter, 0) + 1

    for user_id, agg in per_user.items():
        set_ = {
            col: func.greatest(UserContributionStats.__table__.c[col] - delta, 0)
            for col, delta in agg.items()
        }
        set_["updated_at"] = func.now()
        await session.execute(
            update(UserContributionStats)
            .where(UserContributionStats.user_id == user_id)
            .values(**set_)
        )

    logger.info(
        "contribution reversal fountain_id=%s events=%d users=%d",
        fountain_id,
        len(reversed_rows),
        len(per_user),
    )
    return len(reversed_rows)


async def _adjust_target(
    session: AsyncSession,
    target_type: str,
    target_id: uuid.UUID,
    from_status: str,
    to_status: str,
    sign: int,
) -> int:
    """Flip contribution_events matching (target_type, target_id, from_status) to
    ``to_status`` and apply the signed point/counter delta to the affected users' stats.

    Scoped by target (not fountain_id), so e.g. hiding one photo does not touch any other
    photo's or contribution's events on the same fountain. Idempotent by construction: the
    ``status == from_status`` predicate means a repeat call matches zero rows (returns 0),
    so callers can safely re-run a hide/unhide without double-adjusting stats.
    """
    rows = (
        await session.execute(
            update(ContributionEvent)
            .where(
                ContributionEvent.target_type == target_type,
                ContributionEvent.target_id == target_id,
                ContributionEvent.status == from_status,
            )
            .values(status=to_status)
            .returning(
                ContributionEvent.user_id,
                ContributionEvent.event_type,
                ContributionEvent.points,
            )
        )
    ).all()

    if not rows:
        logger.info(
            "contribution target adjustment no-op target_type=%s target_id=%s "
            "from_status=%s to_status=%s",
            target_type,
            target_id,
            from_status,
            to_status,
        )
        return 0

    for row in rows:
        col_delta = {"total_points": sign * row.points}
        counter = _STAT_COUNTER.get(row.event_type)
        if counter:
            col_delta[counter] = sign * 1
        set_ = {
            col: func.greatest(UserContributionStats.__table__.c[col] + delta, 0)
            for col, delta in col_delta.items()
        }
        set_["updated_at"] = func.now()
        await session.execute(
            update(UserContributionStats)
            .where(UserContributionStats.user_id == row.user_id)
            .values(**set_)
        )

    logger.info(
        "contribution target adjustment target_type=%s target_id=%s "
        "from_status=%s to_status=%s events=%d",
        target_type,
        target_id,
        from_status,
        to_status,
        len(rows),
    )
    return len(rows)


async def reverse_contribution_for_target(
    session: AsyncSession, target_type: str, target_id: uuid.UUID
) -> int:
    """Reverse the still-awarded contribution event(s) tied to a single target (e.g. a photo
    being hidden/deleted), without affecting any other contribution on the same fountain.
    Returns the number of events reversed.
    """
    return await _adjust_target(session, target_type, target_id, "awarded", "reversed", -1)


async def reactivate_contribution_for_target(
    session: AsyncSession, target_type: str, target_id: uuid.UUID
) -> int:
    """Re-award a previously reversed contribution event tied to a single target (e.g. a
    hidden photo being restored) — the inverse of ``reverse_contribution_for_target``.
    Returns the number of events reactivated.
    """
    return await _adjust_target(session, target_type, target_id, "reversed", "awarded", 1)
