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
    # DROP NOT NULL is metadata-only and independent of the FK, so the existing
    # ON DELETE CASCADE constraints are left in place: dropping and recreating them would
    # take ACCESS EXCLUSIVE and re-validate every row of the largest contribution tables.
    op.add_column(
        "ratings",
        sa.Column("deleted_actor_id", postgresql.UUID(as_uuid=True), nullable=True),
    )
    op.alter_column(
        "ratings", "user_id", existing_type=postgresql.UUID(as_uuid=True), nullable=True
    )

    op.add_column(
        "attribute_observations",
        sa.Column("deleted_actor_id", postgresql.UUID(as_uuid=True), nullable=True),
    )
    op.alter_column(
        "attribute_observations",
        "user_id",
        existing_type=postgresql.UUID(as_uuid=True),
        nullable=True,
    )

    op.add_column(
        "condition_reports",
        sa.Column("deleted_actor_id", postgresql.UUID(as_uuid=True), nullable=True),
    )
    op.alter_column(
        "condition_reports",
        "user_id",
        existing_type=postgresql.UUID(as_uuid=True),
        nullable=True,
    )

    # `reason` is the operator triage column on the storage-cleanup ledger; account deletion
    # is not moderation, so it gets its own value rather than borrowing 'moderation_delete'.
    # Both ops apply the ck naming convention, so they take the SHORT name (see app/models.py).
    op.drop_constraint("reason", "storage_cleanup", type_="check")
    op.create_check_constraint(
        "reason",
        "storage_cleanup",
        "reason IN ('upload_orphan','moderation_delete','account_delete')",
    )


def downgrade() -> None:
    # Destructive by necessity: the anonymized rows have no owner to restore, so restoring
    # NOT NULL means dropping the fountain signal contributed by deleted accounts.
    op.execute("DELETE FROM ratings WHERE user_id IS NULL")
    op.execute("DELETE FROM attribute_observations WHERE user_id IS NULL")
    op.execute("DELETE FROM condition_reports WHERE user_id IS NULL")

    op.execute("DELETE FROM storage_cleanup WHERE reason = 'account_delete'")
    op.drop_constraint("reason", "storage_cleanup", type_="check")
    op.create_check_constraint(
        "reason", "storage_cleanup", "reason IN ('upload_orphan','moderation_delete')"
    )

    op.alter_column(
        "condition_reports",
        "user_id",
        existing_type=postgresql.UUID(as_uuid=True),
        nullable=False,
    )
    op.drop_column("condition_reports", "deleted_actor_id")

    op.alter_column(
        "attribute_observations",
        "user_id",
        existing_type=postgresql.UUID(as_uuid=True),
        nullable=False,
    )
    op.drop_column("attribute_observations", "deleted_actor_id")

    op.alter_column(
        "ratings", "user_id", existing_type=postgresql.UUID(as_uuid=True), nullable=False
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
