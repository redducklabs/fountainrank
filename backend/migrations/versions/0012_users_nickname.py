"""users.nickname (user-set display-name override) — kill "Anonymous"

Adds a nullable ``users.nickname``. When set it overrides the IdP-synced
``display_name`` on every public surface (leaderboard, notes); the synced
``display_name`` is kept intact as the fallback. No index (never queried by
nickname) and no CHECK (length/shape validated in the app, mirroring
``display_name``). No backfill.

Revision ID: 0012_users_nickname
Revises: 0011_fountains_geometry_gist
Create Date: 2026-06-30
"""

import sqlalchemy as sa
from alembic import op

revision = "0012_users_nickname"
down_revision = "0011_fountains_geometry_gist"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("users", sa.Column("nickname", sa.String(), nullable=True))


def downgrade() -> None:
    op.drop_column("users", "nickname")
