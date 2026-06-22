"""contribution_events location GiST index (local contributor leaderboard)

Revision ID: 0010_contrib_location_gist
Revises: 0009_access_context
Create Date: 2026-06-22
"""

from alembic import op

revision = "0010_contrib_location_gist"
down_revision = "0009_access_context"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # GeoAlchemy convention name (matches idx_fountains_location); the model column flips to
    # spatial_index=True so reflection + alembic_helpers agree (no drift).
    op.create_index(
        "idx_contribution_events_location",
        "contribution_events",
        ["location"],
        postgresql_using="gist",
    )


def downgrade() -> None:
    op.drop_index("idx_contribution_events_location", table_name="contribution_events")
