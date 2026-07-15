"""Enable city_routes_ready for every registered boundary country (#127 worldwide rollout).

The owner signed off indexing **all** countries that have an active Overture boundary scope
(``.github/boundary-source-regions.yml``) — see the place-hierarchy rollout
(``docs/plans/2026-07-14-place-hierarchy-drilldown.md``). This is the reviewed migration that flips
the ``place_scope_config.city_routes_ready`` gate (added in 0017) from the per-country default of
``false`` to ``true`` for all 62 registered countries.

Upsert semantics:
- **New rows** (every country except us/lu, which 0017 already seeded) are inserted with the code
  default eligible sets — ``eligible_city_subtypes = {locality, localadmin}`` and
  ``eligible_region_subtypes`` left to its ``{region}`` column default — and ``city_routes_ready =
  true``. A country whose Overture data has no ``region`` subtype simply yields a 2-level tree; a
  country whose municipal tier is coarser than ``localadmin`` can be tuned in a later reviewed
  migration without blocking indexing now.
- **Existing rows** (us with ``{region}``, lu with ``{}``) only have ``city_routes_ready`` set true;
  ``ON CONFLICT DO UPDATE`` deliberately does **not** overwrite their eligible sets.

Enabling a country before its boundaries are loaded is harmless: it owns no ``place_boundaries``
rows, so its pages 404 and it contributes nothing to the sitemaps until a boundary load lands — at
which point it becomes indexable automatically. Loading order is therefore independent of this gate.
"""

from alembic import op

revision = "0026_index_all_countries"
down_revision = "0025_place_hierarchy"
branch_labels = None
depends_on = None

# Every ISO country with an active scope in .github/boundary-source-regions.yml (62).
_COUNTRIES = (
    "ad al at au ba be bg bn by bz ch cl cy cz de dk ee es fi fo fr gb ge gg gr hr hu ie im is "
    "it je ke kr li lt lu lv mc md me mk mt mu my nc nl no pl pt ro rs se sg si sk tr ua us uy "
    "xk za"
).split()


def upgrade() -> None:
    values = ",\n".join(
        f"        ('{cc}', ARRAY['locality','localadmin']::text[], true)" for cc in _COUNTRIES
    )
    op.execute(
        "INSERT INTO place_scope_config "
        "(country_code, eligible_city_subtypes, city_routes_ready)\n"
        "    VALUES\n" + values + "\n"
        "    ON CONFLICT (country_code) DO UPDATE SET city_routes_ready = true"
    )


def downgrade() -> None:
    # Restore the 0017 state: only us/lu are signed off; every other country reverts to not-ready.
    others = ", ".join(f"'{cc}'" for cc in _COUNTRIES if cc not in ("us", "lu"))
    op.execute(
        f"UPDATE place_scope_config SET city_routes_ready = false WHERE country_code IN ({others})"
    )
