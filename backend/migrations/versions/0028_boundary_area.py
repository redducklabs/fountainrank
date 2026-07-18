"""Precompute place_boundaries.boundary_area for the membership order-bys.

Revision ID: 0028_boundary_area
Revises: 0027_boundary_country_kind_idx
Create Date: 2026-07-18

The membership "smallest/largest covering place" order-bys recompute ST_Area(boundary) — a geodesic
area over large region multipolygons — once per candidate. The city-parent step recomputes it once
per city (37k cities over ~13 regions for a country like FR), a per-load hotspot. Store the area as
a column, populated by the loader on write and read via COALESCE(boundary_area, ST_Area(boundary)).

Nullable + NO backfill: a plain metadata-only ADD COLUMN takes no table rewrite / long lock on the
live table, and the COALESCE fallback keeps ordering correct for any row written before this column
existed. Newly (re)loaded boundaries populate it on insert. Backfilling already-loaded countries is
an optional, separately-batched follow-up (they are loaded; only future refreshes benefit).
"""

import sqlalchemy as sa
from alembic import op

revision = "0028_boundary_area"
down_revision = "0027_boundary_country_kind_idx"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "place_boundaries",
        sa.Column("boundary_area", sa.Double(), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("place_boundaries", "boundary_area")
