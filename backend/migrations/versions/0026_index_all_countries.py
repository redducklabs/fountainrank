"""Enable city_routes_ready for every registered boundary country (#127 worldwide rollout).

The owner signed off indexing **all** countries that have an active Overture boundary scope
(``.github/boundary-source-regions.yml``) — see the place-hierarchy rollout
(``docs/plans/2026-07-14-place-hierarchy-drilldown.md``). This is the reviewed migration that flips
the ``place_scope_config.city_routes_ready`` gate (added in 0017) from the per-country default
``false`` to ``true`` for all 62 registered countries, and seeds each country's region-tier
eligibility so the drill-down tree is correct on first load.

Region tier (``eligible_region_subtypes``):
- **No region tier — `{}`** (2-level ``/[country]/[city]`` URLs, like Luxembourg): city-states,
  micro-states, and small dependencies with no meaningful sub-national state/province tier for a
  city drill-down. Setting ``{}`` BEFORE the boundary load is what makes their cities parent
  directly to the country (spec §3/§4.1); leaving the ``{region}`` default would instead leave
  their cities with a NULL region parent and therefore no canonical city URL.
- **Default `{region}`** for every other country (they have states / provinces / regions). A country
  whose Overture data turns out to lack a region tier can be corrected in a later reviewed migration
  (set its ``eligible_region_subtypes = '{}'`` and re-run its boundary load) — the SEO coverage
  report surfaces such a country (cities with NULL parents / no canonical city rows).

City tier defaults to ``{locality, localadmin}``. Existing ``us`` (``{region}``) and ``lu`` (``{}``)
rows keep their eligible sets — ``ON CONFLICT DO UPDATE`` only flips their flag.

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

# City-states / micro-states / dependencies with NO sub-national region tier — 2-level city URLs
# (spec §4.1 names lu, mc, mt, sg + city-states). lu is already `{}` from an earlier migration; the
# rest are seeded here so their first boundary load builds a 2-level tree, not NULL-parent cities.
_NO_REGION_TIER = {"mc", "mt", "sg", "li", "ad", "gg", "je", "im", "fo"}


def upgrade() -> None:
    rows = []
    for cc in _COUNTRIES:
        region = "ARRAY[]::text[]" if cc in _NO_REGION_TIER else "ARRAY['region']::text[]"
        rows.append(f"        ('{cc}', ARRAY['locality','localadmin']::text[], {region}, true)")
    # Existing rows (us/lu, seeded before this migration) keep their eligible sets; ON CONFLICT only
    # flips the readiness flag. New rows take the eligible sets above.
    op.execute(
        "INSERT INTO place_scope_config "
        "(country_code, eligible_city_subtypes, eligible_region_subtypes, city_routes_ready)\n"
        "    VALUES\n" + ",\n".join(rows) + "\n"
        "    ON CONFLICT (country_code) DO UPDATE SET city_routes_ready = true"
    )


def downgrade() -> None:
    # True inverse: delete exactly the rows this migration created (every country except us/lu,
    # which existed before 0026). Restores the pre-0026 state where only us/lu have config rows and
    # only us/lu are ready (per 0017).
    others = ", ".join(f"'{cc}'" for cc in _COUNTRIES if cc not in ("us", "lu"))
    op.execute(f"DELETE FROM place_scope_config WHERE country_code IN ({others})")
