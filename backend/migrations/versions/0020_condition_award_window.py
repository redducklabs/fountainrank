"""condition award window partial index (#124 repeat-contribution point limit)

Revision ID: 0020_condition_award_window
Revises: 0019_photo_reports
Create Date: 2026-07-04
"""

import sqlalchemy as sa
from alembic import op

revision = "0020_condition_award_window"
down_revision = "0019_photo_reports"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_index(
        "ix_contribution_events_condition_window",
        "contribution_events",
        ["user_id", "fountain_id", "created_at"],
        postgresql_where=sa.text(
            "status = 'awarded' AND event_type IN ('verify_working', 'report_condition')"
        ),
    )


def downgrade() -> None:
    op.drop_index(
        "ix_contribution_events_condition_window",
        table_name="contribution_events",
    )
