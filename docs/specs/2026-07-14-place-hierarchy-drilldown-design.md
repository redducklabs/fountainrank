# Place hierarchy + worldwide drill-down — design spec (2026-07-14)

Extends `docs/specs/2026-07-02-crawlable-seo-pages-design.md` (#127). This spec **supersedes**
that spec's §4.3 (URL identity contract) and §4.4 (page types); everything else there — the
Overture source (§11.3), the identity contract (§11.4), the level model (§11.5), the
thin-content predicate (§7), the Slice-1e readiness gate — **stands unchanged** and is
depended upon here.

---

## 1. Problem

Three defects, all of which block "find every fountain we have from a search engine":

1. **No hub.** There is no `/drinking-fountains` page. `web/app/drinking-fountains/` contains
   only `[country]/` and `bottle-fillers/`. A crawler entering the site has no single page that
   reaches the place tree, and a user has no way to browse from the top.

2. **No state/province tier.** `place_boundaries` already *contains* Overture `region` rows —
   the loader filters on `class='land'`, not on `subtype` (`backend/app/imports/boundaries.py`)
   — but nothing links or renders them. `parent_id` today is only city → country. There is no
   country → state → city drill-down.

3. **Flat city URLs structurally cannot represent all fountains.** The canonical index is
   `uq_place_boundaries_country_slug_canonical` — partial-unique on `(country_code, slug)
   WHERE is_canonical`. Exactly one row per country may own a slug. Verified against
   production: the live cities sitemap holds **1,015 URLs**, one of which is
   `/drinking-fountains/us/portland`. **Portland, Maine has no page and cannot have one.** The
   same holds for every duplicated US city name (Springfield, Columbus, Arlington, Kansas
   City…). This is a correctness bug, not a cosmetic one: those fountains are in the database,
   are on the map, and are unreachable by crawl.

Separately, boundaries have only ever been loaded for **US** and **LU**
(`.github/boundary-source-regions.yml`), while fountains are now imported for ~59 countries
(`.github/osm-import-regions.yml`). Every non-US/LU fountain — all of Germany, for example —
has **no place membership at all** and therefore appears on no page.

## 2. Goals / non-goals

**Goals**
- A top-level `/drinking-fountains` hub that reaches every country we have fountains for.
- Country → state/province → city drill-down, each level an indexable SSR page.
- Every fountain reachable from a crawlable page, including duplicate-named cities.
- Boundary coverage for every country that has an active fountain import scope.
- No loss of the ranking already accumulated by the 1,015 live city URLs.

**Non-goals**
- County/borough tiers below the city. Neighborhoods, microhoods, macrohoods stay excluded
  (§11.5 of the #127 spec).
- Per-city attribute pages (still out of scope, per #127 §4.5).
- Changing the fountain detail route `/fountains/[id]`.
- Auto-indexing newly loaded countries. The Slice-1e `city_routes_ready` owner-signoff gate
  stays in force and still defaults to false.

---

## 3. URL contract v2 — supersedes #127 §4.3 and §4.4

```
/drinking-fountains                       hub — every country with fountains
/drinking-fountains/us                    country — lists its states
/drinking-fountains/us/oregon             state/province — lists its cities
/drinking-fountains/us/oregon/portland    city — the ranked fountain list
/drinking-fountains/us/maine/portland     a second Portland — impossible today
/drinking-fountains/lu/luxembourg         a country with NO state tier — 2 levels
```

- **Country segment:** ISO-3166-1 alpha-2, lowercased (unchanged).
- **The middle segment is optional and per-country**, driven by data
  (`place_scope_config.eligible_region_subtypes`). A country with an empty/NULL region set has
  no state tier and its cities remain at `/[country]/[city]`. Luxembourg, Monaco, Malta,
  Singapore, and city-states behave this way.
- **City uniqueness becomes `(country_code, parent_id, slug)`**, not `(country_code, slug)`.
  This is the change that fixes defect 3.
- **Region uniqueness is `(country_code, slug)`** among canonical regions.
- Slugs stay **sticky** (assigned on first insert, never overwritten — #127 §4.3), so this
  change never re-slugs an existing row; it only changes which rows may be canonical *and*
  where a canonical city sits in the path.

### 3.1 Level-2 resolution order (binding)

`/drinking-fountains/[country]/[place]` is ambiguous by construction — the segment may be a
state, a 2-level city, or a legacy flat city URL. It resolves in exactly this order:

1. `[place]` is a **canonical region** in `[country]` → render the **state page**.
2. `[place]` is a **canonical city** in `[country]` whose parent is the **country** (2-level
   country) → render the **city page**.
3. `[place]` is a **canonical city** in `[country]` whose parent is a **region** → **permanent
   redirect** to `/[country]/[region-slug]/[place]`.
4. Otherwise → 404.

**Region-beats-city collision rule (accepted trade-off).** When a slug is *both* a canonical
region and a city — `/us/new-york`, `/us/washington` — rule 1 wins and the legacy city URL
becomes the **state page**, not a redirect to the city. It does not 404, the state page links
prominently to the city, and the city remains reachable at its nested URL. We accept a changed
page identity on a small number of legacy URLs rather than a 404 or an ambiguous route.

**Redirect status.** Next's `permanentRedirect()` emits **308**, not 301. Google treats 308 and
301 equivalently for consolidation. We use 308 rather than adding a static `redirects()` table
to `next.config.ts`, because the mapping is data (it changes as boundaries load) and cannot be
statically enumerated.

### 3.2 Page types (replaces #127 §4.4's table)

| Route | Source | Content | Indexable? |
|---|---|---|---|
| `/drinking-fountains` | all canonical countries | Intro + country list w/ counts | Yes (always) |
| `/drinking-fountains/[country]` | `place_kind='country'` | Intro + count + its regions (or its cities if no region tier) | Yes iff `fountain_count >= K` and country is `city_routes_ready` |
| `/drinking-fountains/[country]/[region]` | `place_kind='region'` | Intro + count + its cities + top fountains | Yes iff `fountain_count >= K` and `city_routes_ready` |
| `/drinking-fountains/[country]/[region]/[city]` | `place_kind='city'` | Intro + count + ranked fountain list | **Yes — primary**, iff `fountain_count >= K` and `city_routes_ready` |

The hub is the only always-indexable page: it is a real navigational index and is never thin
(it is empty only if we have no countries at all, which cannot happen in production).

---

## 4. Data model

### 4.1 `place_scope_config`
- **Add `eligible_region_subtypes` `text[] NULL`.** Code default when the row is absent:
  `{region}`. An **explicit empty array** means *this country has no state tier* — distinct from
  a missing row. Nullable so the column has a safe default for the existing us/lu rows.
- **Add a CHECK that the two eligible sets are disjoint:**
  `CHECK (eligible_region_subtypes IS NULL OR NOT (eligible_city_subtypes && eligible_region_subtypes))`.
  A subtype that is simultaneously the region tier and the city tier would make `place_kind`
  ambiguous; fail closed at the schema rather than pick a silent winner.
- `city_routes_ready` is **unchanged** and now gates region routes as well as city routes — one
  owner signoff per country, not two.

### 4.2 `place_boundaries`
- **Add `place_kind` `text NULL`**: `'country' | 'region' | 'city' | NULL`. Derived during the
  membership refresh from `subtype` + the country's eligible sets. `NULL` = a loaded polygon
  that owns no URL tier (a US county, a neighborhood, an ineligible subtype). Storing it makes
  routing and the partial indexes explicit instead of re-deriving the subtype ladder in five
  places.
- **`parent_id` semantics change** (column already exists): region → country; city → its region
  when the country has a region tier, else → country. Country → NULL.
- **Replace the canonical unique index.** Drop
  `uq_place_boundaries_country_slug_canonical`; add two:
  - `uq_place_boundaries_region_canonical` — unique `(country_code, slug)`
    `WHERE is_canonical AND place_kind = 'region'`
  - `uq_place_boundaries_city_canonical` — unique `(country_code, parent_id, slug)`
    `WHERE is_canonical AND place_kind = 'city'`

  Because canonical regions are unique on `(country_code, slug)`, `parent_id` ↔ region-slug is
  1:1, so the city index enforces exactly the URL's uniqueness and nothing weaker.

### 4.3 `fountains`
- **Add `region_place_id` `uuid NULL`** FK → `place_boundaries(id)` `ON DELETE SET NULL`,
  indexed. The third denormalized membership FK alongside the existing `country_place_id` /
  `city_place_id`.

---

## 5. Membership refresh (`backend/app/membership.py`)

The refresh becomes an **acyclic 7-step pass**. The ordering matters: canonical selection
tie-breaks on `fountain_count`, and city canonicality depends on region canonicality, so the
steps must run in this order or the result is order-dependent.

1. **Rebuild `place_boundary_cells`** (unchanged — `ST_Subdivide`, `TRUNCATE` + re-`INSERT` +
   `ANALYZE`).
2. **Derive `place_kind`** for every boundary from `subtype` + the country's eligible sets
   (defaults `{region}` / `{locality, localadmin}`).
3. **Derive `parent_id`.**
   - region → the covering `place_kind='country'` polygon.
   - city → the smallest-area covering `place_kind='region'` polygon in the same country; if the
     country has no region tier (or no region covers it), → the country.
   - Containment is tested with **`ST_PointOnSurface(child.boundary)`**, not the centroid: a
     centroid can fall outside a concave or multi-part polygon, and full `ST_Covers(parent,
     child)` is brittle against boundary-precision disagreements between tiers.
4. **Assign fountains** — `country_place_id`, `region_place_id`, `city_place_id` — by
   point-in-polygon against the cells (the existing LATERAL pattern, extended).
   - `region_place_id` = **the matched city's parent region when the city matched and its parent
     is a region**, else the direct region point-in-polygon match, else NULL. Deriving it from
     the city's parent first guarantees the breadcrumb is coherent: a fountain can never be
     listed on a city page nested under region A while being counted in region B.
   - City assignment is unchanged: most-specific eligible covering polygon
     (`locality` > `localadmin` > `county`, smallest-area, `overture_id` tie-break).
   - An unmatched point still yields **country-only, never a coarser forced tier** (#127 §11.5).
5. **Recount `fountain_count`** for every place — a 3-way `UNION ALL` over the three FK columns
   (was 2-way). A region's count is therefore **every non-hidden fountain inside it**, not the
   sum of its cities' counts: fountains in unincorporated areas still roll up to the state. This
   is the honest number and it is what the state page displays.
6. **Select canonical regions** — one per `(country_code, slug)` among `place_kind='region'`,
   tie-break on the fresh `fountain_count`, then `overture_id`.
7. **Select canonical cities** — one per `(country_code, parent_id, slug)` among
   `place_kind='city'`, tie-break on `fountain_count`, then `overture_id`. **A city is eligible
   for canonical only if its parent is a country or a *canonical* region** — otherwise its URL
   would reference a region segment that no page serves.

**Consequence to accept:** if two regions in one country collide on slug, the loser is
non-canonical and its cities cannot be canonical either. Two same-named states within one
country do not occur in the Overture data we load; the Slice-1e coverage report surfaces it if
it ever does.

---

## 6. Backend API (`backend/app/routers/places.py`)

- `GET /api/v1/places` — canonical **countries**. Unchanged.
- `GET /api/v1/places/{country}/regions` — that country's canonical regions, most fountains
  first. Empty list for a country with no region tier.
- `GET /api/v1/places/{country}/{region}/cities` — the region's canonical cities.
- `GET /api/v1/places/{country}/cities` — a 2-level country's cities (parent = country).
- `GET /api/v1/places/{country}/resolve/{slug}` — **the level-2 resolver.** Returns
  `{ kind: 'region' | 'city', canonical_path, place }` or 404. This is what makes the web route
  a dumb consumer: the redirect decision lives in one server-side place, not duplicated in the
  page.
- `GET /api/v1/places/{country}/{region}/{city}/fountains` — the nested city page's ranked
  fountains + `indexable`. The existing 2-segment
  `GET /api/v1/places/{country}/{city}/fountains` is **retained** to serve 2-level countries.
- `GET /api/v1/places/{country}/{region}/fountains` — the region page's top fountains +
  `indexable`.

`indexable` stays a **server-computed verdict** (#127 §7): `fountain_count >= K` **AND** the
country is `city_routes_ready`. The web never re-derives the threshold.

---

## 7. Web (`web/app/drinking-fountains/`)

- `page.tsx` — **new hub.** Countries with counts, linking down. Also linked from the footer and
  `core.xml`.
- `[country]/page.tsx` — lists **regions** when the country has a region tier, else its cities.
- `[country]/[place]/page.tsx` — **the resolver route.** Next.js forbids two dynamic segments at
  one level, so the existing `[city]/` directory is **renamed to `[place]/`**. Implements §3.1:
  region page, 2-level city page, 308 redirect, or 404.
- `[country]/[place]/[city]/page.tsx` — the city page (the existing city page, moved).
- Breadcrumbs on every level, with `BreadcrumbList` JSON-LD, so the hierarchy is machine-legible.
- New UI elements (hub country grid, region list, breadcrumb) are documented in
  `docs/style-guide.md` before they ship — mandatory per `CLAUDE.md`.

---

## 8. Sitemaps

- `core.xml` — add `/drinking-fountains`.
- **`regions.xml` — new chunk**, canonical regions of `city_routes_ready` countries.
- `cities.xml` — same set, but URLs become **nested** for cities under a region tier.
- **`fountains.xml` must be chunked.** It is capped at `SITEMAP_FOUNTAIN_CAP = 50000` and the US
  alone is at 24,466. Worldwide will exceed the 50k-URL sitemap limit. Becomes
  `/sitemaps/fountains/[chunk].xml`, each chunk `limit=50000 offset=chunk*50000`; the index at
  `/sitemap.xml` emits `ceil(total_count / 50000)` chunk entries. The backend endpoint already
  supports `offset` and already returns `total_count` — no backend change needed.
- Every chunk stays < 50k URLs, per #127 §6.

---

## 9. Worldwide boundary coverage

`.github/boundary-source-regions.yml` gains one `overture:<cc>` row per ISO country that has an
active fountain scope — **62 countries** (`us` + `lu` already exist, so **60 new rows**), all
pinned to the same immutable Overture release `2026-06-17.0` already in use. Pin, never chase
latest (#127 §11.3). The full enumeration lives in the implementation plan.

Derived from the active scopes in `.github/osm-import-regions.yml`. Note that a fountain scope is
not 1:1 with a country: `asia/malaysia-singapore-brunei` yields **MY, SG, BN**;
`europe/guernsey-jersey` yields **GG, JE**; `europe/ireland-and-northern-ireland` contributes
**IE** (the NI part belongs to GB).

**Uncertain country codes — verify, do not assume.** Overture's `country` value for
`XK` (Kosovo), `FO` (Faroe Islands), `GG`/`JE`/`IM` (crown dependencies) and `NC` (New
Caledonia) may be absent or may nest under a parent state. The boundary-load **dry-run reports a
feature count**; a dry-run that loads **zero features is the signal that the code is wrong or
unsupported** — retire that row rather than shipping a country that can never resolve. This is a
per-country verification step in the rollout, not an assumption baked into the spec.

---

## 10. Migration + deploy ordering (the dangerous part)

The migration re-derives membership for **existing** US/LU rows. US cities acquire a region
parent, so **their canonical URLs change in the same deploy**. Therefore:

- The 308-redirect resolver (§3.1) and the migration **must ship in the same release**. If the
  migration lands without the resolver, 1,015 indexed URLs 404.
- The migration is **reversible**: `downgrade()` restores the single `(country_code, slug)`
  partial unique index and drops the added columns. Because a downgrade would re-collide the
  duplicate-city rows that the upgrade legitimately made canonical, `downgrade()` **must first
  reset `is_canonical = false` and re-select** under the old rule, or the old unique index
  cannot be created. This is explicitly implemented and tested, not assumed.
- `alembic check` must report **no drift**, and the new index/constraint **names** are asserted
  against `pg_indexes` — `alembic check` does not compare CHECK-constraint definitions, so a
  misnamed check can otherwise ship silently (`claude_help/testing-ci.md`).

Rollout order after merge:
1. Deploy (`gh workflow run deploy.yml --ref main`) — migration + resolver + pages go live
   together. US/LU behavior is verified before any new country is loaded.
2. Boundary-load **Germany** (dry-run → apply) as the validation country: confirm its city tier
   really is `locality`/`localadmin` and that **Hamburg**, a city-state, resolves as a city and
   not only as a region. Adjust `place_scope_config` for DE if not.
3. Fan out the remaining countries.
4. Run the coverage gate; sign off `city_routes_ready` per country **in a reviewed migration**
   — loading a country does **not** index it.

---

## 11. Testing

- **Membership:** two same-slug cities in different regions of one country both become canonical
  (the Portland case — the defect-3 regression test). A region-vs-city slug collision. A country
  with no region tier keeps 2-level cities. An unmatched point → country-only. A fountain whose
  city's parent region differs from its own PIP region → the city's parent wins (§5, step 4).
- **Migration:** upgrade on a seeded US-like fixture promotes both Portlands; downgrade restores
  the old index without violating it.
- **Resolver:** all four branches of §3.1, including the region-beats-city collision.
- **Redirects:** a legacy flat city URL 308s to its nested URL; the redirect target is canonical.
- **Sitemaps:** nested city URLs; `regions.xml` content; `fountains.xml` chunk boundaries at
  exactly 50k and at `total_count % 50000 == 0`.
- **Indexability:** a country that is not `city_routes_ready` is `noindex` and absent from
  sitemaps, even with a high `fountain_count`.

---

## 12. Decisions

| Decision | Choice | Why |
|---|---|---|
| City URL shape | Nest under region, 308 from legacy flat URLs | Only shape that can represent duplicate city names; preserves the 1,015 indexed URLs |
| Region segment | Optional, per-country, data-driven | City-states and micro-countries have no meaningful state tier |
| Region-vs-city slug collision | Region wins; legacy URL becomes the state page | Deterministic; avoids a 404 and an ambiguous route |
| Region `fountain_count` | All fountains in the region, not the sum of its cities | Honest; fountains outside any city still roll up |
| Fountain's region | The matched city's parent, falling back to direct PIP | Guarantees a coherent breadcrumb |
| `place_kind` | Stored, derived on refresh | Explicit routing + explicit partial indexes; no re-derived subtype ladders |
| New-country indexing | Still gated by `city_routes_ready` | Loading data is not the same as publishing it |
