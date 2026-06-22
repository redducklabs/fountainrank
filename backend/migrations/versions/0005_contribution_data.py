"""contribution data foundation: place_type + attribute types/observations/consensus
+ contribution events/stats

Revision ID: 0005_contribution_data
Revises: 0004_osm_ingestion
Create Date: 2026-06-22
"""

import geoalchemy2
import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.dialects.postgresql import UUID as PgUUID

revision = "0005_contribution_data"
down_revision = "0004_osm_ingestion"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # 1) rating_types.place_type (server_default backfills the 4 seeded rows to 'fountain').
    op.add_column(
        "rating_types",
        sa.Column("place_type", sa.String(), server_default=sa.text("'fountain'"), nullable=False),
    )
    op.create_index("ix_rating_types_place_type", "rating_types", ["place_type", "sort_order"])

    # 2) attribute_types (registry). Inline CHECKs use SHORT names — the env applies the
    #    ck convention (ck_attribute_types_value_kind / ck_attribute_types_category), same
    #    as ratings.stars_range in 0002. A full name would double-prefix.
    op.create_table(
        "attribute_types",
        sa.Column("id", sa.SmallInteger(), autoincrement=False, nullable=False),
        sa.Column("key", sa.String(), nullable=False),
        sa.Column("place_type", sa.String(), server_default=sa.text("'fountain'"), nullable=False),
        sa.Column("category", sa.String(), nullable=False),
        sa.Column("name", sa.String(), nullable=False),
        sa.Column("description", sa.String(), nullable=False),
        sa.Column("value_kind", sa.String(), nullable=False),
        sa.Column("allowed_values", JSONB(), nullable=True),
        sa.Column("sort_order", sa.Integer(), nullable=False),
        sa.Column("is_active", sa.Boolean(), server_default=sa.text("true"), nullable=False),
        sa.CheckConstraint("value_kind IN ('boolean','enum')", name="value_kind"),
        sa.CheckConstraint(
            "category IN ('physical','accessibility','access','usability')", name="category"
        ),
        sa.PrimaryKeyConstraint("id", name="pk_attribute_types"),
    )
    op.create_index(
        "uq_attribute_types_place_type", "attribute_types", ["place_type", "key"], unique=True
    )
    op.create_index(
        "ix_attribute_types_place_type",
        "attribute_types",
        ["place_type", "is_active", "sort_order"],
    )

    # 3) attribute_observations (per-user, upsert). user_id NOT NULL in slice 1.
    op.create_table(
        "attribute_observations",
        sa.Column("id", PgUUID(as_uuid=True), nullable=False),
        sa.Column("fountain_id", PgUUID(as_uuid=True), nullable=False),
        sa.Column("user_id", PgUUID(as_uuid=True), nullable=False),
        sa.Column("attribute_type_id", sa.SmallInteger(), nullable=False),
        sa.Column("value", sa.String(), nullable=False),
        sa.Column("is_hidden", sa.Boolean(), server_default=sa.text("false"), nullable=False),
        sa.Column("hidden_by_user_id", PgUUID(as_uuid=True), nullable=True),
        sa.Column("hidden_at", sa.DateTime(timezone=True), nullable=True),
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
        sa.PrimaryKeyConstraint("id", name="pk_attribute_observations"),
        sa.ForeignKeyConstraint(
            ["fountain_id"],
            ["fountains.id"],
            ondelete="CASCADE",
            name="fk_attribute_observations_fountain",
        ),
        sa.ForeignKeyConstraint(
            ["user_id"], ["users.id"], ondelete="CASCADE", name="fk_attribute_observations_user"
        ),
        sa.ForeignKeyConstraint(
            ["attribute_type_id"],
            ["attribute_types.id"],
            name="fk_attribute_observations_attr_type",
        ),
        sa.ForeignKeyConstraint(
            ["hidden_by_user_id"], ["users.id"], name="fk_attribute_observations_hidden_by"
        ),
        sa.UniqueConstraint(
            "fountain_id",
            "user_id",
            "attribute_type_id",
            name="uq_attribute_observations_fountain_id",
        ),
    )
    op.create_index(
        "ix_attribute_observations_fountain_id_attr",
        "attribute_observations",
        ["fountain_id", "attribute_type_id"],
    )

    # 4) fountain_attribute_consensus (denormalized; composite PK).
    op.create_table(
        "fountain_attribute_consensus",
        sa.Column("fountain_id", PgUUID(as_uuid=True), nullable=False),
        sa.Column("attribute_type_id", sa.SmallInteger(), nullable=False),
        sa.Column("consensus_value", sa.String(), nullable=True),
        sa.Column("confidence", sa.String(), nullable=False),
        sa.Column("yes_count", sa.Integer(), server_default=sa.text("0"), nullable=False),
        sa.Column("no_count", sa.Integer(), server_default=sa.text("0"), nullable=False),
        sa.Column("unknown_count", sa.Integer(), server_default=sa.text("0"), nullable=False),
        sa.Column("value_counts", JSONB(), nullable=True),
        sa.Column("observation_count", sa.Integer(), server_default=sa.text("0"), nullable=False),
        sa.Column("latest_observation_value", sa.String(), nullable=True),
        sa.Column("last_observed_at", sa.DateTime(timezone=True), nullable=True),
        sa.PrimaryKeyConstraint(
            "fountain_id", "attribute_type_id", name="pk_fountain_attribute_consensus"
        ),
        sa.ForeignKeyConstraint(
            ["fountain_id"], ["fountains.id"], ondelete="CASCADE", name="fk_consensus_fountain"
        ),
        sa.ForeignKeyConstraint(
            ["attribute_type_id"], ["attribute_types.id"], name="fk_consensus_attr_type"
        ),
    )
    op.create_index(
        "ix_fountain_attribute_consensus_attr_value",
        "fountain_attribute_consensus",
        ["attribute_type_id", "consensus_value"],
    )

    # 5) contribution_events (append-only, idempotent). location column now; GiST index
    #    deferred to the leaderboard slice that queries by area.
    op.create_table(
        "contribution_events",
        sa.Column("id", PgUUID(as_uuid=True), nullable=False),
        sa.Column("user_id", PgUUID(as_uuid=True), nullable=False),
        sa.Column("fountain_id", PgUUID(as_uuid=True), nullable=True),
        sa.Column("target_type", sa.String(), nullable=True),
        sa.Column("target_id", PgUUID(as_uuid=True), nullable=True),
        sa.Column("event_type", sa.String(), nullable=False),
        sa.Column("points", sa.Integer(), nullable=False),
        sa.Column("status", sa.String(), server_default=sa.text("'awarded'"), nullable=False),
        sa.Column("parent_event_id", PgUUID(as_uuid=True), nullable=True),
        sa.Column(
            "location",
            geoalchemy2.types.Geography(
                geometry_type="POINT",
                srid=4326,
                from_text="ST_GeogFromText",
                name="geography",
                spatial_index=False,
            ),
            nullable=True,
        ),
        sa.Column("dedup_key", sa.String(), nullable=False),
        sa.Column("is_confirmed", sa.Boolean(), server_default=sa.text("false"), nullable=False),
        sa.Column("event_metadata", JSONB(), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.CheckConstraint("status IN ('awarded','reversed')", name="status"),
        sa.PrimaryKeyConstraint("id", name="pk_contribution_events"),
        sa.ForeignKeyConstraint(
            ["user_id"], ["users.id"], ondelete="CASCADE", name="fk_contribution_events_user"
        ),
        sa.ForeignKeyConstraint(
            ["fountain_id"],
            ["fountains.id"],
            ondelete="SET NULL",
            name="fk_contribution_events_fountain",
        ),
        sa.ForeignKeyConstraint(
            ["parent_event_id"],
            ["contribution_events.id"],
            ondelete="SET NULL",
            name="fk_contribution_events_parent",
        ),
        sa.UniqueConstraint("dedup_key", name="uq_contribution_events_dedup_key"),
    )
    op.create_index(
        "ix_contribution_events_user_id", "contribution_events", ["user_id", "created_at"]
    )
    op.create_index("ix_contribution_events_event_type", "contribution_events", ["event_type"])
    op.create_index(
        "ix_contribution_events_target", "contribution_events", ["target_type", "target_id"]
    )

    # 6) user_contribution_stats (denormalized cache).
    op.create_table(
        "user_contribution_stats",
        sa.Column("user_id", PgUUID(as_uuid=True), nullable=False),
        sa.Column("total_points", sa.Integer(), server_default=sa.text("0"), nullable=False),
        sa.Column("fountains_added", sa.Integer(), server_default=sa.text("0"), nullable=False),
        sa.Column("ratings_count", sa.Integer(), server_default=sa.text("0"), nullable=False),
        sa.Column("attributes_count", sa.Integer(), server_default=sa.text("0"), nullable=False),
        sa.Column("conditions_reported", sa.Integer(), server_default=sa.text("0"), nullable=False),
        sa.Column("verifications_count", sa.Integer(), server_default=sa.text("0"), nullable=False),
        sa.Column("notes_count", sa.Integer(), server_default=sa.text("0"), nullable=False),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.PrimaryKeyConstraint("user_id", name="pk_user_contribution_stats"),
        sa.ForeignKeyConstraint(
            ["user_id"], ["users.id"], ondelete="CASCADE", name="fk_user_contribution_stats_user"
        ),
    )


def downgrade() -> None:
    op.drop_table("user_contribution_stats")
    op.drop_index("ix_contribution_events_target", table_name="contribution_events")
    op.drop_index("ix_contribution_events_event_type", table_name="contribution_events")
    op.drop_index("ix_contribution_events_user_id", table_name="contribution_events")
    op.drop_table("contribution_events")
    op.drop_index(
        "ix_fountain_attribute_consensus_attr_value", table_name="fountain_attribute_consensus"
    )
    op.drop_table("fountain_attribute_consensus")
    op.drop_index("ix_attribute_observations_fountain_id_attr", table_name="attribute_observations")
    op.drop_table("attribute_observations")
    op.drop_index("ix_attribute_types_place_type", table_name="attribute_types")
    op.drop_index("uq_attribute_types_place_type", table_name="attribute_types")
    op.drop_table("attribute_types")
    op.drop_index("ix_rating_types_place_type", table_name="rating_types")
    op.drop_column("rating_types", "place_type")
