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

# Public contribution payload ceilings are deliberately higher than today's active catalog
# cardinalities (4 rating dimensions and a small attribute set) so catalog growth does not require
# a client release, while still bounding JSON validation and database work per request.
COMMENTS_MAX_LENGTH = 1000
RATINGS_MAX_ITEMS = 32
OBSERVATIONS_MAX_ITEMS = 128
CommentBody = Annotated[str, StringConstraints(max_length=COMMENTS_MAX_LENGTH)]


def _normalize_optional_text(value: object) -> object:
    """Trim optional user-authored text and store whitespace-only input as null."""
    if isinstance(value, str):
        return value.strip() or None
    return value


def _has_duplicate_ids(items: list[object], attribute: str) -> bool:
    ids = [getattr(item, attribute) for item in items]
    return len(ids) != len(set(ids))


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


class ViewerAwardState(BaseModel):
    """What this viewer can still EARN on this fountain, per the contribution dedup ledger (#204).

    The AWARD state, not the content state. Hidden notes/observations and deleted photos keep their
    dedup key, so a content-derived preview would over-promise points the insert will not award.
    Derived from `contribution_events.dedup_key` — the same question the insert asks.

    An as-of-read HINT: the key can be spent between this GET and the submit (another tab/device, or
    another user taking the fountain's first photo), so the POST's `points_awarded` is authoritative
    and always wins. Null for anonymous callers.

    `condition_points_eligible_at` is deliberately NOT here — it stays top-level on FountainDetail,
    where already-released clients read it.
    """

    unrated_rating_type_ids: list[int]
    unobserved_attribute_type_ids: list[int]
    note_earnable: bool
    photo_first_earnable: bool


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
    observations: list[AttributeObservationInput] = Field(
        min_length=1, max_length=OBSERVATIONS_MAX_ITEMS
    )

    @model_validator(mode="after")
    def _reject_duplicate_attribute_types(self) -> "ObserveAttributesRequest":
        if _has_duplicate_ids(self.observations, "attribute_type_id"):
            raise ValueError("observations must contain unique attribute_type_id values")
        return self


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
    # #124 repeat-contribution point limit. Both additive + nullable (no response-shape break):
    # eligibility is a per-viewer pre-submit HINT for the warning (null = eligible now / anon);
    # awarded is set only on the condition POST (3/2/0), null on GET and other responses.
    condition_points_eligible_at: datetime | None = None
    condition_points_awarded: int | None = None
    # #204 server-authoritative awards. Additive + nullable (no response-shape break).
    # `points_awarded` = what this WRITE actually awarded the caller (0 when everything deduped);
    # null on GET and every other response. CANONICAL — `condition_points_awarded` above is
    # deprecated compatibility for already-released mobile clients and must not be the primary
    # path in new code. `viewer_award_state` is the pre-submit hint; null for anonymous callers.
    points_awarded: int | None = None
    viewer_award_state: ViewerAwardState | None = None


class ConditionReportRequest(BaseModel):
    status: ConditionStatus
    # DEPRECATED (spec §4.5): proximity is now server-computed. Kept for backward compatibility —
    # false/null accepted (both first-party clients historically send false); true is rejected
    # in the handler (not here) so the 422 detail is the exact string the test asserts.
    # Marked deprecated in the OpenAPI schema via json_schema_extra (not Pydantic's deprecated=True,
    # which emits a runtime DeprecationWarning on every server-side read of the field).
    is_proximate: bool | None = Field(default=None, json_schema_extra={"deprecated": True})
    latitude: float | None = Field(default=None, ge=-90.0, le=90.0)
    longitude: float | None = Field(default=None, ge=-180.0, le=180.0)

    @model_validator(mode="after")
    def _coords_both_or_neither(self) -> "ConditionReportRequest":
        if (self.latitude is None) != (self.longitude is None):
            raise ValueError("latitude and longitude must be supplied together")
        return self


class DuplicateFountainConflict(BaseModel):
    detail: str = "duplicate_fountain"
    fountain_id: uuid.UUID


class DisplayNameRequiredConflict(BaseModel):
    """409 body for a contribution-write by an account that still resolves to "Anonymous"
    (no nickname and display_name == subject). The client routes the user to set a name."""

    detail: Literal["display_name_required"] = "display_name_required"


class AddFountainRequest(BaseModel):
    location: Coordinates
    is_working: bool = True
    comments: CommentBody | None = None
    placement_note: str | None = Field(default=None, max_length=200)
    ratings: list[RatingInput] = Field(default_factory=list, max_length=RATINGS_MAX_ITEMS)
    observations: list[AttributeObservationInput] = Field(
        default_factory=list, max_length=OBSERVATIONS_MAX_ITEMS
    )

    @field_validator("comments", "placement_note", mode="before")
    @classmethod
    def _normalize_optional_text_fields(cls, v: object) -> object:
        # Non-str (and non-None) falls through to type validation -> 422.
        return _normalize_optional_text(v)

    @model_validator(mode="after")
    def _reject_duplicate_inline_ids(self) -> "AddFountainRequest":
        if _has_duplicate_ids(self.ratings, "rating_type_id"):
            raise ValueError("ratings must contain unique rating_type_id values")
        if _has_duplicate_ids(self.observations, "attribute_type_id"):
            raise ValueError("observations must contain unique attribute_type_id values")
        return self


class RateRequest(BaseModel):
    ratings: list[RatingInput] = Field(min_length=1, max_length=RATINGS_MAX_ITEMS)
    # Optional client-asserted location for the proximity guard (spec §4.5). Both-or-neither.
    latitude: float | None = Field(default=None, ge=-90.0, le=90.0)
    longitude: float | None = Field(default=None, ge=-180.0, le=180.0)

    @model_validator(mode="after")
    def _coords_both_or_neither(self) -> "RateRequest":
        if (self.latitude is None) != (self.longitude is None):
            raise ValueError("latitude and longitude must be supplied together")
        if _has_duplicate_ids(self.ratings, "rating_type_id"):
            raise ValueError("ratings must contain unique rating_type_id values")
        return self


class MeResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    display_name: str
    email: str
    avatar_url: str | None
    is_admin: bool
    created_at: datetime
    # True when the account still resolves to "Anonymous" (no nickname and display_name == subject);
    # drives the client name-capture gate. When true, display_name is "" (never the raw subject).
    needs_name: bool = False


class SyncProfileRequest(BaseModel):
    userinfo_token: str = Field(min_length=1)


class UpdateMeRequest(BaseModel):
    # The API speaks "display_name"; it is persisted to the internal `nickname` column (which
    # overrides the IdP-synced display_name while keeping it intact as the fallback). Max 80 so the
    # account screen can pre-fill and re-save an existing long IdP name unchanged.
    display_name: Annotated[
        str, StringConstraints(strip_whitespace=True, min_length=1, max_length=80)
    ]


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


class MyFountainsOut(BaseModel):
    """Fountains the authenticated user has contributed to (#170).

    Deduped to one entry per fountain (any AWARDED contribution — add/rate/note/condition),
    non-hidden, most-recent-contribution first. Serialized as ``FountainPin`` so the web list
    reuses the city-list row (including ``location`` for the See-on-Map link).
    """

    fountains: list[FountainPin]


class BadgeOut(BaseModel):
    key: str
    name: str
    description: str


class ContributorRow(BaseModel):
    rank: int  # 1-based ordinal position in the active board
    display_name: str  # via public_display_name (never the raw subject)
    points: int  # total points in scope: global total_points, or the in-area sum
    # The sorted category's count when sort=<category>; null for sort=total.
    category_count: int | None = None
    is_you: bool = False  # the caller's own row — set only when it appears in `rows`


class YourStanding(BaseModel):
    """The signed-in caller's standing on the active board (#117).

    Null on the response when the caller is anonymous. `rank` is null when the caller is
    signed in but unranked in this scope/category (e.g. all points reversed, or zero in the
    selected category); `points`/`category_count` still reflect their real values."""

    rank: int | None = None
    points: int
    category_count: int | None = None


class LeaderboardOut(BaseModel):
    rows: list[ContributorRow]
    you: YourStanding | None = None  # null when the caller is anonymous


class AddNoteRequest(BaseModel):
    body: NoteBody


class NoteOut(BaseModel):
    id: uuid.UUID
    body: str
    author_display_name: str
    created_at: datetime
    updated_at: datetime
    # #204: set only on the note CREATE (0 when the once-per-fountain note award is spent);
    # null on the list endpoint — a read awards nothing.
    points_awarded: int | None = None


class AdminNoteOut(NoteOut):
    is_hidden: bool


class AdminNotePatch(BaseModel):
    is_hidden: bool


class AdminPhotoPatch(BaseModel):
    is_hidden: bool


class AdminPhotoOut(BaseModel):
    id: uuid.UUID
    is_hidden: bool
    hidden_at: datetime | None


class AdminFountainPatch(BaseModel):
    location: Coordinates | None = None
    is_working: bool | None = None
    placement_note: str | None = None
    comments: CommentBody | None = None
    is_hidden: bool | None = None

    @field_validator("comments", mode="before")
    @classmethod
    def _normalize_comments(cls, v: object) -> object:
        return _normalize_optional_text(v)

    @model_validator(mode="after")
    def _reject_empty_patch(self) -> "AdminFountainPatch":
        if not self.model_fields_set:
            raise ValueError("patch must include at least one field")
        return self


class AdminFountainDetail(FountainDetail):
    is_hidden: bool
    notes: list[AdminNoteOut]


class BoundingBox(BaseModel):
    south: float
    west: float
    north: float
    east: float


class GeocodeResult(BaseModel):
    label: str
    latitude: float
    longitude: float
    # Optional (spec 2026-07-01 §2): not every provider hit has one, and existing
    # clients (mobile) ignore it — only a fully validated, positive-area box is ever
    # populated (see geocoding.py's _parse_bounding_box).
    bounding_box: BoundingBox | None = None


class GeocodeResponse(BaseModel):
    results: list[GeocodeResult]


class PlaceOut(BaseModel):
    """A crawlable place (country or city) for the public SEO endpoints (#127, spec §5).

    Serialized from ``PlaceBoundary`` (precomputed membership; never a live ST_Covers). The
    public URL segment is ``country_code`` for a country (ISO-3166-1 alpha-2, lowercased) and
    ``slug`` for a city — both are carried so the client can build either route. ``fountain_count``
    is the denormalized NON-HIDDEN count that drives the "N fountains" copy and the >= K gate.
    """

    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    country_code: str
    slug: str
    name: str
    subtype: str
    fountain_count: int


class PhotoOut(BaseModel):
    id: uuid.UUID
    url: str
    thumbnail_url: str
    width: int
    height: int
    uploaded_by: str | None
    created_at: datetime
    # True only when the requesting viewer is the uploader (the list endpoint enriches this via
    # the optional-auth seam). Unauthenticated callers, and any code path that doesn't know the
    # viewer, get the safe default False — never a false "you own this".
    is_own: bool = False
    # #204: set only on UPLOAD (0 when the fountain's photo_first award is already spent); null on
    # the list endpoint — a read awards nothing.
    points_awarded: int | None = None


class ReportContentRequest(BaseModel):
    category: str
    note: str | None = Field(default=None, max_length=500)


class ReportedPhotoOut(BaseModel):
    photo_id: uuid.UUID
    fountain_id: uuid.UUID
    url: str
    thumbnail_url: str
    is_hidden: bool
    report_count: int
    categories: list[str]
    notes: list[str]  # <=3, each truncated <=200 chars
    first_reported_at: datetime
    uploaded_by: str | None


class CityFountainPin(FountainPin):
    photo_count: int = 0
    thumbnail_url: str | None = None


class PhotoReportsSummary(BaseModel):
    pending_photo_count: int


class ReportedContentOut(BaseModel):
    """One reported item in the unified moderation queue (#12). Discriminated by
    ``content_type``; the per-type fields below are populated only for their type. ``notes`` are
    the reporters' free-text (admin-only PII, ≤3, truncated ≤200); ``excerpt`` is the reported
    note's own body (note only, truncated ≤200)."""

    content_type: str  # 'photo' | 'note' | 'fountain'
    content_id: uuid.UUID
    fountain_id: uuid.UUID
    is_hidden: bool
    report_count: int
    categories: list[str]
    notes: list[str]
    first_reported_at: datetime
    contributor: str | None = None  # uploader (photo) / author (note); None for fountain
    thumbnail_url: str | None = None  # photo only
    url: str | None = None  # photo only (gated full-image path)
    excerpt: str | None = None  # note body, truncated <=200 (note only)
    fountain_label: str | None = None  # fountain placement_note (fountain only; nullable)


class ReportsSummary(BaseModel):
    pending_count: int


class ReportDismissRequest(BaseModel):
    content_type: str
    content_id: uuid.UUID


class CityFountainsOut(BaseModel):
    """A city place plus its ranked, paginated fountains (#127 Slice 3, spec §4.3/§5).

    ``place`` is the canonical city that owns the ``/[country]/[city]`` URL; ``fountains`` are its
    non-hidden fountains, best-rated first. ``place.fountain_count`` is the full non-hidden total
    (the list is capped by ``limit``), so the page can show "top N of M" without a separate count.
    ``indexable`` is the spec §7 thin-content predicate computed server-side (``fountain_count >=
    seo_place_min_fountains``) — the single source of truth for K, so the web sets ``noindex`` from
    it rather than knowing the threshold.
    """

    place: PlaceOut
    fountains: list[CityFountainPin]
    indexable: bool


class AttributeFountainsOut(BaseModel):
    """A global attribute page's ranked, paginated fountains (#127 Slice 4, spec §4.5).

    ``attribute`` echoes the requested SEO attribute key (e.g. ``bottle_filler``). ``fountains`` are
    the non-hidden fountains whose crowdsourced consensus matches, best-rated first. ``total_count``
    is the full matching non-hidden total (the list is capped by ``limit``), so the page can show
    "N fountains" and "top M of N". ``indexable`` is the spec §7/§4.5 thin-content predicate
    computed server-side (``total_count >= seo_attribute_min_fountains``) — the single source of
    ``K_attr`` so the web sets ``noindex`` from it rather than knowing the threshold.
    """

    attribute: str
    fountains: list[FountainPin]
    total_count: int
    indexable: bool


class FountainPlaceOut(BaseModel):
    """One fountain's public place membership + indexability verdict (#127 Slice 5, spec §5/§7).

    Computed from PUBLIC, non-hidden data only (never the viewer/admin path), so auth/admin state
    can never influence indexability or SEO copy. ``city`` is the fountain's most-specific covering
    city place — it shares its ``(country_code, slug)`` with the canonical city that owns the public
    ``/[country]/[city]`` URL — and ``country`` is its country place; either is ``None`` when
    unmatched. Read from the precomputed membership columns (never a live ST_Covers, spec §5).
    ``indexable`` is the single server-side §7 predicate, so the web sets ``noindex`` from it
    without re-deriving the rule.
    """

    fountain_id: uuid.UUID
    city: PlaceOut | None
    country: PlaceOut | None
    indexable: bool


class FountainSitemapOut(BaseModel):
    """The indexable fountain ids for the fountains sitemap chunk (#127 Slice 5, spec §6/§7).

    ``fountain_ids`` are the ids satisfying the single §7 indexing predicate, ordered by id for
    stable pagination and capped by ``limit``. ``total_count`` is the full indexable total, so the
    sitemap builder can log (never silently) when a chunk approaches the 50k-URL limit and must be
    split.
    """

    fountain_ids: list[uuid.UUID]
    total_count: int
