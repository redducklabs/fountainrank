"""fountain photos: fountain_photos, storage_cleanup, upload_attempts

Revision ID: 0018_fountain_photos
Revises: 0017_place_scope_config_ready
Create Date: 2026-07-04
"""

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects.postgresql import UUID as PgUUID

revision = "0018_fountain_photos"
down_revision = "0017_place_scope_config_ready"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # 1) fountain_photos: private Spaces object keys + moderation-hideable, like
    # fountain_notes/condition_reports.
    op.create_table(
        "fountain_photos",
        sa.Column("id", PgUUID(as_uuid=True), nullable=False),
        sa.Column("fountain_id", PgUUID(as_uuid=True), nullable=False),
        sa.Column("user_id", PgUUID(as_uuid=True), nullable=False),
        sa.Column("storage_key", sa.String(), nullable=False),
        sa.Column("thumbnail_key", sa.String(), nullable=False),
        sa.Column("content_type", sa.String(), nullable=False),
        sa.Column("width", sa.Integer(), nullable=False),
        sa.Column("height", sa.Integer(), nullable=False),
        sa.Column("byte_size", sa.BigInteger(), nullable=False),
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
        sa.CheckConstraint("content_type = 'image/jpeg'", name="content_type"),
        sa.CheckConstraint("width > 0", name="width_positive"),
        sa.CheckConstraint("height > 0", name="height_positive"),
        sa.CheckConstraint("byte_size > 0", name="byte_size_positive"),
        sa.PrimaryKeyConstraint("id", name="pk_fountain_photos"),
        sa.ForeignKeyConstraint(
            ["fountain_id"],
            ["fountains.id"],
            ondelete="CASCADE",
            name="fk_fountain_photos_fountain",
        ),
        sa.ForeignKeyConstraint(
            ["user_id"], ["users.id"], ondelete="CASCADE", name="fk_fountain_photos_user"
        ),
        sa.ForeignKeyConstraint(
            ["hidden_by_user_id"], ["users.id"], name="fk_fountain_photos_hidden_by"
        ),
    )
    # Public list / city-list "most recent visible photo" lookup (spec §3.1).
    op.create_index(
        "ix_fountain_photos_fountain_visible",
        "fountain_photos",
        ["fountain_id", "created_at"],
        postgresql_where=sa.text("is_hidden = false"),
    )
    # Powers the per-user rate/quota counts (spec §6).
    op.create_index(
        "ix_fountain_photos_user_created",
        "fountain_photos",
        ["user_id", "created_at"],
    )

    # 2) storage_cleanup: durable retry ledger for Spaces objects (spec §3.3).
    op.create_table(
        "storage_cleanup",
        sa.Column("id", PgUUID(as_uuid=True), nullable=False),
        sa.Column("object_key", sa.String(), nullable=False),
        sa.Column("reason", sa.String(), nullable=False),
        sa.Column("status", sa.String(), server_default=sa.text("'pending'"), nullable=False),
        sa.Column("attempts", sa.Integer(), server_default=sa.text("0"), nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.Column("last_attempt_at", sa.DateTime(timezone=True), nullable=True),
        sa.CheckConstraint("reason IN ('upload_orphan','moderation_delete')", name="reason"),
        sa.CheckConstraint("status IN ('pending','done')", name="status"),
        sa.PrimaryKeyConstraint("id", name="pk_storage_cleanup"),
    )
    # Cleanup worker sweep of pending rows (spec §3.3).
    op.create_index(
        "ix_storage_cleanup_pending_created",
        "storage_cleanup",
        ["created_at"],
        postgresql_where=sa.text("status = 'pending'"),
    )

    # 3) upload_attempts: pre-work reservation ledger, bounds expensive upload work per
    # user before the cost is incurred (spec §3.4).
    op.create_table(
        "upload_attempts",
        sa.Column("id", PgUUID(as_uuid=True), nullable=False),
        sa.Column("user_id", PgUUID(as_uuid=True), nullable=False),
        sa.Column("status", sa.String(), server_default=sa.text("'reserved'"), nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.Column("finalized_at", sa.DateTime(timezone=True), nullable=True),
        sa.CheckConstraint("status IN ('reserved','completed','failed')", name="status"),
        sa.PrimaryKeyConstraint("id", name="pk_upload_attempts"),
        sa.ForeignKeyConstraint(
            ["user_id"], ["users.id"], ondelete="CASCADE", name="fk_upload_attempts_user"
        ),
    )
    # Rolling per-user rate/quota window lookup (spec §3.4/§6).
    op.create_index(
        "ix_upload_attempts_user_status_created",
        "upload_attempts",
        ["user_id", "status", "created_at"],
    )


def downgrade() -> None:
    op.drop_index("ix_upload_attempts_user_status_created", table_name="upload_attempts")
    op.drop_table("upload_attempts")
    op.drop_index("ix_storage_cleanup_pending_created", table_name="storage_cleanup")
    op.drop_table("storage_cleanup")
    op.drop_index("ix_fountain_photos_user_created", table_name="fountain_photos")
    op.drop_index("ix_fountain_photos_fountain_visible", table_name="fountain_photos")
    op.drop_table("fountain_photos")
