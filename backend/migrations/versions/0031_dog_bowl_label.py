"""Rename the lower-spout attribute display metadata to Dog bowl (#279).

Revision ID: 0031_dog_bowl_label
Revises: 0030_account_sanctions
Create Date: 2026-07-25
"""

from alembic import op

revision = "0031_dog_bowl_label"
down_revision = "0030_account_sanctions"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute(
        "UPDATE attribute_types "
        "SET name = 'Dog bowl', description = 'Has a dog-accessible drinking bowl' "
        "WHERE id = 3 AND key = 'lower_spout'"
    )


def downgrade() -> None:
    op.execute(
        "UPDATE attribute_types "
        "SET name = 'Lower spout', description = 'Has a lower / accessible spout' "
        "WHERE id = 3 AND key = 'lower_spout'"
    )
