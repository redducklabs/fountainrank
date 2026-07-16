"""Index country-scoped place-kind membership lookups.

Revision ID: 0027_boundary_country_kind_idx
Revises: 0026_index_all_countries
Create Date: 2026-07-15

City parenting filters ``place_boundaries`` by both ``country_code`` and ``place_kind``. Without
this index, every country refresh scans nearly the entire growing table to find its city and country
rows. A normal transactional index build matches the existing migration runner and is proportionate
for this table's size.
"""

from alembic import op

revision = "0027_boundary_country_kind_idx"
down_revision = "0026_index_all_countries"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_index(
        "ix_place_boundaries_country_kind",
        "place_boundaries",
        ["country_code", "place_kind"],
    )


def downgrade() -> None:
    op.drop_index("ix_place_boundaries_country_kind", table_name="place_boundaries")
