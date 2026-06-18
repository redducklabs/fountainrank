"""phase 1 core schema: users, fountains, rating_types, ratings

Revision ID: 0002_phase1_core_schema
Revises: 0001_enable_postgis
Create Date: 2026-06-18
"""

import geoalchemy2
import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects.postgresql import UUID as PgUUID

revision = "0002_phase1_core_schema"
down_revision = "0001_enable_postgis"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "users",
        sa.Column("id", PgUUID(as_uuid=True), nullable=False),
        sa.Column("logto_user_id", sa.String(), nullable=False),
        sa.Column("display_name", sa.String(), nullable=False),
        sa.Column("email", sa.String(), nullable=False),
        sa.Column("avatar_url", sa.String(), nullable=True),
        sa.Column("is_admin", sa.Boolean(), server_default=sa.text("false"), nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.PrimaryKeyConstraint("id", name="pk_users"),
        sa.UniqueConstraint("logto_user_id", name="uq_users_logto_user_id"),
    )
    op.create_table(
        "rating_types",
        sa.Column("id", sa.SmallInteger(), autoincrement=False, nullable=False),
        sa.Column("name", sa.String(), nullable=False),
        sa.Column("description", sa.String(), nullable=False),
        sa.Column("sort_order", sa.Integer(), nullable=False),
        sa.PrimaryKeyConstraint("id", name="pk_rating_types"),
        sa.UniqueConstraint("name", name="uq_rating_types_name"),
    )
    op.create_table(
        "fountains",
        sa.Column("id", PgUUID(as_uuid=True), nullable=False),
        sa.Column(
            "location",
            geoalchemy2.types.Geography(
                geometry_type="POINT",
                srid=4326,
                from_text="ST_GeogFromText",
                name="geography",
            ),
            nullable=False,
        ),
        sa.Column("is_working", sa.Boolean(), server_default=sa.text("true"), nullable=False),
        sa.Column("comments", sa.String(), nullable=True),
        sa.Column("added_by_user_id", PgUUID(as_uuid=True), nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.Column("last_rated_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("rating_count", sa.Integer(), server_default=sa.text("0"), nullable=False),
        sa.Column("average_rating", sa.Double(), nullable=True),
        sa.Column("ranking_score", sa.Double(), nullable=True),
        sa.PrimaryKeyConstraint("id", name="pk_fountains"),
        sa.ForeignKeyConstraint(
            ["added_by_user_id"],
            ["users.id"],
            name="fk_fountains_added_by_user_id_users",
        ),
    )
    # GeoAlchemy2's spatial_index=True auto-creates idx_fountains_location as part of
    # create_table above; no explicit op.create_index needed here.
    # alembic_helpers.include_object filters it from `alembic check` comparisons.
    op.create_table(
        "ratings",
        sa.Column("id", PgUUID(as_uuid=True), nullable=False),
        sa.Column("fountain_id", PgUUID(as_uuid=True), nullable=False),
        sa.Column("user_id", PgUUID(as_uuid=True), nullable=False),
        sa.Column("rating_type_id", sa.SmallInteger(), nullable=False),
        sa.Column("stars", sa.SmallInteger(), nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.PrimaryKeyConstraint("id", name="pk_ratings"),
        sa.ForeignKeyConstraint(
            ["fountain_id"],
            ["fountains.id"],
            ondelete="CASCADE",
            name="fk_ratings_fountain_id_fountains",
        ),
        sa.ForeignKeyConstraint(
            ["user_id"],
            ["users.id"],
            ondelete="CASCADE",
            name="fk_ratings_user_id_users",
        ),
        sa.ForeignKeyConstraint(
            ["rating_type_id"],
            ["rating_types.id"],
            name="fk_ratings_rating_type_id_rating_types",
        ),
        sa.UniqueConstraint(
            "fountain_id", "user_id", "rating_type_id", name="uq_ratings_fountain_user_type"
        ),
        sa.CheckConstraint("stars >= 1 AND stars <= 5", name="ck_ratings_stars_range"),
    )
    op.create_index("ix_ratings_fountain_id", "ratings", ["fountain_id"], unique=False)


def downgrade() -> None:
    op.drop_index("ix_ratings_fountain_id", table_name="ratings")
    op.drop_table("ratings")
    # idx_fountains_location (spatial index) is dropped automatically with the table.
    op.drop_table("fountains")
    op.drop_table("rating_types")
    op.drop_table("users")
