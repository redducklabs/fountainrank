"""osm_fountain_import_runs.scope_bounds POLYGON -> MULTIPOLYGON

The bootstrap San Diego import stored a bbox rectangle (a single Polygon), so the column was
``geography(Polygon,4326)``. Real Geofabrik extract boundaries (e.g. California = mainland +
Channel Islands, and every continent) are MultiPolygons, so the PBF import path fails on insert
with "Geometry type (MultiPolygon) does not match column type (Polygon)". Widen the column to
``geography(MultiPolygon,4326)``; the Overpass path now emits a 1-part MultiPolygon rectangle so
both import paths agree with the column type.

Revision ID: 0013_scope_bounds_multipolygon
Revises: 0012_users_nickname
Create Date: 2026-07-01
"""

from alembic import op

revision = "0013_scope_bounds_multipolygon"
down_revision = "0012_users_nickname"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # ST_Multi promotes any existing Polygon to MultiPolygon; NULLs stay NULL.
    op.execute(
        "ALTER TABLE osm_fountain_import_runs "
        "ALTER COLUMN scope_bounds TYPE geography(MultiPolygon,4326) "
        "USING ST_Multi(scope_bounds::geometry)::geography(MultiPolygon,4326)"
    )


def downgrade() -> None:
    # Reverse to Polygon by taking the first polygon of each multipolygon (lossy for true
    # multi-part bounds; NULLs stay NULL).
    op.execute(
        "ALTER TABLE osm_fountain_import_runs "
        "ALTER COLUMN scope_bounds TYPE geography(Polygon,4326) "
        "USING ST_GeometryN(scope_bounds::geometry, 1)::geography(Polygon,4326)"
    )
