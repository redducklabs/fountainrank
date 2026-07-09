import uuid
from datetime import datetime

from geoalchemy2 import Geography, Geometry
from geoalchemy2.elements import WKBElement
from sqlalchemy import (
    BigInteger,
    CheckConstraint,
    DateTime,
    Double,
    ForeignKey,
    Index,
    MetaData,
    SmallInteger,
    String,
    UniqueConstraint,
    func,
    text,
)
from sqlalchemy.dialects.postgresql import ARRAY, JSONB
from sqlalchemy.dialects.postgresql import UUID as PgUUID
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column

# Deterministic constraint/index names so hand-written migrations and the ORM
# metadata agree exactly — `alembic check` compares by name.
NAMING_CONVENTION = {
    "ix": "ix_%(table_name)s_%(column_0_name)s",
    "uq": "uq_%(table_name)s_%(column_0_name)s",
    "ck": "ck_%(table_name)s_%(constraint_name)s",
    "fk": "fk_%(table_name)s_%(column_0_name)s_%(referred_table_name)s",
    "pk": "pk_%(table_name)s",
}


class Base(DeclarativeBase):
    metadata = MetaData(naming_convention=NAMING_CONVENTION)


class User(Base):
    __tablename__ = "users"

    id: Mapped[uuid.UUID] = mapped_column(
        PgUUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    logto_user_id: Mapped[str] = mapped_column(String, unique=True, nullable=False)
    display_name: Mapped[str] = mapped_column(String, nullable=False)
    # User-set display-name override (kill "Anonymous"). When set it takes precedence over the
    # IdP-synced display_name on every public surface; the synced name is kept as the fallback.
    nickname: Mapped[str | None] = mapped_column(String, nullable=True)
    email: Mapped[str] = mapped_column(String, nullable=False)
    avatar_url: Mapped[str | None] = mapped_column(String, nullable=True)
    is_admin: Mapped[bool] = mapped_column(nullable=False, server_default=text("false"))
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )


class DeletedAccount(Base):
    __tablename__ = "deleted_accounts"
    __table_args__ = (
        CheckConstraint("identity_delete_status IN ('pending','done')", name="identity_status"),
        Index(
            "ix_deleted_accounts_identity_pending",
            "deleted_at",
            postgresql_where=text("identity_delete_status = 'pending'"),
        ),
    )

    logto_user_id: Mapped[str] = mapped_column(String, primary_key=True)
    identity_delete_status: Mapped[str] = mapped_column(
        String, nullable=False, server_default=text("'pending'")
    )
    identity_delete_attempts: Mapped[int] = mapped_column(nullable=False, server_default=text("0"))
    identity_delete_last_attempt_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    identity_delete_error: Mapped[str | None] = mapped_column(String, nullable=True)
    deleted_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )


class RatingType(Base):
    __tablename__ = "rating_types"
    # place_type scopes dimensions to a kind of place (#44). All current rows are
    # 'fountain'; restroom dimensions will be added as place_type='restroom' rows.
    __table_args__ = (Index("ix_rating_types_place_type", "place_type", "sort_order"),)

    # Stable seed ids (1=Clarity, 2=Taste, 3=Pressure, 4=Appearance); not autoincrement.
    id: Mapped[int] = mapped_column(SmallInteger, primary_key=True, autoincrement=False)
    name: Mapped[str] = mapped_column(String, unique=True, nullable=False)
    description: Mapped[str] = mapped_column(String, nullable=False)
    sort_order: Mapped[int] = mapped_column(nullable=False)
    place_type: Mapped[str] = mapped_column(nullable=False, server_default=text("'fountain'"))


class Fountain(Base):
    __tablename__ = "fountains"
    __table_args__ = (
        # Short CHECK names: the naming convention (ck_%(table_name)s_%(constraint_name)s)
        # renders this to ck_fountains_created_source. The migration's
        # op.create_check_constraint ALSO applies the convention, so it passes the SAME short name
        # (passing the full name double-prefixes). Verified via pg_constraint in tests, since
        # alembic check ignores CHECK names/defs.
        CheckConstraint("created_source IN ('user','osm','admin_import')", name="created_source"),
        # Derived current_status (#40) is public API state — constrain it. Short name
        # renders to ck_fountains_current_status (NULL = fall back to baseline is_working).
        CheckConstraint(
            "current_status IS NULL OR "
            "current_status IN ('ok','reported_issue','degraded','not_working')",
            name="current_status",
        ),
        # Spec §4.1: btree index on created_source for import/audit queries.
        Index("ix_fountains_created_source", "created_source"),
        # Precomputed-membership read path (#127 Slice 1d): the public city page is
        # `WHERE city_place_id = <canonical place>`, so both membership FKs are btree-indexed.
        Index("ix_fountains_country_place_id", "country_place_id"),
        Index("ix_fountains_city_place_id", "city_place_id"),
    )

    id: Mapped[uuid.UUID] = mapped_column(
        PgUUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    location: Mapped[WKBElement] = mapped_column(
        Geography(geometry_type="POINT", srid=4326, spatial_index=True), nullable=False
    )
    is_working: Mapped[bool] = mapped_column(nullable=False, server_default=text("true"))
    is_hidden: Mapped[bool] = mapped_column(nullable=False, server_default=text("false"))
    created_source: Mapped[str] = mapped_column(nullable=False, server_default=text("'user'"))
    comments: Mapped[str | None] = mapped_column(String, nullable=True)
    # Nullable now: imported rows have no human owner. The CHECK above enforces that a
    # created_source='user' row still has an owner.
    added_by_user_id: Mapped[uuid.UUID | None] = mapped_column(
        PgUUID(as_uuid=True), ForeignKey("users.id"), nullable=True
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )
    last_rated_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    # Denormalized ranking fields (recomputed by app/ranking.py).
    rating_count: Mapped[int] = mapped_column(nullable=False, server_default=text("0"))
    # Explicit Double (not bare Mapped[float], which infers a generic Float) so the
    # ORM type matches the migration's sa.Double() — no `alembic check` type ambiguity.
    average_rating: Mapped[float | None] = mapped_column(Double, nullable=True)
    ranking_score: Mapped[float | None] = mapped_column(Double, nullable=True)
    # Operational status (#40), derived from condition_reports (app/conditions.py).
    current_status: Mapped[str | None] = mapped_column(String, nullable=True)
    last_verified_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    # Free-text approximate placement (#42), e.g. "near the north restrooms".
    placement_note: Mapped[str | None] = mapped_column(String, nullable=True)
    # Precomputed membership (#127 Slice 1d, spec §5/§11.5): the containing country place and the
    # most-specific eligible city place, assigned by point-in-polygon against place_boundaries
    # (app/membership.py). NULL until assigned, when no city polygon covers the point (unmatched
    # -> country-only), or when the country's boundaries are not loaded. The public place pages read
    # these precomputed columns — NEVER a live ST_Covers. ON DELETE SET NULL so a boundary refresh
    # that drops a place never deletes its fountains (a subsequent refresh re-assigns them).
    country_place_id: Mapped[uuid.UUID | None] = mapped_column(
        PgUUID(as_uuid=True),
        ForeignKey("place_boundaries.id", ondelete="SET NULL", name="fk_fountains_country_place"),
        nullable=True,
    )
    city_place_id: Mapped[uuid.UUID | None] = mapped_column(
        PgUUID(as_uuid=True),
        ForeignKey("place_boundaries.id", ondelete="SET NULL", name="fk_fountains_city_place"),
        nullable=True,
    )


class Rating(Base):
    __tablename__ = "ratings"
    __table_args__ = (
        UniqueConstraint(
            "fountain_id", "user_id", "rating_type_id", name="uq_ratings_fountain_user_type"
        ),
        # The `ck` naming convention is `ck_%(table_name)s_%(constraint_name)s`, so the
        # SHORT name "stars_range" renders as `ck_ratings_stars_range` — matching the
        # migration. Passing the full `ck_ratings_stars_range` here double-prefixes it to
        # `ck_ratings_ck_ratings_stars_range` and breaks name-parity with the migration.
        CheckConstraint("stars >= 1 AND stars <= 5", name="stars_range"),
        Index("ix_ratings_fountain_id", "fountain_id"),
    )

    id: Mapped[uuid.UUID] = mapped_column(
        PgUUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    fountain_id: Mapped[uuid.UUID] = mapped_column(
        PgUUID(as_uuid=True), ForeignKey("fountains.id", ondelete="CASCADE"), nullable=False
    )
    user_id: Mapped[uuid.UUID | None] = mapped_column(
        PgUUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=True
    )
    deleted_actor_id: Mapped[uuid.UUID | None] = mapped_column(PgUUID(as_uuid=True), nullable=True)
    rating_type_id: Mapped[int] = mapped_column(
        SmallInteger, ForeignKey("rating_types.id"), nullable=False
    )
    stars: Mapped[int] = mapped_column(SmallInteger, nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now(), onupdate=func.now()
    )


class FountainProvenance(Base):
    __tablename__ = "fountain_provenances"
    __table_args__ = (
        Index(
            "uq_fountain_provenances_source_external",
            "source_system",
            "source_external_id",
            unique=True,
        ),
        Index("ix_fountain_provenances_fountain_id", "fountain_id"),
        Index("ix_fountain_provenances_scope", "source_system", "scope_id"),
    )

    id: Mapped[uuid.UUID] = mapped_column(
        PgUUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    fountain_id: Mapped[uuid.UUID] = mapped_column(
        PgUUID(as_uuid=True), ForeignKey("fountains.id", ondelete="CASCADE"), nullable=False
    )
    source_system: Mapped[str] = mapped_column(String, nullable=False)
    source_dataset: Mapped[str] = mapped_column(String, nullable=False)
    scope_id: Mapped[str] = mapped_column(String, nullable=False)
    source_external_id: Mapped[str] = mapped_column(String, nullable=False)
    osm_type: Mapped[str | None] = mapped_column(String, nullable=True)
    osm_id: Mapped[int | None] = mapped_column(BigInteger, nullable=True)
    source_tags: Mapped[dict | None] = mapped_column(JSONB, nullable=True)
    confidence: Mapped[str | None] = mapped_column(String, nullable=True)
    geometry_kind: Mapped[str | None] = mapped_column(String, nullable=True)
    first_seen_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    last_seen_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    removed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    # Explicit short FK names: the convention name would exceed Postgres's 63-char limit.
    first_import_run_id: Mapped[uuid.UUID] = mapped_column(
        PgUUID(as_uuid=True),
        ForeignKey("osm_fountain_import_runs.id", name="fk_provenances_first_run"),
        nullable=False,
    )
    last_import_run_id: Mapped[uuid.UUID] = mapped_column(
        PgUUID(as_uuid=True),
        ForeignKey("osm_fountain_import_runs.id", name="fk_provenances_last_run"),
        nullable=False,
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now(), onupdate=func.now()
    )


class OsmImportRun(Base):
    __tablename__ = "osm_fountain_import_runs"

    id: Mapped[uuid.UUID] = mapped_column(
        PgUUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    started_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )
    finished_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    status: Mapped[str] = mapped_column(String, nullable=False, server_default=text("'running'"))
    dry_run: Mapped[bool] = mapped_column(nullable=False, server_default=text("false"))
    source_system: Mapped[str] = mapped_column(String, nullable=False)
    source_dataset: Mapped[str] = mapped_column(String, nullable=False)
    source_build_id: Mapped[str] = mapped_column(String, nullable=False)
    source_label: Mapped[str] = mapped_column(String, nullable=False)
    scope_id: Mapped[str] = mapped_column(String, nullable=False)
    scope_bounds: Mapped[WKBElement | None] = mapped_column(
        # MultiPolygon: real Geofabrik extract boundaries (e.g. California = mainland + Channel
        # Islands) are multipolygons; the Overpass bbox rectangle is emitted as a 1-part multi.
        Geography(geometry_type="MULTIPOLYGON", srid=4326, spatial_index=False),
        nullable=True,
    )
    candidate_count: Mapped[int] = mapped_column(nullable=False, server_default=text("0"))
    inserted_count: Mapped[int] = mapped_column(nullable=False, server_default=text("0"))
    updated_count: Mapped[int] = mapped_column(nullable=False, server_default=text("0"))
    matched_existing_count: Mapped[int] = mapped_column(nullable=False, server_default=text("0"))
    provenance_attached_count: Mapped[int] = mapped_column(nullable=False, server_default=text("0"))
    skipped_count: Mapped[int] = mapped_column(nullable=False, server_default=text("0"))
    removed_count: Mapped[int] = mapped_column(nullable=False, server_default=text("0"))
    review_flagged_count: Mapped[int] = mapped_column(nullable=False, server_default=text("0"))
    error_summary: Mapped[str | None] = mapped_column(String, nullable=True)


class OsmImportCandidate(Base):
    __tablename__ = "osm_fountain_import_candidates"
    __table_args__ = (Index("ix_osm_fountain_import_candidates_run_id", "run_id"),)

    id: Mapped[uuid.UUID] = mapped_column(
        PgUUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    run_id: Mapped[uuid.UUID] = mapped_column(
        PgUUID(as_uuid=True),
        ForeignKey("osm_fountain_import_runs.id", ondelete="CASCADE", name="fk_candidates_run"),
        nullable=False,
    )
    source_external_id: Mapped[str] = mapped_column(String, nullable=False)
    osm_type: Mapped[str | None] = mapped_column(String, nullable=True)
    osm_id: Mapped[int | None] = mapped_column(BigInteger, nullable=True)
    location: Mapped[WKBElement | None] = mapped_column(
        Geography(geometry_type="POINT", srid=4326, spatial_index=False), nullable=True
    )
    tags: Mapped[dict | None] = mapped_column(JSONB, nullable=True)
    confidence: Mapped[str | None] = mapped_column(String, nullable=True)
    skip_reason: Mapped[str | None] = mapped_column(String, nullable=True)
    matched_fountain_id: Mapped[uuid.UUID | None] = mapped_column(
        PgUUID(as_uuid=True), nullable=True
    )
    action: Mapped[str] = mapped_column(String, nullable=False)


class FountainImportEvent(Base):
    __tablename__ = "fountain_import_events"
    __table_args__ = (Index("ix_fountain_import_events_run_id", "run_id"),)

    id: Mapped[uuid.UUID] = mapped_column(
        PgUUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    run_id: Mapped[uuid.UUID] = mapped_column(
        PgUUID(as_uuid=True), ForeignKey("osm_fountain_import_runs.id"), nullable=False
    )
    # Nullable FKs: a candidate may be skipped (no fountain), and rollback may delete a
    # provenance row — ON DELETE SET NULL keeps the audit event without dangling refs.
    fountain_id: Mapped[uuid.UUID | None] = mapped_column(
        PgUUID(as_uuid=True), ForeignKey("fountains.id", ondelete="SET NULL"), nullable=True
    )
    provenance_id: Mapped[uuid.UUID | None] = mapped_column(
        PgUUID(as_uuid=True),
        ForeignKey("fountain_provenances.id", ondelete="SET NULL"),
        nullable=True,
    )
    operation: Mapped[str] = mapped_column(String, nullable=False)
    prior_values: Mapped[dict | None] = mapped_column(JSONB, nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )


class AttributeType(Base):
    """Registry of structured fountain attributes (#38/#42). Rows, not columns:
    new attributes are seed rows, no schema migration per attribute. Scoped by
    place_type (#44) so restroom attributes can coexist later."""

    __tablename__ = "attribute_types"
    __table_args__ = (
        # SHORT CHECK names — the ck convention renders them to
        # ck_attribute_types_value_kind / ck_attribute_types_category (the
        # stars_range/created_source trap: a full name double-prefixes).
        CheckConstraint("value_kind IN ('boolean','enum')", name="value_kind"),
        CheckConstraint(
            "category IN ('physical','accessibility','access','usability')", name="category"
        ),
        Index("uq_attribute_types_place_type", "place_type", "key", unique=True),
        Index("ix_attribute_types_place_type", "place_type", "is_active", "sort_order"),
    )

    # Stable seed ids (like rating_types); not autoincrement.
    id: Mapped[int] = mapped_column(SmallInteger, primary_key=True, autoincrement=False)
    key: Mapped[str] = mapped_column(String, nullable=False)
    place_type: Mapped[str] = mapped_column(nullable=False, server_default=text("'fountain'"))
    category: Mapped[str] = mapped_column(String, nullable=False)
    name: Mapped[str] = mapped_column(String, nullable=False)
    description: Mapped[str] = mapped_column(String, nullable=False)
    value_kind: Mapped[str] = mapped_column(String, nullable=False)
    # JSONB list of canonical enum values (null for boolean kinds).
    allowed_values: Mapped[list | None] = mapped_column(JSONB, nullable=True)
    sort_order: Mapped[int] = mapped_column(nullable=False)
    is_active: Mapped[bool] = mapped_column(nullable=False, server_default=text("true"))


class AttributeObservation(Base):
    """One user's current observation of one attribute on one fountain (#38).
    Upsert to edit (mirrors ratings). Hidden rows are excluded from consensus."""

    __tablename__ = "attribute_observations"
    __table_args__ = (
        UniqueConstraint(
            "fountain_id",
            "user_id",
            "attribute_type_id",
            name="uq_attribute_observations_fountain_id",
        ),
        Index("ix_attribute_observations_fountain_id_attr", "fountain_id", "attribute_type_id"),
    )

    id: Mapped[uuid.UUID] = mapped_column(
        PgUUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    fountain_id: Mapped[uuid.UUID] = mapped_column(
        PgUUID(as_uuid=True),
        ForeignKey("fountains.id", ondelete="CASCADE", name="fk_attribute_observations_fountain"),
        nullable=False,
    )
    user_id: Mapped[uuid.UUID | None] = mapped_column(
        PgUUID(as_uuid=True),
        ForeignKey("users.id", ondelete="CASCADE", name="fk_attribute_observations_user"),
        nullable=True,
    )
    deleted_actor_id: Mapped[uuid.UUID | None] = mapped_column(PgUUID(as_uuid=True), nullable=True)
    attribute_type_id: Mapped[int] = mapped_column(
        SmallInteger,
        ForeignKey("attribute_types.id", name="fk_attribute_observations_attr_type"),
        nullable=False,
    )
    value: Mapped[str] = mapped_column(String, nullable=False)
    is_hidden: Mapped[bool] = mapped_column(nullable=False, server_default=text("false"))
    hidden_by_user_id: Mapped[uuid.UUID | None] = mapped_column(
        PgUUID(as_uuid=True),
        ForeignKey("users.id", name="fk_attribute_observations_hidden_by"),
        nullable=True,
    )
    hidden_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now(), onupdate=func.now()
    )


class FountainAttributeConsensus(Base):
    """Denormalized per-(fountain, attribute) consensus, recomputed on write and on
    moderation hide/unhide (excludes hidden observations). Read-fast for detail/filters."""

    __tablename__ = "fountain_attribute_consensus"
    __table_args__ = (
        Index("ix_fountain_attribute_consensus_attr_value", "attribute_type_id", "consensus_value"),
    )

    fountain_id: Mapped[uuid.UUID] = mapped_column(
        PgUUID(as_uuid=True),
        ForeignKey("fountains.id", ondelete="CASCADE", name="fk_consensus_fountain"),
        primary_key=True,
    )
    attribute_type_id: Mapped[int] = mapped_column(
        SmallInteger,
        ForeignKey("attribute_types.id", name="fk_consensus_attr_type"),
        primary_key=True,
    )
    consensus_value: Mapped[str | None] = mapped_column(String, nullable=True)
    confidence: Mapped[str] = mapped_column(String, nullable=False)
    yes_count: Mapped[int] = mapped_column(nullable=False, server_default=text("0"))
    no_count: Mapped[int] = mapped_column(nullable=False, server_default=text("0"))
    unknown_count: Mapped[int] = mapped_column(nullable=False, server_default=text("0"))
    value_counts: Mapped[dict | None] = mapped_column(JSONB, nullable=True)
    observation_count: Mapped[int] = mapped_column(nullable=False, server_default=text("0"))
    latest_observation_value: Mapped[str | None] = mapped_column(String, nullable=True)
    last_observed_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )


class ContributionEvent(Base):
    """Append-only, idempotent log of accepted point-worthy contributions — the
    gamification substrate (points/badges/first-X/leaderboards derive from it).
    Written in the same txn as the contribution it records; dedup_key is the
    anti-farming + first-ever-detector spine."""

    __tablename__ = "contribution_events"
    __table_args__ = (
        CheckConstraint("status IN ('awarded','reversed')", name="status"),
        UniqueConstraint("dedup_key", name="uq_contribution_events_dedup_key"),
        Index("ix_contribution_events_user_id", "user_id", "created_at"),
        Index("ix_contribution_events_event_type", "event_type"),
        Index("ix_contribution_events_target", "target_type", "target_id"),
        # location GiST index is managed via spatial_index=True on the column below
        # (geoalchemy2 + alembic_helpers); created as idx_contribution_events_location
        # in migration 0010 for the local contributor leaderboard.
        # Rolling-24h condition point-window lookback (#124): ORDER BY created_at DESC LIMIT 1
        # over one (user, fountain). Partial → tiny; plain columns → alembic-drift-clean.
        Index(
            "ix_contribution_events_condition_window",
            "user_id",
            "fountain_id",
            "created_at",
            postgresql_where=text(
                "status = 'awarded' AND event_type IN ('verify_working', 'report_condition')"
            ),
        ),
    )

    id: Mapped[uuid.UUID] = mapped_column(
        PgUUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    user_id: Mapped[uuid.UUID] = mapped_column(
        PgUUID(as_uuid=True),
        ForeignKey("users.id", ondelete="CASCADE", name="fk_contribution_events_user"),
        nullable=False,
    )
    # SET NULL so a deleted fountain keeps the audit/points record.
    fountain_id: Mapped[uuid.UUID | None] = mapped_column(
        PgUUID(as_uuid=True),
        ForeignKey("fountains.id", ondelete="SET NULL", name="fk_contribution_events_fountain"),
        nullable=True,
    )
    # Durable link to the exact contributing row (rating/observation/etc). Not a
    # hard FK (targets span many tables); integrity enforced in the chokepoint.
    target_type: Mapped[str | None] = mapped_column(String, nullable=True)
    target_id: Mapped[uuid.UUID | None] = mapped_column(PgUUID(as_uuid=True), nullable=True)
    event_type: Mapped[str] = mapped_column(String, nullable=False)
    points: Mapped[int] = mapped_column(nullable=False)
    status: Mapped[str] = mapped_column(String, nullable=False, server_default=text("'awarded'"))
    parent_event_id: Mapped[uuid.UUID | None] = mapped_column(
        PgUUID(as_uuid=True),
        ForeignKey(
            "contribution_events.id",
            ondelete="SET NULL",
            name="fk_contribution_events_parent",
        ),
        nullable=True,
    )
    location: Mapped[WKBElement | None] = mapped_column(
        Geography(geometry_type="POINT", srid=4326, spatial_index=True), nullable=True
    )
    dedup_key: Mapped[str] = mapped_column(String, nullable=False)
    is_confirmed: Mapped[bool] = mapped_column(nullable=False, server_default=text("false"))
    # NOT `metadata` — that name is reserved by SQLAlchemy's Base.metadata.
    event_metadata: Mapped[dict | None] = mapped_column("event_metadata", JSONB, nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )


class UserContributionStats(Base):
    """Denormalized per-user counters — the hot-path profile/leaderboard cache.
    contribution_events is the source of truth; this is incremented on event insert."""

    __tablename__ = "user_contribution_stats"

    user_id: Mapped[uuid.UUID] = mapped_column(
        PgUUID(as_uuid=True),
        ForeignKey("users.id", ondelete="CASCADE", name="fk_user_contribution_stats_user"),
        primary_key=True,
    )
    total_points: Mapped[int] = mapped_column(nullable=False, server_default=text("0"))
    fountains_added: Mapped[int] = mapped_column(nullable=False, server_default=text("0"))
    ratings_count: Mapped[int] = mapped_column(nullable=False, server_default=text("0"))
    attributes_count: Mapped[int] = mapped_column(nullable=False, server_default=text("0"))
    conditions_reported: Mapped[int] = mapped_column(nullable=False, server_default=text("0"))
    verifications_count: Mapped[int] = mapped_column(nullable=False, server_default=text("0"))
    notes_count: Mapped[int] = mapped_column(nullable=False, server_default=text("0"))
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now(), onupdate=func.now()
    )


class ConditionReport(Base):
    """Append-only, time-sensitive condition/verification report (#40). Distinct from
    attributes: a fountain's working state changes over time, so these are events (not
    upserts) and recency + distinct-user corroboration drive the derived current_status."""

    __tablename__ = "condition_reports"
    __table_args__ = (
        CheckConstraint(
            "status IN ('working','broken','low_pressure','dirty','bad_taste',"
            "'blocked','seasonal_unavailable','hours_limited')",
            name="status",
        ),
        Index("ix_condition_reports_fountain_created", "fountain_id", "created_at"),
    )

    id: Mapped[uuid.UUID] = mapped_column(
        PgUUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    fountain_id: Mapped[uuid.UUID] = mapped_column(
        PgUUID(as_uuid=True),
        ForeignKey("fountains.id", ondelete="CASCADE", name="fk_condition_reports_fountain"),
        nullable=False,
    )
    user_id: Mapped[uuid.UUID | None] = mapped_column(
        PgUUID(as_uuid=True),
        ForeignKey("users.id", ondelete="CASCADE", name="fk_condition_reports_user"),
        nullable=True,
    )
    deleted_actor_id: Mapped[uuid.UUID | None] = mapped_column(PgUUID(as_uuid=True), nullable=True)
    status: Mapped[str] = mapped_column(String, nullable=False)
    is_proximate: Mapped[bool] = mapped_column(nullable=False, server_default=text("false"))
    is_hidden: Mapped[bool] = mapped_column(nullable=False, server_default=text("false"))
    hidden_by_user_id: Mapped[uuid.UUID | None] = mapped_column(
        PgUUID(as_uuid=True),
        ForeignKey("users.id", name="fk_condition_reports_hidden_by"),
        nullable=True,
    )
    hidden_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )


class FountainNote(Base):
    """One current user note per fountain (#41), upsert to edit. Moderation-ready and
    independent of aggregate rating/consensus logic."""

    __tablename__ = "fountain_notes"
    __table_args__ = (
        UniqueConstraint("fountain_id", "user_id", name="uq_fountain_notes_fountain_id"),
        # Partial index for the public (non-hidden) read path (spec §6.5).
        Index(
            "ix_fountain_notes_fountain_visible",
            "fountain_id",
            postgresql_where=text("is_hidden = false"),
        ),
    )

    id: Mapped[uuid.UUID] = mapped_column(
        PgUUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    fountain_id: Mapped[uuid.UUID] = mapped_column(
        PgUUID(as_uuid=True),
        ForeignKey("fountains.id", ondelete="CASCADE", name="fk_fountain_notes_fountain"),
        nullable=False,
    )
    user_id: Mapped[uuid.UUID] = mapped_column(
        PgUUID(as_uuid=True),
        ForeignKey("users.id", ondelete="CASCADE", name="fk_fountain_notes_user"),
        nullable=False,
    )
    body: Mapped[str] = mapped_column(String, nullable=False)
    is_hidden: Mapped[bool] = mapped_column(nullable=False, server_default=text("false"))
    hidden_by_user_id: Mapped[uuid.UUID | None] = mapped_column(
        PgUUID(as_uuid=True),
        ForeignKey("users.id", name="fk_fountain_notes_hidden_by"),
        nullable=True,
    )
    hidden_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now(), onupdate=func.now()
    )


class FountainPhoto(Base):
    """User-uploaded photo of a fountain (fountain-photos design §3.1). Stores the private
    Spaces object keys (not URLs — the bucket is private, URLs are presigned at read time).
    Moderation-hideable like FountainNote/ConditionReport; no unique(fountain_id, user_id)
    since a user may upload more than one photo (bounded by caps, spec §6)."""

    __tablename__ = "fountain_photos"
    __table_args__ = (
        CheckConstraint("content_type = 'image/jpeg'", name="content_type"),
        CheckConstraint("width > 0", name="width_positive"),
        CheckConstraint("height > 0", name="height_positive"),
        CheckConstraint("byte_size > 0", name="byte_size_positive"),
        # Public list / city-list "most recent visible photo" lookup (spec §3.1).
        Index(
            "ix_fountain_photos_fountain_visible",
            "fountain_id",
            "created_at",
            postgresql_where=text("is_hidden = false"),
        ),
        # Powers the per-user rate/quota counts (spec §6).
        Index("ix_fountain_photos_user_created", "user_id", "created_at"),
    )

    id: Mapped[uuid.UUID] = mapped_column(
        PgUUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    fountain_id: Mapped[uuid.UUID] = mapped_column(
        PgUUID(as_uuid=True),
        ForeignKey("fountains.id", ondelete="CASCADE", name="fk_fountain_photos_fountain"),
        nullable=False,
    )
    user_id: Mapped[uuid.UUID] = mapped_column(
        PgUUID(as_uuid=True),
        ForeignKey("users.id", ondelete="CASCADE", name="fk_fountain_photos_user"),
        nullable=False,
    )
    storage_key: Mapped[str] = mapped_column(String, nullable=False)
    thumbnail_key: Mapped[str] = mapped_column(String, nullable=False)
    content_type: Mapped[str] = mapped_column(String, nullable=False)
    width: Mapped[int] = mapped_column(nullable=False)
    height: Mapped[int] = mapped_column(nullable=False)
    byte_size: Mapped[int] = mapped_column(BigInteger, nullable=False)
    is_hidden: Mapped[bool] = mapped_column(nullable=False, server_default=text("false"))
    hidden_by_user_id: Mapped[uuid.UUID | None] = mapped_column(
        PgUUID(as_uuid=True),
        ForeignKey("users.id", name="fk_fountain_photos_hidden_by"),
        nullable=True,
    )
    hidden_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now(), onupdate=func.now()
    )


class ContentReport(Base):
    """Polymorphic user report flagging content for moderation (#11). Replaces
    `photo_reports`. `content_id` is a SOFT reference (no per-type FK — targets span
    tables, like ContributionEvent.target_id); integrity is enforced in the report
    chokepoint (app/reports.py) and by the fountain_id CASCADE. One *pending* report per
    (content_type, content_id, reporter); re-report allowed after resolution."""

    __tablename__ = "content_reports"
    __table_args__ = (
        CheckConstraint("content_type IN ('photo','note','fountain')", name="content_type"),
        CheckConstraint(
            "category IN ('spam','abuse','inappropriate','not_a_fountain','inaccurate','other')",
            name="category",
        ),
        CheckConstraint("status IN ('pending','resolved')", name="status"),
        CheckConstraint("resolution IN ('hidden','rejected')", name="resolution"),
        Index(
            "uq_content_reports_target_reporter_pending",
            "content_type",
            "content_id",
            "reporter_user_id",
            unique=True,
            postgresql_where=text("status = 'pending'"),
        ),
        Index(
            "ix_content_reports_target_pending",
            "content_type",
            "content_id",
            postgresql_where=text("status = 'pending'"),
        ),
        Index("ix_content_reports_reporter_created", "reporter_user_id", "created_at"),
    )

    id: Mapped[uuid.UUID] = mapped_column(
        PgUUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    content_type: Mapped[str] = mapped_column(String, nullable=False)
    content_id: Mapped[uuid.UUID] = mapped_column(PgUUID(as_uuid=True), nullable=False)
    fountain_id: Mapped[uuid.UUID] = mapped_column(
        PgUUID(as_uuid=True),
        ForeignKey("fountains.id", ondelete="CASCADE", name="fk_content_reports_fountain"),
        nullable=False,
    )
    reporter_user_id: Mapped[uuid.UUID] = mapped_column(
        PgUUID(as_uuid=True),
        ForeignKey("users.id", ondelete="CASCADE", name="fk_content_reports_reporter"),
        nullable=False,
    )
    category: Mapped[str] = mapped_column(String, nullable=False)
    note: Mapped[str | None] = mapped_column(String(500), nullable=True)
    status: Mapped[str] = mapped_column(String, nullable=False, server_default=text("'pending'"))
    resolution: Mapped[str | None] = mapped_column(String, nullable=True)
    resolved_by_user_id: Mapped[uuid.UUID | None] = mapped_column(
        PgUUID(as_uuid=True),
        ForeignKey("users.id", name="fk_content_reports_resolved_by"),
        nullable=True,
    )
    resolved_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )


class StorageCleanup(Base):
    """Durable retry ledger for Spaces objects whose deletion failed or must be swept
    (fountain-photos design §3.3) — tracks orphans even when no `fountain_photos` row was
    ever inserted (e.g. upload failed the post-upload quota re-check)."""

    __tablename__ = "storage_cleanup"
    __table_args__ = (
        CheckConstraint("reason IN ('upload_orphan','moderation_delete')", name="reason"),
        CheckConstraint("status IN ('pending','done')", name="status"),
        Index(
            "ix_storage_cleanup_pending_created",
            "created_at",
            postgresql_where=text("status = 'pending'"),
        ),
    )

    id: Mapped[uuid.UUID] = mapped_column(
        PgUUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    object_key: Mapped[str] = mapped_column(String, nullable=False)
    reason: Mapped[str] = mapped_column(String, nullable=False)
    status: Mapped[str] = mapped_column(String, nullable=False, server_default=text("'pending'"))
    attempts: Mapped[int] = mapped_column(nullable=False, server_default=text("0"))
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )
    last_attempt_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)


class UploadAttempt(Base):
    """Pre-work reservation ledger (fountain-photos design §3.4): bounds expensive upload
    work (Pillow/S3) per user *before* that cost is incurred, so a burst of parallel
    requests cannot outrun the quota check. `completed`/`failed` rows always count toward
    the rolling rate window; only a `reserved` row past the reservation TTL is excluded."""

    __tablename__ = "upload_attempts"
    __table_args__ = (
        CheckConstraint("status IN ('reserved','completed','failed')", name="status"),
        Index("ix_upload_attempts_user_status_created", "user_id", "status", "created_at"),
    )

    id: Mapped[uuid.UUID] = mapped_column(
        PgUUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    user_id: Mapped[uuid.UUID] = mapped_column(
        PgUUID(as_uuid=True),
        ForeignKey("users.id", ondelete="CASCADE", name="fk_upload_attempts_user"),
        nullable=False,
    )
    status: Mapped[str] = mapped_column(String, nullable=False, server_default=text("'reserved'"))
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )
    finalized_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)


class PlaceBoundary(Base):
    """Administrative / populated-place boundary polygon for crawlable SEO pages (#127).

    Loaded (Slice 1b/1c) from Overture Divisions ``division_area`` — see the spec §11
    decision note. Identity is the Overture GERS ``overture_id`` (NOT an OSM id); the city
    tier is a ``subtype`` (Overture's ``admin_level`` is a normalized hierarchy, not OSM's, so
    it is informational only). Membership (fountain → place) is precomputed by point-in-polygon
    against ``boundary`` (Slice 1d); the public request path never runs a live ``ST_Covers``.
    """

    __tablename__ = "place_boundaries"
    __table_args__ = (
        # Public-namespace uniqueness: the public URL /drinking-fountains/[country]/[city]
        # omits admin_level/subtype, so exactly ONE canonical place may own a
        # (country_code, slug). Non-canonical candidates are retained (spec §11.5), so this is
        # a PARTIAL unique index (WHERE is_canonical), not a plain unique constraint.
        Index(
            "uq_place_boundaries_country_slug_canonical",
            "country_code",
            "slug",
            unique=True,
            postgresql_where=text("is_canonical"),
        ),
    )

    id: Mapped[uuid.UUID] = mapped_column(
        PgUUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    # Overture GERS id — stable across releases; the idempotent upsert key (spec §11.4).
    overture_id: Mapped[str] = mapped_column(String, unique=True, nullable=False)
    # Overture subtype: country | region | county | localadmin | locality | ... The city page
    # tier is selected by subtype per country (spec §11.5), NOT by admin_level.
    subtype: Mapped[str] = mapped_column(String, nullable=False)
    # Overture `class`; the loader keeps only `class='land'` (the maritime twin is excluded).
    # `class` is a Python keyword, so the ORM attribute is `place_class`; the DB column is `class`.
    place_class: Mapped[str] = mapped_column("class", String, nullable=False)
    # Overture-normalized level (country=0, region=1, county=2, NULL at the locality tier) —
    # informational, NOT the city selector (spec §11.5). Hence nullable.
    admin_level: Mapped[int | None] = mapped_column(SmallInteger, nullable=True)
    # Best-effort OSM provenance decoded from Overture sources[] (prefer relation>way>node);
    # nullable — a minority of features are geoBoundaries-conflated with no OSM record (§11.4).
    osm_type: Mapped[str | None] = mapped_column(String, nullable=True)
    osm_id: Mapped[int | None] = mapped_column(BigInteger, nullable=True)
    name: Mapped[str] = mapped_column(String, nullable=False)
    # ISO 3166-1 alpha-2 (lowercased to match the URL segment; normalization is Slice 1b).
    country_code: Mapped[str] = mapped_column(String, nullable=False)
    # Sticky slug (assigned once; a renamed boundary keeps the old route as a 301) — spec §4.3.
    slug: Mapped[str] = mapped_column(String, nullable=False)
    # The one canonical SEO place per (country_code, slug) — spec §4.3/§11.5. Backfill sets it.
    is_canonical: Mapped[bool] = mapped_column(nullable=False, server_default=text("false"))
    # Denormalized count of NON-HIDDEN fountains assigned to this place (#127 Slice 1d) — the
    # public "N fountains in <place>" number and the >= K indexability gate. Recomputed
    # transactionally by app/membership.py on every refresh (boundary load, OSM import, user add,
    # backfill); the public read path never counts live.
    fountain_count: Mapped[int] = mapped_column(nullable=False, server_default=text("0"))
    # City → country parent link, derived by containment in Slice 1d (NOT Overture's hierarchy).
    # SET NULL so dropping a parent boundary on a refresh never deletes its children.
    parent_id: Mapped[uuid.UUID | None] = mapped_column(
        PgUUID(as_uuid=True),
        ForeignKey("place_boundaries.id", ondelete="SET NULL", name="fk_place_boundaries_parent"),
        nullable=True,
    )
    # Loader ST_Multi-coerces every geometry (Overture mixes Polygon/MultiPolygon) — spec §11.6.
    boundary: Mapped[WKBElement] = mapped_column(
        Geography(geometry_type="MULTIPOLYGON", srid=4326, spatial_index=True), nullable=False
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now(), onupdate=func.now()
    )


class PlaceBoundaryCell(Base):
    """A subdivided piece of a ``place_boundaries`` polygon, for fast point-in-polygon (#127).

    Perf hardening of Slice 1d membership. Assigning ~50k fountains against whole-country polygons
    (the US boundary is ~136k vertices, and its bbox covers every fountain so the GiST prefilter
    prunes nothing) ran the country-scale backfill 40+ min. This table holds every boundary broken
    into small ``ST_Subdivide`` cells; a point-in-polygon probe hits a GiST index of small cells
    instead of one giant polygon (the canonical PostGIS pattern — measured on prod: >180s -> 7.4s).

    It is a **rebuildable derivative** of ``place_boundaries``: fully replaced on every boundary
    load / membership backfill by :func:`app.membership.rebuild_place_boundary_cells`. Membership
    assignment joins fountains -> cells -> ``place_boundaries`` by ``place_id`` and tests
    containment in PLANAR (geometry) space (``ST_Covers(geom, location::geometry)``) — correct for
    lon/lat point-in-polygon and cheaper than geography.
    """

    __tablename__ = "place_boundary_cells"

    id: Mapped[uuid.UUID] = mapped_column(
        PgUUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    # The boundary this cell is a piece of. CASCADE so dropping a boundary drops its cells; the
    # rebuild replaces cells wholesale, but the cascade keeps orphans impossible if one is deleted.
    place_id: Mapped[uuid.UUID] = mapped_column(
        PgUUID(as_uuid=True),
        ForeignKey("place_boundaries.id", ondelete="CASCADE", name="fk_place_boundary_cells_place"),
        nullable=False,
        index=True,
    )
    # A ST_Subdivide piece of the source boundary (Polygon/MultiPolygon), in geometry (planar)
    # space. spatial_index=True -> GeoAlchemy2 auto-creates idx_place_boundary_cells_geom (GiST).
    geom: Mapped[WKBElement] = mapped_column(
        Geometry(geometry_type="GEOMETRY", srid=4326, spatial_index=True), nullable=False
    )


class PlaceScopeConfig(Base):
    """Per-country city-tier eligibility for membership assignment (#127 Slice 1d, spec §11.5).

    The city-assignment ladder (app/membership.py) considers only the ``division_area`` subtypes in
    a country's eligible set. The default (no row for a country) is ``{locality, localadmin}``; a
    country whose finest municipal tier is coarser opts in ``county`` — e.g. Luxembourg, whose
    communes are ``subtype='county'`` (spec §11.2/§11.5). Kept as **data, not code**, so the Slice
    1e coverage gate / owner signoff can adjust a country's eligible set without a deploy. Seeded in
    migration 0015 for the active boundary scopes (``us``, ``lu``).
    """

    __tablename__ = "place_scope_config"

    # ISO 3166-1 alpha-2, lowercased to match place_boundaries.country_code / the URL segment.
    country_code: Mapped[str] = mapped_column(String, primary_key=True)
    # Overture subtypes that count as a city here, e.g. {locality, localadmin} (+county for LU).
    eligible_city_subtypes: Mapped[list[str]] = mapped_column(ARRAY(String), nullable=False)
    # Slice 1e per-scope readiness gate (spec docs/specs/2026-07-04-seo-coverage-gate-design.md):
    # a scope's CITY routes (cities sitemap chunk + each city page's indexability) are live only
    # when this is true. Owner signoff after reading the coverage report; set via a reviewed
    # migration. A country with no row here is NOT ready. Seeded true for us/lu in migration 0017.
    city_routes_ready: Mapped[bool] = mapped_column(nullable=False, server_default=text("false"))
