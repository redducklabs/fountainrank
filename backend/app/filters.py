"""Discovery filters for the nearby/bbox fountain endpoints (#43, spec §9).

A shared dependency parses the query params; ``apply_discovery_filters`` adds every
predicate to the ``WHERE`` clause (the caller applies ORDER BY / LIMIT AFTERWARD, so a
cap can never drop a matching row). Attribute filters use the denormalized
``fountain_attribute_consensus`` (ties/`mixed` have ``consensus_value IS NULL`` and never
match a positive filter); ``include_unknown`` widens them to "not definitively otherwise".
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import UTC, datetime, timedelta

from fastapi import Query
from sqlalchemy import Select, exists, not_, select

from app.models import AttributeType, Fountain, FountainAttributeConsensus

# filter param -> (attribute key, target consensus value)
ATTRIBUTE_FILTERS: dict[str, tuple[str, str]] = {
    "bottle_filler": ("bottle_filler", "yes"),
    "wheelchair_reachable": ("wheelchair_reachable", "yes"),
    "dual_height": ("dual_height", "yes"),
    "indoor": ("indoor_outdoor", "indoor"),
    "public_access": ("access_kind", "public"),
}


@dataclass(frozen=True)
class DiscoveryFilters:
    working_now: bool = False
    verified_within_days: int | None = None
    bottle_filler: bool = False
    wheelchair_reachable: bool = False
    dual_height: bool = False
    indoor: bool = False
    public_access: bool = False
    min_rating: float | None = None
    min_rating_count: int | None = None
    include_unknown: bool = False


def discovery_filters(
    working_now: bool = Query(default=False),
    verified_within_days: int | None = Query(default=None, gt=0),
    bottle_filler: bool = Query(default=False),
    wheelchair_reachable: bool = Query(default=False),
    dual_height: bool = Query(default=False),
    indoor: bool = Query(default=False),
    public_access: bool = Query(default=False),
    min_rating: float | None = Query(default=None, ge=1.0, le=5.0),
    min_rating_count: int | None = Query(default=None, ge=0),
    include_unknown: bool = Query(default=False),
) -> DiscoveryFilters:
    return DiscoveryFilters(
        working_now=working_now,
        verified_within_days=verified_within_days,
        bottle_filler=bottle_filler,
        wheelchair_reachable=wheelchair_reachable,
        dual_height=dual_height,
        indoor=indoor,
        public_access=public_access,
        min_rating=min_rating,
        min_rating_count=min_rating_count,
        include_unknown=include_unknown,
    )


def _consensus_base(key: str):
    # Correlated to the outer Fountain; scoped to the fountain-place, active definition.
    return (
        select(1)
        .select_from(FountainAttributeConsensus)
        .join(AttributeType, AttributeType.id == FountainAttributeConsensus.attribute_type_id)
        .where(
            FountainAttributeConsensus.fountain_id == Fountain.id,
            AttributeType.key == key,
            AttributeType.place_type == "fountain",
            AttributeType.is_active.is_(True),
        )
    )


def _attr_match(key: str, value: str, include_unknown: bool):
    has_value = exists(
        _consensus_base(key).where(FountainAttributeConsensus.consensus_value == value)
    )
    if not include_unknown:
        return has_value
    # Widen: include fountains NOT definitively known to be something else (no row, tie/mixed
    # with NULL consensus, or confidence=none) — but still exclude a definite contradicting value.
    no_definite = not_(
        exists(_consensus_base(key).where(FountainAttributeConsensus.consensus_value.is_not(None)))
    )
    return has_value | no_definite


def apply_discovery_filters(
    stmt: Select, f: DiscoveryFilters, *, now: datetime | None = None
) -> Select:
    now = now or datetime.now(tz=UTC)
    if f.working_now:
        stmt = stmt.where(
            (Fountain.current_status == "ok")
            | (Fountain.current_status.is_(None) & Fountain.is_working.is_(True))
        )
    if f.verified_within_days is not None:
        stmt = stmt.where(Fountain.last_verified_at >= now - timedelta(days=f.verified_within_days))
    if f.min_rating is not None:
        stmt = stmt.where(Fountain.average_rating >= f.min_rating)
    if f.min_rating_count is not None:
        stmt = stmt.where(Fountain.rating_count >= f.min_rating_count)
    for param, (key, value) in ATTRIBUTE_FILTERS.items():
        if getattr(f, param):
            stmt = stmt.where(_attr_match(key, value, f.include_unknown))
    return stmt
