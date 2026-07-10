"""ratings.is_proximate — server-computed proximity trust signal (#3)

Additive boolean, NOT NULL DEFAULT false. Monotonic in the application layer (see
_upsert_ratings): once true it never downgrades. false means "no coordinates asserted",
never "far away" (out-of-radius ratings are rejected before insert). Spec §4.5.

Revision ID: 0023_ratings_is_proximate
Revises: 0022_account_deletion
Create Date: 2026-07-10
"""

import sqlalchemy as sa
from alembic import op

revision = "0023_ratings_is_proximate"
down_revision = "0022_account_deletion"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "ratings",
        sa.Column(
            "is_proximate",
            sa.Boolean(),
            nullable=False,
            server_default=sa.false(),
        ),
    )


def downgrade() -> None:
    op.drop_column("ratings", "is_proximate")
