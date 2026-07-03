"""fountain membership: place linkage + counts + scope config (#127 Slice 1d)

Slice 1d of docs/plans/2026-07-02-crawlable-seo-pages.md. Precomputed membership so the public
place pages never run a live ``ST_Covers`` (spec §5/§11.5):

- ``fountains.country_place_id`` / ``city_place_id`` — nullable FK -> ``place_boundaries`` (ON
  DELETE SET NULL), each btree-indexed (the public city read path filters on ``city_place_id``).
- ``place_boundaries.fountain_count`` — denormalized non-hidden count (the public "N fountains"
  number + the >= K indexability gate).
- ``place_scope_config`` — per-country eligible city subtypes for the assignment ladder (spec
  §11.5). Seeded for the active boundary scopes: ``us`` = {locality, localadmin}, ``lu`` =
  {locality, localadmin, county} (LU's municipal tier is ``subtype='county'`` communes). The code
  default for an unseeded country is {locality, localadmin}, so the ``us`` row is explicit-but-
  redundant on purpose (an owner edit point).

Revision ID: 0015_fountain_membership
Revises: 0014_place_boundaries
Create Date: 2026-07-03
"""

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects.postgresql import ARRAY
from sqlalchemy.dialects.postgresql import UUID as PgUUID

revision = "0015_fountain_membership"
down_revision = "0014_place_boundaries"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Per-country eligible city subtypes (spec §11.5) — the ladder's eligible set.
    op.create_table(
        "place_scope_config",
        sa.Column("country_code", sa.String(), nullable=False),
        sa.Column("eligible_city_subtypes", ARRAY(sa.String()), nullable=False),
        sa.PrimaryKeyConstraint("country_code", name="pk_place_scope_config"),
    )
    op.bulk_insert(
        sa.table(
            "place_scope_config",
            sa.column("country_code", sa.String()),
            sa.column("eligible_city_subtypes", ARRAY(sa.String())),
        ),
        [
            {"country_code": "us", "eligible_city_subtypes": ["locality", "localadmin"]},
            {"country_code": "lu", "eligible_city_subtypes": ["locality", "localadmin", "county"]},
        ],
    )

    # Denormalized non-hidden fountain count per place. server_default 0 backfills existing rows
    # (place_boundaries already holds LU + US in prod) — membership refresh sets the real values.
    op.add_column(
        "place_boundaries",
        sa.Column("fountain_count", sa.Integer(), server_default=sa.text("0"), nullable=False),
    )

    # Precomputed membership FKs on fountains (nullable; SET NULL so a boundary refresh that drops
    # a place never deletes its fountains).
    op.add_column("fountains", sa.Column("country_place_id", PgUUID(as_uuid=True), nullable=True))
    op.add_column("fountains", sa.Column("city_place_id", PgUUID(as_uuid=True), nullable=True))
    op.create_foreign_key(
        "fk_fountains_country_place",
        "fountains",
        "place_boundaries",
        ["country_place_id"],
        ["id"],
        ondelete="SET NULL",
    )
    op.create_foreign_key(
        "fk_fountains_city_place",
        "fountains",
        "place_boundaries",
        ["city_place_id"],
        ["id"],
        ondelete="SET NULL",
    )
    op.create_index("ix_fountains_country_place_id", "fountains", ["country_place_id"])
    op.create_index("ix_fountains_city_place_id", "fountains", ["city_place_id"])


def downgrade() -> None:
    op.drop_index("ix_fountains_city_place_id", table_name="fountains")
    op.drop_index("ix_fountains_country_place_id", table_name="fountains")
    op.drop_constraint("fk_fountains_city_place", "fountains", type_="foreignkey")
    op.drop_constraint("fk_fountains_country_place", "fountains", type_="foreignkey")
    op.drop_column("fountains", "city_place_id")
    op.drop_column("fountains", "country_place_id")
    op.drop_column("place_boundaries", "fountain_count")
    op.drop_table("place_scope_config")
