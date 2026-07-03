"""place_boundary_cells: subdivided boundary pieces for fast point-in-polygon (#127)

Perf hardening of Slice 1d membership (docs/plans/2026-07-02-crawlable-seo-pages.md).
``refresh_all_memberships`` did a per-fountain ``ST_Covers`` against whole ``place_boundaries``
polygons; at country scale the US country polygon is ~136k vertices and its bounding box covers
every fountain, so the GiST prefilter prunes nothing and each of ~50k fountains runs an exact
point-in-polygon against a 136k-vertex polygon — the country-scale backfill ran 40+ min and an
isolated country match timed out at >180s.

This table stores every boundary broken into small ``ST_Subdivide`` cells (the canonical PostGIS
pattern for point-in-huge-polygon at scale): a point-in-polygon probe hits a GiST index of small
cells instead of one giant polygon, so it is fast regardless of the source polygon's vertex count
(measured on prod: >180s -> 7.4s). Membership assignment (``app/membership.py``) joins fountains ->
cells -> ``place_boundaries`` by ``place_id``.

- ``place_id`` FK -> ``place_boundaries`` ``ON DELETE CASCADE`` (dropping a boundary drops its
  cells).
- ``geom`` ``geometry(Geometry,4326)`` — the subdivided piece, tested in PLANAR (geometry) space
  (``ST_Covers(geom, location::geometry)``): planar containment is correct for lon/lat point-in-
  polygon and avoids geography overhead. GiST-indexed (GeoAlchemy2 auto-creates
  ``idx_place_boundary_cells_geom``).
- The table is a rebuildable derivative of ``place_boundaries`` (fully replaced on every boundary
  load / membership backfill by ``app.membership.rebuild_place_boundary_cells``), so the migration
  creates it EMPTY — the first operator backfill populates it.

Revision ID: 0016_place_boundary_cells
Revises: 0015_fountain_membership
Create Date: 2026-07-03
"""

import geoalchemy2
import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects.postgresql import UUID as PgUUID

revision = "0016_place_boundary_cells"
down_revision = "0015_fountain_membership"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "place_boundary_cells",
        sa.Column("id", PgUUID(as_uuid=True), nullable=False),
        sa.Column("place_id", PgUUID(as_uuid=True), nullable=False),
        sa.Column(
            "geom",
            geoalchemy2.types.Geometry(geometry_type="GEOMETRY", srid=4326),
            nullable=False,
        ),
        sa.PrimaryKeyConstraint("id", name="pk_place_boundary_cells"),
        sa.ForeignKeyConstraint(
            ["place_id"],
            ["place_boundaries.id"],
            ondelete="CASCADE",
            name="fk_place_boundary_cells_place",
        ),
    )
    # GeoAlchemy2's Geometry column (spatial_index defaults True) auto-creates the GiST index
    # idx_place_boundary_cells_geom as part of create_table above; no explicit op.create_index is
    # needed, and alembic_helpers.include_object filters it from `alembic check`.
    op.create_index("ix_place_boundary_cells_place_id", "place_boundary_cells", ["place_id"])


def downgrade() -> None:
    op.drop_index("ix_place_boundary_cells_place_id", table_name="place_boundary_cells")
    # idx_place_boundary_cells_geom (the GiST spatial index) drops automatically with the table.
    op.drop_table("place_boundary_cells")
