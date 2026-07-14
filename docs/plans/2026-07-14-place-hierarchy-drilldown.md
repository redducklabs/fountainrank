# Place hierarchy + worldwide drill-down — implementation plan (2026-07-14)

Implements `docs/specs/2026-07-14-place-hierarchy-drilldown-design.md` (Codex-approved,
spec-review-4). Section references below (§n) are to that spec.

**Branch:** `feat/place-hierarchy-drilldown` → one PR, sliced into reviewable commits.

**Non-negotiable ordering constraint (§10):** the migration and the 308-redirect resolver must be
in the **same release**. US city URLs move in the same deploy that adds the region tier — if the
migration lands without the resolver, 1,015 indexed URLs 404. Slices 1–4 therefore ship together;
none is independently deployable.

---

## Slice 1 — Schema + membership (the core)

**Files:** `backend/migrations/versions/0018_place_hierarchy.py` (new),
`backend/app/models.py`, `backend/app/membership.py`.

**Migration `0018`:**
- `place_scope_config.eligible_region_subtypes text[] NOT NULL DEFAULT '{region}'` (§4.1).
- CHECK `ck_place_scope_config_tiers_disjoint`:
  `NOT (eligible_city_subtypes && eligible_region_subtypes)`.
- **Explicit backfill — do not let the server default decide:** `us` → `'{region}'`,
  `lu` → `'{}'` (LU must stay 2-level or its live URLs move).
- `place_boundaries.place_kind text NULL`.
- `fountains.region_place_id uuid NULL` FK → `place_boundaries(id)` `ON DELETE SET NULL`, indexed
  (mirror `0015_fountain_membership.py`).
- Drop `uq_place_boundaries_country_slug_canonical`; add `uq_place_boundaries_region_canonical`
  (`(country_code, slug) WHERE is_canonical AND place_kind='region'`) and
  `uq_place_boundaries_city_canonical`
  (`(country_code, parent_id, slug) WHERE is_canonical AND place_kind='city'`).
- `downgrade()` — the **full old-model recomputation** in §10's exact order (drop new indexes →
  clear `is_canonical` → restore old parentage → re-select canonical under the old rule → *then*
  create the old index → drop the added columns). Creating the old index before the re-selection
  fails; that ordering is the whole point.

**`membership.py` — the 10-step `refresh_all_memberships()` (§5).** Key deltas from today:
- New `_PLACE_KIND_SQL` (step 2) and a `has_region_tier` notion (`cardinality(...) > 0`, missing
  row ⇒ true) encoded **once**.
- `_ASSIGN_SQL` grows a **third, independent** region LATERAL. `region_place_id` is a **direct PIP**
  — never derived from the city (§5 rule (a)).
- `_CANONICAL_*` splits into **region** (step 5: `(country_code, slug)`, tie-break
  **`ST_Area(boundary) DESC, overture_id ASC`** — geodesic, **count-free**, §5 rule (b)) and
  **city** (step 8: `(country_code, parent_id, slug)`, tie-break subtype priority →
  `fountain_count DESC` → `overture_id`).
- New city-parent step 6: smallest-area **canonical** region covering
  `ST_PointOnSurface(pb.boundary::geometry)`, tested against the parent's `place_boundary_cells`
  via GiST (not a raw geography scan); else country; else NULL.
- **New step 9 — the canonical remap.** Repoint `fountains.city_place_id` at the canonical row of
  its `(country_code, parent_id, slug)` group; NULL it when the matched city has a NULL parent.
  This is the fix for the reachability hole — without it, fountains on a non-canonical twin are
  counted and "city resolved" yet appear on **no** page.
- Recounts (steps 7 and 10) become a **3-way** `UNION ALL`.
- **`recompute_fountain_membership()` / `recompute_place_counts()` (§5.1)** get the remap **and the
  post-remap recount**. Skipping the second recount is a real stale-`indexable` bug.

**Tests** (`backend/tests/test_membership.py`, `test_place_*_migration.py`):
- Two same-slug cities in **different** regions both canonical (the Portland regression).
- Two same-slug cities in the **same** region: the non-canonical twin's fountains are remapped and
  listed on the canonical page; nothing orphaned.
- A matched city with a NULL parent → `city_place_id = NULL` (country-only, not falsely indexable).
- Canonical **region** selection ignores fountain counts (add/hide a fountain, canonicality holds).
- Scoped winner flip: after the flip, old winner count `= 0`, new winner `= group total`.
- **Idempotence:** refresh twice → identical final state (snapshot-compare, not "zero writes").
- Invariant: no canonical city has a NULL parent or a non-canonical region parent.
- LU (no region tier) keeps 2-level cities. Unmatched point → country-only.
- Upgrade → downgrade → old index exists and is satisfied; index/CHECK **names** asserted from
  `pg_indexes` / `pg_constraint` (`alembic check` does not compare CHECK definitions).

**Done when:** `./run.ps1 check -Backend` green, `alembic check` reports no drift.

---

## Slice 2 — Places API + coverage gate

**Files:** `backend/app/routers/places.py`, `backend/app/schemas.py`,
`backend/app/imports/seo_coverage_cli.py`.

- Endpoints per §6, using **literal prefixes** (`/regions`, `/cities`, `/resolve`) so FastAPI
  declaration order cannot bite. `GET /places/{country}/{city}/fountains` is **retained** (2-level
  countries + back-compat) and declared **last**.
- `GET /places/{country}/resolve/{slug}` returns `{kind, canonical_path, place}` — the §3.1
  decision lives here **once**, server-side.
- `GET /places` keeps returning `place_kind='country'` rows — **never filter countries on
  `is_canonical`** (the file already documents this trap).
- `indexable` stays server-computed: `fountain_count >= K` **AND** the place's **country** is
  `city_routes_ready` (reuse the existing country-scoped `_scope_city_routes_ready()`).
- **Coverage gate:** a duplicate `(country_code, slug)` among `place_kind='region'` rows **blocks**
  `city_routes_ready` for that country — a gate **failure**, not a warning (§5.1).

**Tests:** `/places/us/cities` and `/places/us/resolve/x` are not captured by a dynamic
`{region}`/`{city}` route; resolver returns all four §3.1 branches; the three §3.2 collisions
resolve to the **region**; a not-ready country is `indexable: false`.

**Done when:** `./run.ps1 check -Backend` green.

---

## Slice 3 — Web pages + the 308 resolver

**Files:** `packages/api-client/` (regenerate `openapi.json` + `schema.d.ts` from the Slice-2
backend — never hand-edit), `web/lib/places.ts`, `web/app/drinking-fountains/**`.

- `page.tsx` — the **hub** (§7).
- `[country]/page.tsx` — lists regions, or cities for a 2-level country.
- **Rename `[city]/` → `[place]/`** (Next forbids two dynamic segments at one level).
  `[country]/[place]/page.tsx` implements §3.1: region page → 2-level city page → **308** via
  `permanentRedirect()` → 404.
- `[country]/[place]/[city]/page.tsx` — the city page (moved).
- Breadcrumbs + `BreadcrumbList` JSON-LD at every level. Breadcrumbs come from the **place tree**
  (`city.parent_id`), never from `region_place_id` (§5).
- Region-page **disambiguation link** for the §3.2 collisions.
- `cityPath()` / `countryPath()` gain `regionPath()` and a region-aware `cityPath()`.

**Tests:** the four resolver branches; a legacy flat URL 308s to a canonical nested target; the DC
collision renders the state page **with** the disambiguation link.

**Done when:** `./run.ps1 check -Web` green.

---

## Slice 4 — Sitemaps

**Files:** `web/app/sitemaps/regions.xml/route.ts` (new),
`web/app/sitemaps/fountains/[chunk]/route.ts` (new), `web/app/sitemaps/cities.xml/route.ts`,
`web/app/sitemaps/core.xml/route.ts`, `web/app/sitemap.xml/route.ts`,
`web/app/sitemaps/fountains.xml/route.ts`.

- `core.xml` += `/drinking-fountains`. `regions.xml` new. `cities.xml` → **nested** URLs.
- **Fountains chunking (§8):** `[chunk]` must match `^(\d+)\.xml$`, **zero-based**, chunk `n` →
  `offset = n*50000`. Out-of-range → **404**, never an empty 200. Legacy
  `/sitemaps/fountains.xml` → **308** → `/sitemaps/fountains/0.xml`.
- **`/sitemap.xml` becomes dynamic** (it must fetch `total_count` to size the chunk list). On fetch
  failure it returns an **uncacheable 503** — never a cacheable index silently missing the fountain
  chunks, which would de-list every fountain URL.

**Tests:** chunk boundaries at exactly 50k and at `total_count % 50000 == 0`; out-of-range 404;
legacy 308; index 503 on backend failure.

**Done when:** `./run.ps1 check -Web` green.

---

## Slice 5 — Style guide (mandatory, `CLAUDE.md`)

**File:** `docs/style-guide.md`. Add, **before they ship**: hub country grid, region list,
breadcrumb trail (+ JSON-LD), region-page disambiguation link.

---

## Slice 6 — Boundary registry (60 new rows)

**File:** `.github/boundary-source-regions.yml`. One `overture:<cc>` row per ISO country with an
active fountain scope, `status: active`, all pinned to `overture_release_id: 2026-06-17.0`.

Derived from the current `.github/osm-import-regions.yml` (111 active scopes = 53 US + 58 non-US).
Scopes are **not** 1:1 with countries: `asia/malaysia-singapore-brunei` → **MY, SG, BN**;
`europe/guernsey-jersey` → **GG, JE**; `europe/ireland-and-northern-ireland` → **IE** (NI belongs to
GB). Result: **62 countries; `us` + `lu` already exist → 60 new rows:**

```
AD AL AT AU BA BE BG BN BY BZ CH CL CY CZ DE DK EE ES FI FO FR GB GE GG GR HR HU IE IM IS
IT JE KE KR LI LT LV MC MD ME MK MT MU MY NC NL NO PL PT RO RS SE SG SI SK TR UA UY XK ZA
```

**Verify, never assume (§9):** `XK` (Kosovo), `FO`, `GG`/`JE`/`IM`, `NC` may be absent from Overture
or nested under a parent state. A dry-run loading **zero features** is the signal the code is wrong
— **retire that row** rather than ship a country that can never resolve.

---

## Slice 7 — Full local mirror, PR, Codex PR loop

`./run.ps1 check` (full — a cross-workspace `api-client` contract break must not slip through).
Then PR → CI green → Codex PR-review loop to `VERDICT: APPROVED` → every PR comment addressed →
**squash-merge**.

> On this Windows/WSL host the backend mirror is fully verifiable via an isolated
> `UV_PROJECT_ENVIRONMENT`, but component-render/full JS unit suites and mobile's React-Compiler
> lint are **CI-only** (`claude_help/local-dev.md`). Report CI's result for those — never a local
> green that was not obtained.

---

## Rollout (post-merge, operator-driven)

1. **Deploy:** `gh workflow run deploy.yml --ref main` (merging does **not** deploy). Migration +
   resolver + pages go live together.
2. **Verify US/LU BEFORE loading any new country:** the three §3.2 collisions render the state page;
   a sample of the 1,015 legacy city URLs 308s to a live nested URL; both Portlands resolve;
   `/drinking-fountains` hub renders.
3. **Germany first** — the validation country. `gh workflow run osm-boundary-load.yml --ref main
   -f scope_id=overture:de -f overture_release_id=2026-06-17.0 -f dry_run=true`, then apply.
   Confirm **Hamburg** — a city-state that is simultaneously a *Land* and a city — resolves as a
   **city** and not only as a region; fix DE's `place_scope_config` if not.
4. **Fan out** the remaining countries, checking each dry-run's feature count (§9).
5. **Coverage gate**, then sign off `city_routes_ready` per country **in a reviewed migration**.
   Loading a country does **not** index it.
