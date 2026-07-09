"""account deletion: anonymize retained fountain signal

Revision ID: 0022_account_deletion
Revises: 0021_content_reports
Create Date: 2026-07-09
"""

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision = "0022_account_deletion"
down_revision = "0021_content_reports"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "deleted_accounts",
        sa.Column("logto_user_id", sa.String(), nullable=False),
        sa.Column(
            "identity_delete_status",
            sa.String(),
            server_default=sa.text("'pending'"),
            nullable=False,
        ),
        sa.Column(
            "identity_delete_attempts",
            sa.Integer(),
            server_default=sa.text("0"),
            nullable=False,
        ),
        sa.Column("identity_delete_last_attempt_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("identity_delete_error", sa.String(), nullable=True),
        sa.Column(
            "deleted_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.CheckConstraint("identity_delete_status IN ('pending','done')", name="identity_status"),
        sa.PrimaryKeyConstraint("logto_user_id", name="pk_deleted_accounts"),
    )
    op.create_index(
        "ix_deleted_accounts_identity_pending",
        "deleted_accounts",
        ["deleted_at"],
        postgresql_where=sa.text("identity_delete_status = 'pending'"),
    )
    # User-added fountains must survive account deletion. Preserve created_source='user'
    # and clear only the owner pointer.
    op.execute("ALTER TABLE fountains DROP CONSTRAINT ck_fountains_user_source_requires_user")
    op.add_column(
        "ratings",
        sa.Column("deleted_actor_id", postgresql.UUID(as_uuid=True), nullable=True),
    )
    op.drop_constraint("fk_ratings_user_id_users", "ratings", type_="foreignkey")
    op.alter_column(
        "ratings", "user_id", existing_type=postgresql.UUID(as_uuid=True), nullable=True
    )
    op.create_foreign_key(
        "fk_ratings_user_id_users",
        "ratings",
        "users",
        ["user_id"],
        ["id"],
        ondelete="CASCADE",
    )

    op.add_column(
        "attribute_observations",
        sa.Column("deleted_actor_id", postgresql.UUID(as_uuid=True), nullable=True),
    )
    op.drop_constraint(
        "fk_attribute_observations_user", "attribute_observations", type_="foreignkey"
    )
    op.alter_column(
        "attribute_observations",
        "user_id",
        existing_type=postgresql.UUID(as_uuid=True),
        nullable=True,
    )
    op.create_foreign_key(
        "fk_attribute_observations_user",
        "attribute_observations",
        "users",
        ["user_id"],
        ["id"],
        ondelete="CASCADE",
    )

    op.add_column(
        "condition_reports",
        sa.Column("deleted_actor_id", postgresql.UUID(as_uuid=True), nullable=True),
    )
    op.drop_constraint("fk_condition_reports_user", "condition_reports", type_="foreignkey")
    op.alter_column(
        "condition_reports",
        "user_id",
        existing_type=postgresql.UUID(as_uuid=True),
        nullable=True,
    )
    op.create_foreign_key(
        "fk_condition_reports_user",
        "condition_reports",
        "users",
        ["user_id"],
        ["id"],
        ondelete="CASCADE",
    )


def downgrade() -> None:
    op.execute("DELETE FROM ratings WHERE user_id IS NULL")
    op.execute("DELETE FROM attribute_observations WHERE user_id IS NULL")
    op.execute("DELETE FROM condition_reports WHERE user_id IS NULL")

    op.drop_constraint("fk_condition_reports_user", "condition_reports", type_="foreignkey")
    op.alter_column(
        "condition_reports",
        "user_id",
        existing_type=postgresql.UUID(as_uuid=True),
        nullable=False,
    )
    op.create_foreign_key(
        "fk_condition_reports_user",
        "condition_reports",
        "users",
        ["user_id"],
        ["id"],
        ondelete="CASCADE",
    )
    op.drop_column("condition_reports", "deleted_actor_id")

    op.drop_constraint(
        "fk_attribute_observations_user", "attribute_observations", type_="foreignkey"
    )
    op.alter_column(
        "attribute_observations",
        "user_id",
        existing_type=postgresql.UUID(as_uuid=True),
        nullable=False,
    )
    op.create_foreign_key(
        "fk_attribute_observations_user",
        "attribute_observations",
        "users",
        ["user_id"],
        ["id"],
        ondelete="CASCADE",
    )
    op.drop_column("attribute_observations", "deleted_actor_id")

    op.drop_constraint("fk_ratings_user_id_users", "ratings", type_="foreignkey")
    op.alter_column(
        "ratings", "user_id", existing_type=postgresql.UUID(as_uuid=True), nullable=False
    )
    op.create_foreign_key(
        "fk_ratings_user_id_users",
        "ratings",
        "users",
        ["user_id"],
        ["id"],
        ondelete="CASCADE",
    )
    op.drop_column("ratings", "deleted_actor_id")

    op.execute("DELETE FROM fountains WHERE created_source = 'user' AND added_by_user_id IS NULL")
    op.create_check_constraint(
        "user_source_requires_user",
        "fountains",
        "created_source <> 'user' OR added_by_user_id IS NOT NULL",
    )
    op.drop_index("ix_deleted_accounts_identity_pending", table_name="deleted_accounts")
    op.drop_table("deleted_accounts")
