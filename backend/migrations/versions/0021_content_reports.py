"""content reports: polymorphic content_reports replaces photo_reports (#11)

Revision ID: 0021_content_reports
Revises: 0020_condition_award_window
Create Date: 2026-07-06
"""

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects.postgresql import UUID as PgUUID

revision = "0021_content_reports"
down_revision = "0020_condition_award_window"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Polymorphic content_reports (#11, spec §3.1): replaces photo_reports. content_id is a
    # SOFT reference (no per-type FK — targets span tables); integrity is enforced in the
    # report chokepoint (app/reports.py) and by the fountain_id CASCADE.
    op.create_table(
        "content_reports",
        sa.Column("id", PgUUID(as_uuid=True), nullable=False),
        sa.Column("content_type", sa.String(), nullable=False),
        sa.Column("content_id", PgUUID(as_uuid=True), nullable=False),
        sa.Column("fountain_id", PgUUID(as_uuid=True), nullable=False),
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
        sa.CheckConstraint("content_type IN ('photo','note','fountain')", name="content_type"),
        sa.CheckConstraint(
            "category IN ('spam','abuse','inappropriate','not_a_fountain','inaccurate','other')",
            name="category",
        ),
        sa.CheckConstraint("status IN ('pending','resolved')", name="status"),
        sa.CheckConstraint("resolution IN ('hidden','rejected')", name="resolution"),
        sa.PrimaryKeyConstraint("id", name="pk_content_reports"),
        sa.ForeignKeyConstraint(
            ["fountain_id"],
            ["fountains.id"],
            ondelete="CASCADE",
            name="fk_content_reports_fountain",
        ),
        sa.ForeignKeyConstraint(
            ["reporter_user_id"],
            ["users.id"],
            ondelete="CASCADE",
            name="fk_content_reports_reporter",
        ),
        sa.ForeignKeyConstraint(
            ["resolved_by_user_id"], ["users.id"], name="fk_content_reports_resolved_by"
        ),
    )
    # One pending report per (content_type, content_id, reporter); re-report after resolution.
    op.create_index(
        "uq_content_reports_target_reporter_pending",
        "content_reports",
        ["content_type", "content_id", "reporter_user_id"],
        unique=True,
        postgresql_where=sa.text("status = 'pending'"),
    )
    # Per-item pending count for the queue/badge.
    op.create_index(
        "ix_content_reports_target_pending",
        "content_reports",
        ["content_type", "content_id"],
        postgresql_where=sa.text("status = 'pending'"),
    )
    # Reporter rate-limit count (non-partial: counts a reporter's reports across all statuses).
    op.create_index(
        "ix_content_reports_reporter_created",
        "content_reports",
        ["reporter_user_id", "created_at"],
    )
    # Data-migrate existing photo reports (join fountain_photos for fountain_id), reusing ids
    # (reports are leaf rows; nothing dangling references them).
    op.execute(
        """
        INSERT INTO content_reports
          (id, content_type, content_id, fountain_id, reporter_user_id, category, note,
           status, resolution, resolved_by_user_id, resolved_at, created_at)
        SELECT pr.id, 'photo', pr.photo_id, fp.fountain_id, pr.reporter_user_id, pr.category,
               pr.note, pr.status, pr.resolution, pr.resolved_by_user_id, pr.resolved_at,
               pr.created_at
        FROM photo_reports pr JOIN fountain_photos fp ON fp.id = pr.photo_id
        """
    )
    op.drop_table("photo_reports")


def downgrade() -> None:
    # Recreate photo_reports verbatim from 0019_photo_reports (table + its 3 indexes).
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
    op.create_index(
        "uq_photo_reports_photo_reporter_pending",
        "photo_reports",
        ["photo_id", "reporter_user_id"],
        unique=True,
        postgresql_where=sa.text("status = 'pending'"),
    )
    op.create_index(
        "ix_photo_reports_photo_pending",
        "photo_reports",
        ["photo_id"],
        postgresql_where=sa.text("status = 'pending'"),
    )
    op.create_index(
        "ix_photo_reports_reporter_pending_created",
        "photo_reports",
        ["reporter_user_id", "created_at"],
        postgresql_where=sa.text("status = 'pending'"),
    )
    # Copy the photo rows back; note/fountain reports have no home in photo_reports and are
    # dropped (documented data loss on downgrade — spec §4).
    op.execute(
        """
        INSERT INTO photo_reports
          (id, photo_id, reporter_user_id, category, note, status, resolution,
           resolved_by_user_id, resolved_at, created_at)
        SELECT id, content_id, reporter_user_id, category, note, status, resolution,
               resolved_by_user_id, resolved_at, created_at
        FROM content_reports WHERE content_type = 'photo'
        """
    )
    op.drop_table("content_reports")
