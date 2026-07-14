"""place hierarchy drilldown schema and frozen backfill

Revision ID: 0025_place_hierarchy
Revises: 0024_write_attempts
Create Date: 2026-07-14

This migration skips rebuilding ``place_boundary_cells`` because it changes only hierarchy
classification and membership columns, not boundary geometry. The fail-closed preflight below makes
that skip safe for committed boundaries whose cells exist. It proves only cell presence, not
geometric freshness; stale cells still require an operator-triggered cell rebuild before deploy.
"""

from pathlib import Path

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects.postgresql import ARRAY
from sqlalchemy.dialects.postgresql import UUID as PgUUID

revision = "0025_place_hierarchy"
down_revision = "0024_write_attempts"
branch_labels = None
depends_on = None


def _execute_sql_file(filename: str) -> None:
    sql_path = Path(__file__).resolve().parents[1] / "sql" / filename
    for statement in sql_path.read_text(encoding="utf-8").split(";"):
        if statement.strip():
            op.execute(statement)


def _assert_boundary_cells_present() -> None:
    bind = op.get_bind()
    missing = bind.execute(
        sa.text(
            """
            SELECT count(*)
            FROM place_boundaries pb
            WHERE NOT EXISTS (
                SELECT 1 FROM place_boundary_cells cell WHERE cell.place_id = pb.id
            )
            """
        )
    ).scalar_one()
    if missing:
        raise RuntimeError(
            "place hierarchy backfill aborted: place_boundaries exist without "
            "place_boundary_cells. Rebuild cells from the current image, then re-deploy."
        )


def upgrade() -> None:
    op.add_column(
        "place_scope_config",
        sa.Column(
            "eligible_region_subtypes",
            ARRAY(sa.String()),
            server_default=sa.text("'{region}'"),
            nullable=False,
        ),
    )
    op.execute(
        """
        UPDATE place_scope_config
        SET eligible_region_subtypes = CASE
            WHEN country_code = 'lu' THEN ARRAY[]::text[]
            ELSE ARRAY['region']::text[]
        END
        """
    )
    op.create_check_constraint(
        op.f("ck_place_scope_config_tiers_disjoint"),
        "place_scope_config",
        "NOT (eligible_city_subtypes && eligible_region_subtypes)",
    )

    op.add_column("place_boundaries", sa.Column("place_kind", sa.String(), nullable=True))
    op.add_column("fountains", sa.Column("region_place_id", PgUUID(as_uuid=True), nullable=True))
    op.create_foreign_key(
        "fk_fountains_region_place",
        "fountains",
        "place_boundaries",
        ["region_place_id"],
        ["id"],
        ondelete="SET NULL",
    )
    op.create_index("ix_fountains_region_place_id", "fountains", ["region_place_id"])

    op.drop_index("uq_place_boundaries_country_slug_canonical", table_name="place_boundaries")
    op.create_index(
        "uq_place_boundaries_region_canonical",
        "place_boundaries",
        ["country_code", "slug"],
        unique=True,
        postgresql_where=sa.text("is_canonical AND place_kind = 'region'"),
    )
    op.create_index(
        "uq_place_boundaries_city_canonical",
        "place_boundaries",
        ["country_code", "parent_id", "slug"],
        unique=True,
        postgresql_where=sa.text("is_canonical AND place_kind = 'city'"),
    )

    _assert_boundary_cells_present()
    _execute_sql_file("0025_backfill.sql")


def downgrade() -> None:
    # Reconstruct the old flat city model before removing hierarchy columns/indexes.
    op.drop_index("uq_place_boundaries_city_canonical", table_name="place_boundaries")
    op.drop_index("uq_place_boundaries_region_canonical", table_name="place_boundaries")

    op.execute("UPDATE place_boundaries SET is_canonical = false WHERE is_canonical")
    op.execute(
        """
        UPDATE place_boundaries child
        SET parent_id = p.country_id
        FROM (
            SELECT c.id AS child_id, ctry.id AS country_id
            FROM place_boundaries c
            LEFT JOIN LATERAL (
                SELECT pb.id
                FROM place_boundaries pb
                WHERE pb.subtype = 'country'
                  AND pb.country_code = c.country_code
                ORDER BY pb.overture_id ASC
                LIMIT 1
            ) ctry ON TRUE
            WHERE c.subtype <> 'country'
        ) p
        WHERE child.id = p.child_id
          AND child.parent_id IS DISTINCT FROM p.country_id
        """
    )
    op.execute(
        """
        WITH counts AS (
            SELECT place_id, count(*) AS n
            FROM (
                SELECT city_place_id AS place_id FROM fountains
                WHERE is_hidden = false AND city_place_id IS NOT NULL
                UNION ALL
                SELECT country_place_id FROM fountains
                WHERE is_hidden = false AND country_place_id IS NOT NULL
            ) x
            GROUP BY place_id
        )
        UPDATE place_boundaries pb
        SET fountain_count = COALESCE(counts.n, 0)
        FROM place_boundaries pb2
        LEFT JOIN counts ON counts.place_id = pb2.id
        WHERE pb.id = pb2.id
          AND pb.fountain_count IS DISTINCT FROM COALESCE(counts.n, 0)
        """
    )
    op.execute(
        """
        WITH eligible AS (
            SELECT pb.id, pb.country_code, pb.slug, pb.subtype, pb.fountain_count, pb.overture_id
            FROM place_boundaries pb
            LEFT JOIN place_scope_config cfg ON cfg.country_code = pb.country_code
            WHERE pb.subtype = ANY(COALESCE(cfg.eligible_city_subtypes,
                                            ARRAY['locality', 'localadmin']))
        ),
        ranked AS (
            SELECT id, ROW_NUMBER() OVER (
                PARTITION BY country_code, slug
                ORDER BY (CASE subtype
                    WHEN 'locality' THEN 3
                    WHEN 'localadmin' THEN 2
                    WHEN 'county' THEN 1
                    ELSE 0
                END) DESC, fountain_count DESC, overture_id ASC
            ) AS rn
            FROM eligible
        )
        UPDATE place_boundaries SET is_canonical = true
        WHERE id IN (SELECT id FROM ranked WHERE rn = 1)
        """
    )
    op.execute(
        """
        UPDATE fountains f
        SET city_place_id = canonical.id
        FROM place_boundaries city
        JOIN place_boundaries canonical
          ON canonical.country_code = city.country_code
         AND canonical.slug = city.slug
         AND canonical.is_canonical = true
        WHERE f.city_place_id = city.id
          AND f.city_place_id IS DISTINCT FROM canonical.id
        """
    )
    op.execute(
        """
        WITH counts AS (
            SELECT place_id, count(*) AS n
            FROM (
                SELECT city_place_id AS place_id FROM fountains
                WHERE is_hidden = false AND city_place_id IS NOT NULL
                UNION ALL
                SELECT country_place_id FROM fountains
                WHERE is_hidden = false AND country_place_id IS NOT NULL
            ) x
            GROUP BY place_id
        )
        UPDATE place_boundaries pb
        SET fountain_count = COALESCE(counts.n, 0)
        FROM place_boundaries pb2
        LEFT JOIN counts ON counts.place_id = pb2.id
        WHERE pb.id = pb2.id
          AND pb.fountain_count IS DISTINCT FROM COALESCE(counts.n, 0)
        """
    )
    op.create_index(
        "uq_place_boundaries_country_slug_canonical",
        "place_boundaries",
        ["country_code", "slug"],
        unique=True,
        postgresql_where=sa.text("is_canonical"),
    )

    op.drop_index("ix_fountains_region_place_id", table_name="fountains")
    op.drop_constraint("fk_fountains_region_place", "fountains", type_="foreignkey")
    op.drop_column("fountains", "region_place_id")
    op.drop_column("place_boundaries", "place_kind")
    op.drop_constraint(
        op.f("ck_place_scope_config_tiers_disjoint"), "place_scope_config", type_="check"
    )
    op.drop_column("place_scope_config", "eligible_region_subtypes")
