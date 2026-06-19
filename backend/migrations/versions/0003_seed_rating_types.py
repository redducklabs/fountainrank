"""seed rating types: Clarity, Taste, Pressure, Appearance

Revision ID: 0003_seed_rating_types
Revises: 0002_phase1_core_schema
Create Date: 2026-06-18
"""

import sqlalchemy as sa
from alembic import op

revision = "0003_seed_rating_types"
down_revision = "0002_phase1_core_schema"
branch_labels = None
depends_on = None

_RATING_TYPES = (
    (1, "Clarity", "How clear and clean the water looks", 1),
    (2, "Taste", "How the water tastes", 2),
    (3, "Pressure", "Water pressure / flow strength", 3),
    (4, "Appearance", "Condition and cleanliness of the fountain", 4),
)


def upgrade() -> None:
    rating_types = sa.table(
        "rating_types",
        sa.column("id", sa.SmallInteger),
        sa.column("name", sa.String),
        sa.column("description", sa.String),
        sa.column("sort_order", sa.Integer),
    )
    op.bulk_insert(
        rating_types,
        [{"id": i, "name": n, "description": d, "sort_order": s} for (i, n, d, s) in _RATING_TYPES],
    )


def downgrade() -> None:
    op.execute("DELETE FROM rating_types WHERE id IN (1, 2, 3, 4)")
