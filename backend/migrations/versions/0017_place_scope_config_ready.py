"""place_scope_config.city_routes_ready: per-scope city-routes readiness gate (#127 Slice 1e).

Adds the boolean owner-signoff flag that gates a scope's CITY routes (cities sitemap + city page
indexability). Seeds it true for the already-live scopes (us, lu) so nothing regresses; every other
(current or future) scope defaults to NOT ready until an owner signs off in a reviewed migration.
Spec: docs/specs/2026-07-04-seo-coverage-gate-design.md.
"""

import sqlalchemy as sa
from alembic import op

revision = "0017_place_scope_config_ready"
down_revision = "0016_place_boundary_cells"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "place_scope_config",
        sa.Column(
            "city_routes_ready",
            sa.Boolean(),
            nullable=False,
            server_default=sa.text("false"),
        ),
    )
    # The scopes already serving live city routes are signed off as ready.
    op.execute(
        "UPDATE place_scope_config SET city_routes_ready = true WHERE country_code IN ('us', 'lu')"
    )


def downgrade() -> None:
    op.drop_column("place_scope_config", "city_routes_ready")
