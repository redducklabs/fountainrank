"""Derived contributor badges (#10 gamification §10).

Pure derivation from ``user_contribution_stats`` + a few ``contribution_events`` aggregates
(no badge table; computed on read). Thresholds are module constants. Per-dimension counts
must come from AWARDED rate events only (reversed/moderated events never count).
"""

from __future__ import annotations

from dataclasses import dataclass

FIELD_VERIFIER_MIN = 10
NOTE_TAKER_MIN = 5
ATTRIBUTE_ACE_MIN = 10
DIMENSION_TESTER_MIN = 10
ORIGINAL_N = 100


@dataclass(frozen=True)
class Badge:
    key: str
    name: str
    description: str


# rating_type_id -> per-dimension "tester" badge
_DIMENSION_BADGES: dict[int, Badge] = {
    1: Badge("clarity_critic", "Clarity Critic", "Rated clarity on 10+ fountains"),
    2: Badge("taste_tracker", "Taste Tracker", "Rated taste on 10+ fountains"),
    3: Badge("pressure_tester", "Pressure Tester", "Rated pressure on 10+ fountains"),
    4: Badge("appearance_appraiser", "Appearance Appraiser", "Rated appearance on 10+ fountains"),
}


def earned_badges(
    *, stats, created_rank: int | None, dimension_rate_counts: dict[int, int]
) -> list[Badge]:
    """Badges the user has earned. ``stats`` is any object with the user_contribution_stats
    integer counters; ``created_rank`` is the user's 1-based rank by (created_at, id)."""
    badges: list[Badge] = []
    if stats.fountains_added >= 1:
        badges.append(Badge("first_fountain", "First Fountain", "Added your first fountain"))
    if stats.ratings_count >= 1:
        badges.append(Badge("hydrated_helper", "Hydrated Helper", "Submitted your first rating"))
    if stats.verifications_count >= FIELD_VERIFIER_MIN:
        badges.append(Badge("field_verifier", "Field Verifier", "Verified 10+ fountains working"))
    if stats.conditions_reported >= 1:
        badges.append(Badge("fix_finder", "Fix Finder", "Reported a fountain issue"))
    if stats.notes_count >= NOTE_TAKER_MIN:
        badges.append(Badge("note_taker", "Note Taker", "Left 5+ helpful notes"))
    if stats.attributes_count >= ATTRIBUTE_ACE_MIN:
        badges.append(Badge("attribute_ace", "Attribute Ace", "Recorded 10+ fountain attributes"))
    if created_rank is not None and created_rank <= ORIGINAL_N:
        badges.append(Badge("original_100", "Original 100", "Among the first 100 contributors"))
    for rating_type_id, badge in _DIMENSION_BADGES.items():
        if dimension_rate_counts.get(rating_type_id, 0) >= DIMENSION_TESTER_MIN:
            badges.append(badge)
    return badges
