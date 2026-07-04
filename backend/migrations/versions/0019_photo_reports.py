"""photo reports: photo_reports

Revision ID: 0019_photo_reports
Revises: 0018_fountain_photos
Create Date: 2026-07-04
"""

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects.postgresql import UUID as PgUUID

revision = "0019_photo_reports"
down_revision = "0018_fountain_photos"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # photo_reports: user reports flagging a fountain photo for moderation
    # (fountain-photos design §3.2). A user may hold at most one *pending* report
    # per photo (partial unique index below) but may re-report after resolution.
    op.create_table(
        "photo_reports",
        sa.Column("id", PgUUID(as_uuid=True), nullable=False),
        sa.Column("photo_id", PgUUID(as_uuid=True), nullable=False),
        sa.Column("reporter_user_id", PgUUID(as_uuid=True), nullable=False),
        sa.Column("category", sa.String(), nullable=False),
        sa.Column("note", sa.String(length=500), nullable=True),
        sa.Column("status", sa.String(), server_default=sa.text("'pending'"), nullable=False),
        sa.Column("resolution", sa.String(), nullable=True),
        sa.Column("resolved_by_user_id", PgUUID(as_uuid=True), nullable=True),
        sa.Column("resolved_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.CheckConstraint(
            "category IN ('inappropriate','not_a_fountain','spam','other')", name="category"
        ),
        sa.CheckConstraint("status IN ('pending','resolved')", name="status"),
        sa.CheckConstraint("resolution IN ('hidden','rejected')", name="resolution"),
        sa.PrimaryKeyConstraint("id", name="pk_photo_reports"),
        sa.ForeignKeyConstraint(
            ["photo_id"],
            ["fountain_photos.id"],
            ondelete="CASCADE",
            name="fk_photo_reports_photo",
        ),
        sa.ForeignKeyConstraint(
            ["reporter_user_id"],
            ["users.id"],
            ondelete="CASCADE",
            name="fk_photo_reports_reporter",
        ),
        sa.ForeignKeyConstraint(
            ["resolved_by_user_id"], ["users.id"], name="fk_photo_reports_resolved_by"
        ),
    )
    # One pending report per (photo, reporter); a user may re-report after resolution.
    op.create_index(
        "uq_photo_reports_photo_reporter_pending",
        "photo_reports",
        ["photo_id", "reporter_user_id"],
        unique=True,
        postgresql_where=sa.text("status = 'pending'"),
    )
    # Queue / badge count (spec §6).
    op.create_index(
        "ix_photo_reports_photo_pending",
        "photo_reports",
        ["photo_id"],
        postgresql_where=sa.text("status = 'pending'"),
    )
    # Reporter rate limit (spec §6).
    op.create_index(
        "ix_photo_reports_reporter_pending_created",
        "photo_reports",
        ["reporter_user_id", "created_at"],
        postgresql_where=sa.text("status = 'pending'"),
    )


def downgrade() -> None:
    op.drop_index("ix_photo_reports_reporter_pending_created", table_name="photo_reports")
    op.drop_index("ix_photo_reports_photo_pending", table_name="photo_reports")
    op.drop_index("uq_photo_reports_photo_reporter_pending", table_name="photo_reports")
    op.drop_table("photo_reports")
