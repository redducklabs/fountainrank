"""Derived operational status from condition reports (#40).

``derive_status`` is pure (unit-tested). ``recompute_fountain_status`` reads the
non-hidden reports for one fountain and writes the denormalized
``current_status``/``last_verified_at`` — called from the write path AND any future
moderation hide/unhide (so the public status never reflects a hidden report).

Corroboration-timestamp model (spec §6.4): a category (ok / degraded / not_working)
is authoritative only with >= corroboration_min distinct users; the category whose
corroboration timestamp (the N-th most-recent of its distinct users' latest-in-category
reports) is greatest wins, tie-broken by severity. One actor can never flip the public
pin in either direction; a single uncorroborated issue is a non-flipping advisory.
"""

from __future__ import annotations

import logging
import uuid
from collections import defaultdict
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import get_settings
from app.models import ConditionReport, Fountain

logger = logging.getLogger(__name__)

# status -> derived category
_CATEGORY = {
    "working": "ok",
    "broken": "not_working",
    "blocked": "not_working",
    "low_pressure": "degraded",
    "dirty": "degraded",
    "bad_taste": "degraded",
    "seasonal_unavailable": "degraded",
    "hours_limited": "degraded",
}
_SEVERITY = {"ok": 1, "degraded": 2, "not_working": 3}


@dataclass(frozen=True)
class StatusResult:
    current_status: str | None
    last_verified_at: datetime | None


def derive_status(
    reports: list[tuple[str, uuid.UUID, datetime]],
    *,
    now: datetime,
    freshness_days: int,
    corroboration_min: int,
) -> StatusResult:
    """Derive ``(current_status, last_verified_at)`` from non-hidden reports.

    ``reports`` items are ``(status, user_id, created_at)``.
    """
    last_verified_at = max(
        (ts for (status, _u, ts) in reports if status == "working"), default=None
    )
    window_start = now - timedelta(days=freshness_days)
    in_window = [(s, u, ts) for (s, u, ts) in reports if ts >= window_start]
    if not in_window:
        return StatusResult(None, last_verified_at)

    # Per category: each distinct user's most-recent report in THAT category (evidence is
    # report-level, so a recanted broken still counts toward not_working corroboration).
    per_cat_user: dict[str, dict[uuid.UUID, datetime]] = defaultdict(dict)
    # Latest-overall per user — only for the advisory branch (current opinions).
    latest_overall: dict[uuid.UUID, tuple[datetime, str]] = {}
    for status, user_id, ts in in_window:
        cat = _CATEGORY[status]
        if user_id not in per_cat_user[cat] or ts > per_cat_user[cat][user_id]:
            per_cat_user[cat][user_id] = ts
        if user_id not in latest_overall or ts > latest_overall[user_id][0]:
            latest_overall[user_id] = (ts, cat)

    corroborated: dict[str, datetime] = {}
    for cat, user_ts in per_cat_user.items():
        if len(user_ts) >= corroboration_min:
            ts_desc = sorted(user_ts.values(), reverse=True)
            corroborated[cat] = ts_desc[corroboration_min - 1]  # N-th most recent

    if corroborated:
        current = max(corroborated, key=lambda c: (corroborated[c], _SEVERITY[c]))
        return StatusResult(current, last_verified_at)

    has_issue = any(cat in ("not_working", "degraded") for (_ts, cat) in latest_overall.values())
    return StatusResult("reported_issue" if has_issue else None, last_verified_at)


async def recompute_fountain_status(
    session: AsyncSession, fountain_id: uuid.UUID, *, now: datetime | None = None
) -> None:
    """Recompute and store a fountain's derived status. Caller owns the transaction."""
    now = now or datetime.now(tz=UTC)
    settings = get_settings()
    rows = (
        await session.execute(
            select(
                ConditionReport.status, ConditionReport.user_id, ConditionReport.created_at
            ).where(
                ConditionReport.fountain_id == fountain_id,
                ConditionReport.is_hidden.is_(False),
            )
        )
    ).all()
    result = derive_status(
        [(r.status, r.user_id, r.created_at) for r in rows],
        now=now,
        freshness_days=settings.condition_freshness_days,
        corroboration_min=settings.condition_corroboration_min,
    )
    fountain = (
        await session.execute(select(Fountain).where(Fountain.id == fountain_id))
    ).scalar_one()
    prev = fountain.current_status
    fountain.current_status = result.current_status
    fountain.last_verified_at = result.last_verified_at
    await session.flush()
    logger.debug(
        "status recomputed fountain=%s %s->%s last_verified=%s",
        fountain_id,
        prev,
        result.current_status,
        result.last_verified_at,
    )
