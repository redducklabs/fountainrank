import uuid
from datetime import datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field

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
    ratings: list[RatingInput] = Field(default_factory=list)


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
