"""operational status: condition_reports + fountains.current_status/last_verified_at

Revision ID: 0007_condition_reports
Revises: 0006_seed_attribute_types
Create Date: 2026-06-22
"""

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects.postgresql import UUID as PgUUID

revision = "0007_condition_reports"
down_revision = "0006_seed_attribute_types"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # 1) fountains: derived status columns (additive; NULL = fall back to baseline is_working).
    op.add_column("fountains", sa.Column("current_status", sa.String(), nullable=True))
    op.add_column(
        "fountains", sa.Column("last_verified_at", sa.DateTime(timezone=True), nullable=True)
    )
    # SHORT name — the env's ck convention renders it to ck_fountains_current_status.
    op.create_check_constraint(
        "current_status",
        "fountains",
        "current_status IS NULL OR "
        "current_status IN ('ok','reported_issue','degraded','not_working')",
    )

    # 2) condition_reports (append-only). Inline status CHECK uses the SHORT name.
    op.create_table(
        "condition_reports",
        sa.Column("id", PgUUID(as_uuid=True), nullable=False),
        sa.Column("fountain_id", PgUUID(as_uuid=True), nullable=False),
        sa.Column("user_id", PgUUID(as_uuid=True), nullable=False),
        sa.Column("status", sa.String(), nullable=False),
        sa.Column("is_proximate", sa.Boolean(), server_default=sa.text("false"), nullable=False),
        sa.Column("is_hidden", sa.Boolean(), server_default=sa.text("false"), nullable=False),
        sa.Column("hidden_by_user_id", PgUUID(as_uuid=True), nullable=True),
        sa.Column("hidden_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.CheckConstraint(
            "status IN ('working','broken','low_pressure','dirty','bad_taste',"
            "'blocked','seasonal_unavailable','hours_limited')",
            name="status",
        ),
        sa.PrimaryKeyConstraint("id", name="pk_condition_reports"),
        sa.ForeignKeyConstraint(
            ["fountain_id"],
            ["fountains.id"],
            ondelete="CASCADE",
            name="fk_condition_reports_fountain",
        ),
        sa.ForeignKeyConstraint(
            ["user_id"], ["users.id"], ondelete="CASCADE", name="fk_condition_reports_user"
        ),
        sa.ForeignKeyConstraint(
            ["hidden_by_user_id"], ["users.id"], name="fk_condition_reports_hidden_by"
        ),
    )
    op.create_index(
        "ix_condition_reports_fountain_created",
        "condition_reports",
        ["fountain_id", "created_at"],
    )


def downgrade() -> None:
    op.drop_index("ix_condition_reports_fountain_created", table_name="condition_reports")
    op.drop_table("condition_reports")
    op.drop_constraint("ck_fountains_current_status", "fountains", type_="check")
    op.drop_column("fountains", "last_verified_at")
    op.drop_column("fountains", "current_status")
