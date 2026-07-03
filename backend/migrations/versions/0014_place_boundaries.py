"""place_boundaries: admin/place boundary polygons for crawlable SEO pages (#127)

Slice 1a of docs/plans/2026-07-02-crawlable-seo-pages.md. New table, loaded (Slice 1b/1c)
from Overture Divisions ``division_area`` — see spec §11. Identity is the Overture GERS
``overture_id`` (unique); the city tier is a ``subtype`` (Overture ``admin_level`` is
normalized, not OSM's, so it is nullable/informational); ``osm_type``/``osm_id`` are nullable
best-effort provenance; ``boundary`` is ``geography(MultiPolygon,4326)`` (loader
ST_Multi-coerces). Public-namespace uniqueness is a PARTIAL unique index on
``(country_code, slug) WHERE is_canonical`` — matching the public URL, which omits
``admin_level``/``subtype``.

Revision ID: 0014_place_boundaries
Revises: 0013_scope_bounds_multipolygon
Create Date: 2026-07-02
"""

import geoalchemy2
import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects.postgresql import UUID as PgUUID

revision = "0014_place_boundaries"
down_revision = "0013_scope_bounds_multipolygon"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "place_boundaries",
        sa.Column("id", PgUUID(as_uuid=True), nullable=False),
        sa.Column("overture_id", sa.String(), nullable=False),
        sa.Column("subtype", sa.String(), nullable=False),
        # `class` matches the Overture field; the ORM attribute is `place_class` (keyword).
        sa.Column("class", sa.String(), nullable=False),
        sa.Column("admin_level", sa.SmallInteger(), nullable=True),
        sa.Column("osm_type", sa.String(), nullable=True),
        sa.Column("osm_id", sa.BigInteger(), nullable=True),
        sa.Column("name", sa.String(), nullable=False),
        sa.Column("country_code", sa.String(), nullable=False),
        sa.Column("slug", sa.String(), nullable=False),
        sa.Column("is_canonical", sa.Boolean(), server_default=sa.text("false"), nullable=False),
        sa.Column("parent_id", PgUUID(as_uuid=True), nullable=True),
        sa.Column(
            "boundary",
            geoalchemy2.types.Geography(
                geometry_type="MULTIPOLYGON",
                srid=4326,
                from_text="ST_GeogFromText",
                name="geography",
            ),
            nullable=False,
        ),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.PrimaryKeyConstraint("id", name="pk_place_boundaries"),
        sa.UniqueConstraint("overture_id", name="uq_place_boundaries_overture_id"),
        # Self-referential parent link (city -> country), containment-derived in Slice 1d.
        sa.ForeignKeyConstraint(
            ["parent_id"],
            ["place_boundaries.id"],
            ondelete="SET NULL",
            name="fk_place_boundaries_parent",
        ),
    )
    # GeoAlchemy2's Geography column (spatial_index defaults True) auto-creates the GiST index
    # idx_place_boundaries_boundary as part of create_table above; no explicit op.create_index
    # is needed, and alembic_helpers.include_object filters it from `alembic check`.
    op.create_index(
        "uq_place_boundaries_country_slug_canonical",
        "place_boundaries",
        ["country_code", "slug"],
        unique=True,
        postgresql_where=sa.text("is_canonical"),
    )


def downgrade() -> None:
    op.drop_index("uq_place_boundaries_country_slug_canonical", table_name="place_boundaries")
    # idx_place_boundaries_boundary (the GiST spatial index) is dropped automatically with
    # the table.
    op.drop_table("place_boundaries")
