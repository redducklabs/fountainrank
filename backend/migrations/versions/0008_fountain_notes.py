"""notes/reviews: fountain_notes (one current note per user/fountain)

Revision ID: 0008_fountain_notes
Revises: 0007_condition_reports
Create Date: 2026-06-22
"""

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects.postgresql import UUID as PgUUID

revision = "0008_fountain_notes"
down_revision = "0007_condition_reports"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "fountain_notes",
        sa.Column("id", PgUUID(as_uuid=True), nullable=False),
        sa.Column("fountain_id", PgUUID(as_uuid=True), nullable=False),
        sa.Column("user_id", PgUUID(as_uuid=True), nullable=False),
        sa.Column("body", sa.String(), nullable=False),
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
        sa.PrimaryKeyConstraint("id", name="pk_fountain_notes"),
        sa.ForeignKeyConstraint(
            ["fountain_id"], ["fountains.id"], ondelete="CASCADE", name="fk_fountain_notes_fountain"
        ),
        sa.ForeignKeyConstraint(
            ["user_id"], ["users.id"], ondelete="CASCADE", name="fk_fountain_notes_user"
        ),
        sa.ForeignKeyConstraint(
            ["hidden_by_user_id"], ["users.id"], name="fk_fountain_notes_hidden_by"
        ),
        sa.UniqueConstraint("fountain_id", "user_id", name="uq_fountain_notes_fountain_id"),
    )
    # Partial index for the public (non-hidden) read path (spec §6.5).
    op.create_index(
        "ix_fountain_notes_fountain_visible",
        "fountain_notes",
        ["fountain_id"],
        postgresql_where=sa.text("is_hidden = false"),
    )


def downgrade() -> None:
    op.drop_index("ix_fountain_notes_fountain_visible", table_name="fountain_notes")
    op.drop_table("fountain_notes")
