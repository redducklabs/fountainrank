"""Add account sanctions and sanction audit events (#13).

Revision ID: 0030_account_sanctions
Revises: 0029_moderation_actions
Create Date: 2026-07-20
"""

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision = "0030_account_sanctions"
down_revision = "0029_moderation_actions"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "users",
        sa.Column("account_status", sa.String(), server_default="active", nullable=False),
    )
    op.add_column("users", sa.Column("suspended_until", sa.DateTime(timezone=True)))
    op.add_column("users", sa.Column("sanction_reason", sa.String(length=500)))
    op.add_column("users", sa.Column("sanctioned_at", sa.DateTime(timezone=True)))
    op.add_column("users", sa.Column("sanctioned_by_user_id", postgresql.UUID(as_uuid=True)))
    op.create_foreign_key(
        "fk_users_sanctioned_by",
        "users",
        "users",
        ["sanctioned_by_user_id"],
        ["id"],
        ondelete="SET NULL",
    )
    op.create_check_constraint(
        "account_status", "users", "account_status IN ('active','suspended','banned')"
    )
    op.create_check_constraint(
        "sanction_shape",
        "users",
        "(account_status = 'active' AND suspended_until IS NULL AND sanction_reason IS NULL "
        "AND sanctioned_at IS NULL AND sanctioned_by_user_id IS NULL) OR "
        "(account_status = 'banned' AND suspended_until IS NULL AND sanction_reason IS NOT NULL "
        "AND sanctioned_at IS NOT NULL) OR "
        "(account_status = 'suspended' AND suspended_until IS NOT NULL AND "
        "sanction_reason IS NOT NULL AND sanctioned_at IS NOT NULL)",
    )
    op.create_index(
        "ix_users_account_status_suspended_until",
        "users",
        ["account_status", "suspended_until"],
    )

    op.add_column(
        "moderation_actions",
        sa.Column("actor_kind", sa.String(), server_default="admin", nullable=False),
    )
    op.alter_column("moderation_actions", "admin_actor_id", nullable=True)
    op.drop_constraint("action", "moderation_actions", type_="check")
    op.drop_constraint("content_type", "moderation_actions", type_="check")
    op.create_check_constraint(
        "action",
        "moderation_actions",
        "action IN ('hide','unhide','dismiss','delete','rating_delete',"
        "'ban','suspend','unban','expire')",
    )
    op.create_check_constraint(
        "content_type",
        "moderation_actions",
        "content_type IN ('fountain','note','photo','rating','user')",
    )
    op.create_check_constraint(
        "actor_kind", "moderation_actions", "actor_kind IN ('admin','system')"
    )
    op.create_check_constraint(
        "actor_shape",
        "moderation_actions",
        "(actor_kind = 'admin' AND admin_actor_id IS NOT NULL) OR "
        "(actor_kind = 'system' AND admin_actor_id IS NULL)",
    )


def downgrade() -> None:
    connection = op.get_bind()
    sanction_rows = connection.scalar(
        sa.text(
            "SELECT EXISTS (SELECT 1 FROM moderation_actions "
            "WHERE content_type = 'user' OR action IN ('ban','suspend','unban','expire'))"
        )
    )
    if sanction_rows:
        raise RuntimeError("refusing to discard account-sanction audit history")

    op.drop_constraint("actor_shape", "moderation_actions", type_="check")
    op.drop_constraint("actor_kind", "moderation_actions", type_="check")
    op.drop_constraint("content_type", "moderation_actions", type_="check")
    op.drop_constraint("action", "moderation_actions", type_="check")
    op.create_check_constraint(
        "action",
        "moderation_actions",
        "action IN ('hide','unhide','dismiss','delete','rating_delete')",
    )
    op.create_check_constraint(
        "content_type",
        "moderation_actions",
        "content_type IN ('fountain','note','photo','rating')",
    )
    op.alter_column("moderation_actions", "admin_actor_id", nullable=False)
    op.drop_column("moderation_actions", "actor_kind")

    op.drop_index("ix_users_account_status_suspended_until", table_name="users")
    op.drop_constraint("sanction_shape", "users", type_="check")
    op.drop_constraint("account_status", "users", type_="check")
    op.drop_constraint("fk_users_sanctioned_by", "users", type_="foreignkey")
    op.drop_column("users", "sanctioned_by_user_id")
    op.drop_column("users", "sanctioned_at")
    op.drop_column("users", "sanction_reason")
    op.drop_column("users", "suspended_until")
    op.drop_column("users", "account_status")
