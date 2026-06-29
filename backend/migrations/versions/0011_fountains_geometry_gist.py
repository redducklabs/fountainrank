"""fountains (location::geometry) functional GiST index (#113)

Adds a functional GiST index on the geometry cast of the geography ``location``
column so the near-global / full-latitude bbox fallback in
``routers/fountains.py::fountains_in_bbox`` — which intersects in planar
``geometry`` space when the envelope spans the full latitude range (#20) — can
use an index instead of a sequential scan. The geography GiST index
(``idx_fountains_location``) cannot serve ``ST_Intersects(location::geometry, env)``
because the cast changes the indexed type.

This is an EXPRESSION index, so it is not represented in the ORM metadata and
``alembic check`` does not flag it as drift (autogenerate skips reflection of
expression-based indexes). No model change accompanies it; verify the index name
in ``pg_indexes`` instead.

Revision ID: 0011_fountains_geometry_gist
Revises: 0010_contrib_location_gist
Create Date: 2026-06-29
"""

from alembic import op

revision = "0011_fountains_geometry_gist"
down_revision = "0010_contrib_location_gist"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Raw SQL for the functional (cast) index expression. Alembic cannot reliably
    # autogenerate/compare expression indexes (see the include_object exclusion in
    # migrations/env.py), so this index is hand-managed and verified via pg_indexes.
    # Plain CREATE INDEX (not CONCURRENTLY) — Alembic runs migrations in a
    # transaction, and CONCURRENTLY cannot run inside one.
    op.execute(
        "CREATE INDEX ix_fountains_location_geometry ON fountains USING gist ((location::geometry))"
    )


def downgrade() -> None:
    op.execute("DROP INDEX IF EXISTS ix_fountains_location_geometry")
