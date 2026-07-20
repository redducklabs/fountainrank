"""Add the append-only moderation action audit trail (#216).

Revision ID: 0029_moderation_actions
Revises: 0028_boundary_area
Create Date: 2026-07-20
"""

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision = "0029_moderation_actions"
down_revision = "0028_boundary_area"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "moderation_actions",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("admin_user_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("admin_actor_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("action", sa.String(), nullable=False),
        sa.Column("content_type", sa.String(), nullable=False),
        sa.Column("content_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("fountain_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("reason", sa.String(length=500), nullable=True),
        sa.Column("details", postgresql.JSONB(astext_type=sa.Text()), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.CheckConstraint(
            "action IN ('hide','unhide','dismiss','delete','rating_delete')", name="action"
        ),
        sa.CheckConstraint(
            "content_type IN ('fountain','note','photo','rating')", name="content_type"
        ),
        sa.ForeignKeyConstraint(
            ["admin_user_id"],
            ["users.id"],
            name="fk_moderation_actions_admin",
            ondelete="SET NULL",
        ),
        sa.ForeignKeyConstraint(
            ["fountain_id"],
            ["fountains.id"],
            name="fk_moderation_actions_fountain",
            ondelete="SET NULL",
        ),
        sa.PrimaryKeyConstraint("id", name="pk_moderation_actions"),
    )
    op.create_index(
        "ix_moderation_actions_target",
        "moderation_actions",
        ["content_type", "content_id", "created_at"],
    )
    op.create_index(
        "ix_moderation_actions_admin_created",
        "moderation_actions",
        ["admin_user_id", "created_at"],
    )
    op.create_index(
        "ix_moderation_actions_fountain_created",
        "moderation_actions",
        ["fountain_id", "created_at"],
    )


def downgrade() -> None:
    op.drop_index("ix_moderation_actions_fountain_created", table_name="moderation_actions")
    op.drop_index("ix_moderation_actions_admin_created", table_name="moderation_actions")
    op.drop_index("ix_moderation_actions_target", table_name="moderation_actions")
    op.drop_table("moderation_actions")
