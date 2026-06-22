"""Attribute consensus derivation + denormalized recompute (#38).

``derive_consensus`` is pure (unit-tested in isolation). ``recompute_attribute_consensus``
reads the non-hidden observations for one (fountain, attribute_type) and upserts the
denormalized ``fountain_attribute_consensus`` row — called from the write path AND the
moderation path (hide/unhide), so the public aggregate never reflects a hidden row.

Consensus rule (spec §6.3): ties never set a filterable winner — a tie yields
``consensus_value=None`` with ``confidence='mixed'``; the most-recent non-unknown value is
preserved separately in ``latest_observation_value`` for UI only (never used by filters).
"""

from __future__ import annotations

import logging
import uuid
from dataclasses import dataclass
from datetime import datetime

from sqlalchemy import select
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import AttributeObservation, AttributeType, FountainAttributeConsensus

logger = logging.getLogger(__name__)

UNKNOWN = "unknown"
MIN_HIGH_COUNT = 3
HIGH_RATIO = 0.75
MED_MIN_COUNT = 2
MED_RATIO = 0.6


@dataclass(frozen=True)
class ConsensusResult:
    consensus_value: str | None
    confidence: str
    yes_count: int
    no_count: int
    unknown_count: int
    value_counts: dict[str, int] | None
    observation_count: int
    latest_observation_value: str | None


def _confidence(winner_count: int, known_total: int) -> str:
    ratio = (winner_count / known_total) if known_total else 0.0
    if winner_count >= MIN_HIGH_COUNT and ratio >= HIGH_RATIO:
        return "high"
    if winner_count >= MED_MIN_COUNT and ratio >= MED_RATIO:
        return "medium"
    return "low"


def derive_consensus(value_kind: str, observations: list[tuple[str, datetime]]) -> ConsensusResult:
    """Derive consensus from non-hidden ``(value, created_at)`` observations."""
    total = len(observations)
    known = [(v, t) for (v, t) in observations if v != UNKNOWN]
    unknown_count = total - len(known)
    latest = max(known, key=lambda vt: vt[1])[0] if known else None

    if value_kind == "boolean":
        yes = sum(1 for (v, _) in known if v == "yes")
        no = sum(1 for (v, _) in known if v == "no")
        known_total = yes + no
        if known_total == 0:
            return ConsensusResult(None, "none", yes, no, unknown_count, None, total, latest)
        if yes == no:  # tie -> not filterable
            return ConsensusResult(None, "mixed", yes, no, unknown_count, None, total, latest)
        winner = "yes" if yes > no else "no"
        return ConsensusResult(
            winner,
            _confidence(max(yes, no), known_total),
            yes,
            no,
            unknown_count,
            None,
            total,
            latest,
        )

    # enum
    counts: dict[str, int] = {}
    for v, _ in known:
        counts[v] = counts.get(v, 0) + 1
    known_total = len(known)
    if known_total == 0:
        return ConsensusResult(None, "none", 0, 0, unknown_count, None, total, latest)
    max_count = max(counts.values())
    winners = [v for v, c in counts.items() if c == max_count]
    if len(winners) > 1:  # plurality tie -> not filterable
        return ConsensusResult(None, "mixed", 0, 0, unknown_count, counts, total, latest)
    return ConsensusResult(
        winners[0], _confidence(max_count, known_total), 0, 0, unknown_count, counts, total, latest
    )


async def recompute_attribute_consensus(
    session: AsyncSession, fountain_id: uuid.UUID, attribute_type_id: int
) -> None:
    """Recompute and upsert the consensus row for one (fountain, attribute_type).

    Reads only non-hidden observations. Caller owns the transaction.
    """
    value_kind = (
        await session.execute(
            select(AttributeType.value_kind).where(AttributeType.id == attribute_type_id)
        )
    ).scalar_one()
    rows = (
        await session.execute(
            select(AttributeObservation.value, AttributeObservation.created_at).where(
                AttributeObservation.fountain_id == fountain_id,
                AttributeObservation.attribute_type_id == attribute_type_id,
                AttributeObservation.is_hidden.is_(False),
            )
        )
    ).all()
    result = derive_consensus(value_kind, [(r.value, r.created_at) for r in rows])
    last_observed_at = max((r.created_at for r in rows), default=None)

    ins = pg_insert(FountainAttributeConsensus).values(
        fountain_id=fountain_id,
        attribute_type_id=attribute_type_id,
        consensus_value=result.consensus_value,
        confidence=result.confidence,
        yes_count=result.yes_count,
        no_count=result.no_count,
        unknown_count=result.unknown_count,
        value_counts=result.value_counts,
        observation_count=result.observation_count,
        latest_observation_value=result.latest_observation_value,
        last_observed_at=last_observed_at,
    )
    update_cols = (
        "consensus_value",
        "confidence",
        "yes_count",
        "no_count",
        "unknown_count",
        "value_counts",
        "observation_count",
        "latest_observation_value",
        "last_observed_at",
    )
    await session.execute(
        ins.on_conflict_do_update(
            index_elements=["fountain_id", "attribute_type_id"],
            set_={c: getattr(ins.excluded, c) for c in update_cols},
        )
    )
    logger.debug(
        "consensus recomputed fountain=%s attr=%s value=%s confidence=%s obs=%d",
        fountain_id,
        attribute_type_id,
        result.consensus_value,
        result.confidence,
        result.observation_count,
    )
