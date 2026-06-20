import uuid
from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field


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


class FountainPin(BaseModel):
    id: uuid.UUID
    location: Coordinates
    is_working: bool
    average_rating: float | None
    rating_count: int
    distance_m: float | None = None


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
    dimensions: list[DimensionSummary]


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
