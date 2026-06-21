"""osm ingestion: fountain origin/visibility + provenance/run/candidate/event tables

Revision ID: 0004_osm_ingestion
Revises: 0003_seed_rating_types
Create Date: 2026-06-21
"""

import geoalchemy2
import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.dialects.postgresql import UUID as PgUUID

revision = "0004_osm_ingestion"
down_revision = "0003_seed_rating_types"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # 1) fountains: new columns (server_default backfills existing rows), then nullable owner.
    op.add_column(
        "fountains",
        sa.Column("is_hidden", sa.Boolean(), server_default=sa.text("false"), nullable=False),
    )
    op.add_column(
        "fountains",
        sa.Column("created_source", sa.String(), server_default=sa.text("'user'"), nullable=False),
    )
    op.alter_column(
        "fountains", "added_by_user_id", existing_type=PgUUID(as_uuid=True), nullable=True
    )
    # 2) CHECKs added LAST, after backfill. op.create_check_constraint APPLIES the naming
    #    convention (ck_%(table_name)s_%(constraint_name)s), so pass the SHORT constraint
    #    name — it renders to ck_fountains_* matching the ORM. Passing the full name here
    #    would double-prefix to ck_fountains_ck_fountains_* (same trap as ratings.stars_range).
    op.create_check_constraint(
        "created_source",
        "fountains",
        "created_source IN ('user','osm','admin_import')",
    )
    op.create_check_constraint(
        "user_source_requires_user",
        "fountains",
        "created_source <> 'user' OR added_by_user_id IS NOT NULL",
    )
    op.create_index("ix_fountains_created_source", "fountains", ["created_source"], unique=False)

    # 3) import runs (referenced by provenance/candidate/event FKs — create first).
    op.create_table(
        "osm_fountain_import_runs",
        sa.Column("id", PgUUID(as_uuid=True), nullable=False),
        sa.Column(
            "started_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.Column("finished_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("status", sa.String(), server_default=sa.text("'running'"), nullable=False),
        sa.Column("dry_run", sa.Boolean(), server_default=sa.text("false"), nullable=False),
        sa.Column("source_system", sa.String(), nullable=False),
        sa.Column("source_dataset", sa.String(), nullable=False),
        sa.Column("source_build_id", sa.String(), nullable=False),
        sa.Column("source_label", sa.String(), nullable=False),
        sa.Column("scope_id", sa.String(), nullable=False),
        sa.Column(
            "scope_bounds",
            geoalchemy2.types.Geography(
                geometry_type="POLYGON",
                srid=4326,
                from_text="ST_GeogFromText",
                name="geography",
                spatial_index=False,
            ),
            nullable=True,
        ),
        sa.Column("candidate_count", sa.Integer(), server_default=sa.text("0"), nullable=False),
        sa.Column("inserted_count", sa.Integer(), server_default=sa.text("0"), nullable=False),
        sa.Column("updated_count", sa.Integer(), server_default=sa.text("0"), nullable=False),
        sa.Column(
            "matched_existing_count", sa.Integer(), server_default=sa.text("0"), nullable=False
        ),
        sa.Column(
            "provenance_attached_count", sa.Integer(), server_default=sa.text("0"), nullable=False
        ),
        sa.Column("skipped_count", sa.Integer(), server_default=sa.text("0"), nullable=False),
        sa.Column("removed_count", sa.Integer(), server_default=sa.text("0"), nullable=False),
        sa.Column(
            "review_flagged_count", sa.Integer(), server_default=sa.text("0"), nullable=False
        ),
        sa.Column("error_summary", sa.String(), nullable=True),
        sa.PrimaryKeyConstraint("id", name="pk_osm_fountain_import_runs"),
    )

    # 4) provenance
    op.create_table(
        "fountain_provenances",
        sa.Column("id", PgUUID(as_uuid=True), nullable=False),
        sa.Column("fountain_id", PgUUID(as_uuid=True), nullable=False),
        sa.Column("source_system", sa.String(), nullable=False),
        sa.Column("source_dataset", sa.String(), nullable=False),
        sa.Column("scope_id", sa.String(), nullable=False),
        sa.Column("source_external_id", sa.String(), nullable=False),
        sa.Column("osm_type", sa.String(), nullable=True),
        sa.Column("osm_id", sa.BigInteger(), nullable=True),
        sa.Column("source_tags", JSONB(), nullable=True),
        sa.Column("confidence", sa.String(), nullable=True),
        sa.Column("geometry_kind", sa.String(), nullable=True),
        sa.Column("first_seen_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("last_seen_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("removed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("first_import_run_id", PgUUID(as_uuid=True), nullable=False),
        sa.Column("last_import_run_id", PgUUID(as_uuid=True), nullable=False),
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
        sa.PrimaryKeyConstraint("id", name="pk_fountain_provenances"),
        sa.ForeignKeyConstraint(
            ["fountain_id"],
            ["fountains.id"],
            ondelete="CASCADE",
            name="fk_fountain_provenances_fountain_id_fountains",
        ),
        sa.ForeignKeyConstraint(
            ["first_import_run_id"],
            ["osm_fountain_import_runs.id"],
            name="fk_provenances_first_run",
        ),
        sa.ForeignKeyConstraint(
            ["last_import_run_id"],
            ["osm_fountain_import_runs.id"],
            name="fk_provenances_last_run",
        ),
    )
    op.create_index(
        "uq_fountain_provenances_source_external",
        "fountain_provenances",
        ["source_system", "source_external_id"],
        unique=True,
    )
    op.create_index(
        "ix_fountain_provenances_fountain_id", "fountain_provenances", ["fountain_id"], unique=False
    )
    op.create_index(
        "ix_fountain_provenances_scope",
        "fountain_provenances",
        ["source_system", "scope_id"],
        unique=False,
    )

    # 5) candidates (staging)
    op.create_table(
        "osm_fountain_import_candidates",
        sa.Column("id", PgUUID(as_uuid=True), nullable=False),
        sa.Column("run_id", PgUUID(as_uuid=True), nullable=False),
        sa.Column("source_external_id", sa.String(), nullable=False),
        sa.Column("osm_type", sa.String(), nullable=True),
        sa.Column("osm_id", sa.BigInteger(), nullable=True),
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
        sa.Column("tags", JSONB(), nullable=True),
        sa.Column("confidence", sa.String(), nullable=True),
        sa.Column("skip_reason", sa.String(), nullable=True),
        sa.Column("matched_fountain_id", PgUUID(as_uuid=True), nullable=True),
        sa.Column("action", sa.String(), nullable=False),
        sa.PrimaryKeyConstraint("id", name="pk_osm_fountain_import_candidates"),
        sa.ForeignKeyConstraint(
            ["run_id"],
            ["osm_fountain_import_runs.id"],
            ondelete="CASCADE",
            name="fk_candidates_run",
        ),
    )
    op.create_index(
        "ix_osm_fountain_import_candidates_run_id",
        "osm_fountain_import_candidates",
        ["run_id"],
        unique=False,
    )

    # 6) events (durable rollback log)
    op.create_table(
        "fountain_import_events",
        sa.Column("id", PgUUID(as_uuid=True), nullable=False),
        sa.Column("run_id", PgUUID(as_uuid=True), nullable=False),
        sa.Column("fountain_id", PgUUID(as_uuid=True), nullable=True),
        sa.Column("provenance_id", PgUUID(as_uuid=True), nullable=True),
        sa.Column("operation", sa.String(), nullable=False),
        sa.Column("prior_values", JSONB(), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.PrimaryKeyConstraint("id", name="pk_fountain_import_events"),
        sa.ForeignKeyConstraint(
            ["run_id"],
            ["osm_fountain_import_runs.id"],
            name="fk_fountain_import_events_run_id_osm_fountain_import_runs",
        ),
        sa.ForeignKeyConstraint(
            ["fountain_id"],
            ["fountains.id"],
            ondelete="SET NULL",
            name="fk_fountain_import_events_fountain_id_fountains",
        ),
        sa.ForeignKeyConstraint(
            ["provenance_id"],
            ["fountain_provenances.id"],
            ondelete="SET NULL",
            name="fk_fountain_import_events_provenance_id_fountain_provenances",
        ),
    )
    op.create_index(
        "ix_fountain_import_events_run_id", "fountain_import_events", ["run_id"], unique=False
    )


def downgrade() -> None:
    op.drop_index("ix_fountain_import_events_run_id", table_name="fountain_import_events")
    op.drop_table("fountain_import_events")
    op.drop_index(
        "ix_osm_fountain_import_candidates_run_id", table_name="osm_fountain_import_candidates"
    )
    op.drop_table("osm_fountain_import_candidates")
    op.drop_index("ix_fountain_provenances_scope", table_name="fountain_provenances")
    op.drop_index("ix_fountain_provenances_fountain_id", table_name="fountain_provenances")
    op.drop_index("uq_fountain_provenances_source_external", table_name="fountain_provenances")
    op.drop_table("fountain_provenances")
    op.drop_table("osm_fountain_import_runs")
    op.drop_constraint("ck_fountains_user_source_requires_user", "fountains", type_="check")
    op.drop_constraint("ck_fountains_created_source", "fountains", type_="check")
    op.drop_index("ix_fountains_created_source", table_name="fountains")
    # DESTRUCTIVE: imported rows have a NULL owner, so restoring NOT NULL on
    # added_by_user_id requires removing them first. This cascades to any ratings on
    # imported rows (FK ON DELETE CASCADE). Downgrade is a schema-rollback last resort,
    # NOT a data-preserving path for imported data.
    op.execute("DELETE FROM fountains WHERE created_source <> 'user'")
    op.alter_column(
        "fountains", "added_by_user_id", existing_type=PgUUID(as_uuid=True), nullable=False
    )
    op.drop_column("fountains", "created_source")
    op.drop_column("fountains", "is_hidden")
