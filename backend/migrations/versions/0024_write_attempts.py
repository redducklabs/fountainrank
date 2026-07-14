"""durable authenticated write-attempt ledger

Revision ID: 0024_write_attempts
Revises: 0023_ratings_is_proximate
Create Date: 2026-07-13
"""

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision = "0024_write_attempts"
down_revision = "0023_ratings_is_proximate"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "write_attempts",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("user_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("budget", sa.String(length=32), nullable=False),
        sa.Column("endpoint", sa.String(length=32), nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.CheckConstraint("budget IN ('contribution_write','profile_sync')", name="rate_budget"),
        sa.CheckConstraint(
            "endpoint IN ('fountain_create','rating_submit','attribute_submit',"
            "'condition_submit','note_submit','profile_sync')",
            name="rate_endpoint",
        ),
        sa.ForeignKeyConstraint(
            ["user_id"],
            ["users.id"],
            name="fk_write_attempts_user",
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("id", name="pk_write_attempts"),
    )
    op.create_index(
        "ix_write_attempts_user_budget_created",
        "write_attempts",
        ["user_id", "budget", "created_at"],
    )
    op.create_index("ix_write_attempts_created_at", "write_attempts", ["created_at"])


def downgrade() -> None:
    op.drop_table("write_attempts")
