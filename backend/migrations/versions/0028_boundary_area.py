"""Precompute place_boundaries.boundary_area for the membership order-bys.

Revision ID: 0028_boundary_area
Revises: 0027_boundary_country_kind_idx
Create Date: 2026-07-18

The membership "smallest/largest covering place" order-bys recompute ST_Area(boundary) — a geodesic
area over large region multipolygons — once per candidate. The city-parent step recomputes it once
per city (37k cities over ~13 regions for a country like FR), a per-load hotspot. Store the area as
a column, populated by the loader on write and read via COALESCE(boundary_area, ST_Area(boundary)).

Nullable + NO backfill: a nullable ADD COLUMN is metadata-only (rewrite-free) — it does NOT rewrite
the 248k rows — and the COALESCE fallback keeps ordering correct for any row written before this
column existed. Newly (re)loaded boundaries populate it on insert. Backfilling already-loaded
countries is an optional, separately-batched follow-up (they are loaded; only future refreshes
benefit).

It is rewrite-free but NOT lock-free: ADD COLUMN still briefly takes ACCESS EXCLUSIVE, and while
that request is queued behind a conflicting long transaction it would block ordinary reads. Deploys
run migrations with no loader in flight (loader-runbook rule), so the lock is normally free and the
ALTER is near-instant; a short lock_timeout bounds the blast radius if that assumption is ever
violated — the migration fails loudly (retry in a quiet window) instead of stalling live reads.
"""

import sqlalchemy as sa
from alembic import op

revision = "0028_boundary_area"
down_revision = "0027_boundary_country_kind_idx"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Bound the ACCESS EXCLUSIVE acquisition: if a conflicting long transaction holds the table,
    # fail the deploy fast rather than queue live reads behind an unbounded lock wait. SET LOCAL is
    # scoped to alembic's migration transaction and resets on commit.
    op.execute("SET LOCAL lock_timeout = '3s'")
    op.add_column(
        "place_boundaries",
        sa.Column("boundary_area", sa.Double(), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("place_boundaries", "boundary_area")
