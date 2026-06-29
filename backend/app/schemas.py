import uuid
from datetime import datetime
from typing import Annotated, Literal

from pydantic import (
    BaseModel,
    ConfigDict,
    Field,
    StringConstraints,
    field_validator,
    model_validator,
)

NoteBody = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=1000)]

ConditionStatus = Literal[
    "working",
    "broken",
    "low_pressure",
    "dirty",
    "bad_taste",
    "blocked",
    "seasonal_unavailable",
    "hours_limited",
]


class Coordinates(BaseModel):
    latitude: float = Field(ge=-90.0, le=90.0)
    longitude: float = Field(ge=-180.0, le=180.0)


class RatingInput(BaseModel):
    rating_type_id: int
    stars: int = Field(ge=1, le=5)


class RatingTypeOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    name: str
    description: str
    sort_order: int


class DimensionSummary(BaseModel):
    rating_type_id: int
    name: str
    average_rating: float | None
    vote_count: int
    # The requesting user's own stars for this dimension, when authenticated (#65);
    # None for anonymous callers and dimensions the user hasn't rated.
    your_rating: int | None = None


class AttributeTypeOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    key: str
    place_type: str
    category: str
    name: str
    description: str
    value_kind: str
    allowed_values: list[str] | None
    sort_order: int


class AttributeObservationInput(BaseModel):
    attribute_type_id: int
    value: str


class ObserveAttributesRequest(BaseModel):
    observations: list[AttributeObservationInput] = Field(min_length=1)


class AttributeConsensusOut(BaseModel):
    attribute_type_id: int
    key: str
    name: str
    category: str
    consensus_value: str | None
    confidence: str
    yes_count: int
    no_count: int
    unknown_count: int
    value_counts: dict[str, int] | None
    observation_count: int
    latest_observation_value: str | None


class FountainPin(BaseModel):
    id: uuid.UUID
    location: Coordinates
    is_working: bool
    average_rating: float | None
    rating_count: int
    ranking_score: float | None = None
    distance_m: float | None = None
    current_status: str | None = None
    last_verified_at: datetime | None = None


class FountainDetail(BaseModel):
    id: uuid.UUID
    location: Coordinates
    is_working: bool
    comments: str | None
    average_rating: float | None
    rating_count: int
    ranking_score: float | None
    created_at: datetime
    last_rated_at: datetime | None
    current_status: str | None = None
    last_verified_at: datetime | None = None
    placement_note: str | None = None
    dimensions: list[DimensionSummary]
    attributes: list[AttributeConsensusOut] = []


class ConditionReportRequest(BaseModel):
    status: ConditionStatus
    is_proximate: bool = False


class DuplicateFountainConflict(BaseModel):
    detail: str = "duplicate_fountain"
    fountain_id: uuid.UUID


class AddFountainRequest(BaseModel):
    location: Coordinates
    is_working: bool = True
    comments: str | None = None
    placement_note: str | None = Field(default=None, max_length=200)
    ratings: list[RatingInput] = Field(default_factory=list)
    observations: list[AttributeObservationInput] = Field(default_factory=list)

    @field_validator("placement_note", mode="before")
    @classmethod
    def _normalize_placement_note(cls, v: object) -> object:
        if isinstance(v, str):
            return v.strip() or None
        # Non-str (and non-None) falls through to type validation -> 422 (never .strip() it).
        return v


class RateRequest(BaseModel):
    ratings: list[RatingInput] = Field(min_length=1)


class MeResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    display_name: str
    email: str
    avatar_url: str | None
    is_admin: bool
    created_at: datetime


class SyncProfileRequest(BaseModel):
    userinfo_token: str = Field(min_length=1)


class ContributionStatsOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    total_points: int
    fountains_added: int
    ratings_count: int
    attributes_count: int
    conditions_reported: int
    verifications_count: int
    notes_count: int


class ContributionEventOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    event_type: str
    points: int
    fountain_id: uuid.UUID | None
    created_at: datetime


class MeContributionsOut(BaseModel):
    stats: ContributionStatsOut
    recent: list[ContributionEventOut]


class BadgeOut(BaseModel):
    key: str
    name: str
    description: str


class ContributorRow(BaseModel):
    display_name: str
    points: int
    # Populated for the global leaderboard; null for the local (in-area) leaderboard,
    # where these global counters would be misleading.
    fountains_added: int | None = None
    ratings_count: int | None = None


class AddNoteRequest(BaseModel):
    body: NoteBody


class NoteOut(BaseModel):
    id: uuid.UUID
    body: str
    author_display_name: str
    created_at: datetime
    updated_at: datetime


class AdminNoteOut(NoteOut):
    is_hidden: bool


class AdminNotePatch(BaseModel):
    is_hidden: bool


class AdminFountainPatch(BaseModel):
    location: Coordinates | None = None
    is_working: bool | None = None
    placement_note: str | None = None
    comments: str | None = None
    is_hidden: bool | None = None

    @model_validator(mode="after")
    def _reject_empty_patch(self) -> "AdminFountainPatch":
        if not self.model_fields_set:
            raise ValueError("patch must include at least one field")
        return self


class AdminFountainDetail(FountainDetail):
    is_hidden: bool
    notes: list[AdminNoteOut]
