import uuid
from datetime import datetime

from geoalchemy2 import Geography
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
from sqlalchemy.dialects.postgresql import JSONB
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
    email: Mapped[str] = mapped_column(String, nullable=False)
    avatar_url: Mapped[str | None] = mapped_column(String, nullable=True)
    is_admin: Mapped[bool] = mapped_column(nullable=False, server_default=text("false"))
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )


class RatingType(Base):
    __tablename__ = "rating_types"

    # Stable seed ids (1=Clarity, 2=Taste, 3=Pressure, 4=Appearance); not autoincrement.
    id: Mapped[int] = mapped_column(SmallInteger, primary_key=True, autoincrement=False)
    name: Mapped[str] = mapped_column(String, unique=True, nullable=False)
    description: Mapped[str] = mapped_column(String, nullable=False)
    sort_order: Mapped[int] = mapped_column(nullable=False)


class Fountain(Base):
    __tablename__ = "fountains"
    __table_args__ = (
        # Short CHECK names: the naming convention (ck_%(table_name)s_%(constraint_name)s)
        # renders these to ck_fountains_created_source / ck_fountains_user_source_requires_user.
        # The migration's op.create_check_constraint ALSO applies the convention, so it passes
        # the SAME short names (passing the full name double-prefixes). Verified via
        # pg_constraint in tests, since alembic check ignores CHECK names/defs.
        CheckConstraint("created_source IN ('user','osm','admin_import')", name="created_source"),
        CheckConstraint(
            "created_source <> 'user' OR added_by_user_id IS NOT NULL",
            name="user_source_requires_user",
        ),
        # Spec §4.1: btree index on created_source for import/audit queries.
        Index("ix_fountains_created_source", "created_source"),
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
    user_id: Mapped[uuid.UUID] = mapped_column(
        PgUUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False
    )
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
        Geography(geometry_type="POLYGON", srid=4326, spatial_index=False), nullable=True
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
