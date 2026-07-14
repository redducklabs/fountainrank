# Place hierarchy + worldwide drill-down — design spec (2026-07-14)

Extends `docs/specs/2026-07-02-crawlable-seo-pages-design.md` (#127). This spec **supersedes**
that spec's §4.3 (URL identity contract) and §4.4 (page types); everything else there — the
Overture source (§11.3), the identity contract (§11.4), the level model (§11.5), the
thin-content predicate (§7), the Slice-1e readiness gate — **stands unchanged** and is
depended upon here.

*Revision 2 — rewritten after Codex spec-review-1 (7 [MAJOR] findings). The membership pass is
now genuinely acyclic (§5), scoped update paths are specified (§5.1), the region config is
two-state rather than tri-state (§4.1), the sitemap chunk contract is exact (§8), the downgrade
is a full old-model recomputation (§10), and the region/city slug collisions are **enumerated
from production** rather than hand-waved (§3.2).*

---

## 1. Problem

Three defects, all of which block "find every fountain we have from a search engine":

1. **No hub.** There is no `/drinking-fountains` page. `web/app/drinking-fountains/` contains
   only `[country]/` and `bottle-fillers/`. A crawler entering the site has no single page that
   reaches the place tree, and a user has no way to browse from the top.

2. **No state/province tier.** `place_boundaries` already *contains* Overture `region` rows —
   the loader filters on `class='land'`, not on `subtype` (`backend/app/imports/boundaries.py`),
   and the #127 DuckDB source query selects
   `subtype IN ('country','region','county','localadmin','locality')`. But nothing links or
   renders them: `_PARENT_SET_SQL` in `backend/app/membership.py` today sets **every** non-country
   boundary's parent to the country row with the same `country_code`. There is no country → state
   → city drill-down.

3. **Flat city URLs structurally cannot represent all fountains.** The canonical index is
   `uq_place_boundaries_country_slug_canonical` — partial-unique on `(country_code, slug)
   WHERE is_canonical`. Exactly one row per country may own a slug. Verified against production:
   the live cities sitemap holds **1,015 URLs**, one of which is `/drinking-fountains/us/portland`.
   **Portland, Maine has no page and cannot have one.** The same holds for every duplicated US
   city name (Springfield, Columbus, Arlington, Kansas City…). This is a correctness bug: those
   fountains are in the database, are on the map, and are unreachable by crawl.

Separately, boundaries have only ever been loaded for **US** and **LU**
(`.github/boundary-source-regions.yml`), while fountains are imported for **62 countries**
(`.github/osm-import-regions.yml`, 111 active scopes). Every non-US/LU fountain — all of Germany,
for example — has **no place membership at all** and appears on no page.

## 2. Goals / non-goals

**Goals**
- A top-level `/drinking-fountains` hub that reaches every country we have fountains for.
- Country → state/province → city drill-down, each level an indexable SSR page.
- **The crawlability promise, stated precisely:** every fountain that resolves to a city is listed
  on **exactly one** canonical city page, *including* fountains in duplicate-named cities (the
  defect-3 fix) and fountains that land on a non-canonical duplicate polygon (§5 step 9). A
  fountain that resolves to **no** eligible city polygon (an unincorporated area) is **counted** on
  its region and country pages and may surface in their "top fountains" lists, but its **detail page
  stays `noindex`** — that is the unchanged #127 §7 thin-content predicate
  (`city_place_id IS NOT NULL`), and this spec does **not** widen it. "Every fountain reachable"
  therefore means *every city-resolved fountain*, not *every row in the table*.
- Boundary coverage for every country that has an active fountain import scope.
- Preserve the ranking of the 1,015 live city URLs, except for the three enumerated collisions
  in §3.2 — which are named, costed, and mitigated rather than discovered later.

**Non-goals**
- County/borough tiers below the city. Neighborhoods, microhoods, macrohoods stay excluded
  (#127 §11.5).
- Per-city attribute pages (still out of scope, #127 §4.5).
- Changing the fountain detail route `/fountains/[id]`.
- Auto-indexing newly loaded countries. The Slice-1e `city_routes_ready` owner-signoff gate stays
  in force and still defaults to false.

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
- **The middle segment is per-country and driven by data** —
  `place_scope_config.eligible_region_subtypes`. A country whose set is **empty** has no state
  tier, and its cities stay at `/[country]/[city]`. Luxembourg, Monaco, Malta, Singapore and
  city-states behave this way.
- **In a country that HAS a region tier, level 2 is regions ONLY — cities are always level 3.**
  There is no mixed 2-level/3-level city namespace within one country. A city polygon in a
  region-tier country that no canonical region covers is **not canonical** and owns no URL (a
  degenerate case that does not occur in the loaded data — Overture region coverage of the US is
  complete; the Slice-1e coverage report surfaces it if it ever does). Its fountains keep their
  country membership and still appear on the country page.
- **City uniqueness becomes `(country_code, parent_id, slug)`**, not `(country_code, slug)`.
  This is the change that fixes defect 3.
- **Region uniqueness is `(country_code, slug)`** among canonical regions.
- Slugs stay **sticky** (assigned on first insert, never overwritten — #127 §4.3). This change
  never re-slugs a row; it changes only which rows may be canonical and where a canonical city
  sits in the path.

### 3.1 Level-2 resolution order (binding)

`/drinking-fountains/[country]/[place]` resolves in exactly this order:

1. `[place]` is a **canonical region** in `[country]` → render the **state page**.
2. `[place]` is a **canonical city** whose parent is the **country** (only possible in a country
   with no region tier) → render the **city page**.
3. `[place]` is a **canonical city** whose parent is a **region** (a legacy flat URL) →
   **permanent redirect** to `/[country]/[region-slug]/[place]`.
4. Otherwise → **404**.

**Redirect status.** Next's `permanentRedirect()` emits **308**, not 301. Google treats 308 and
301 equivalently for consolidation. We use it rather than a static `redirects()` table in
`next.config.ts` because the mapping is *data* — it changes as boundaries load — and cannot be
statically enumerated.

### 3.2 Region/city slug collisions — enumerated from production

Rule 1 beats rule 3, so a slug that is **both** a canonical region and a legacy canonical city
resolves to the **region**, and that legacy city URL changes identity instead of redirecting.
This is the one place the "preserve the 1,015 URLs" goal is knowingly broken, so the exact cost
is enumerated rather than left to be discovered in production. Intersecting the 1,000 live US
city slugs against the 52 US state/territory slugs yields **exactly three** collisions:

| Legacy URL | What it actually is | Fountains | New URL for the city |
|---|---|---|---|
| `/drinking-fountains/us/delaware` | Delaware, **Ohio** | 3 | `/us/ohio/delaware` |
| `/drinking-fountains/us/washington` | Washington, **DC** | **196** | `/us/district-of-columbia/washington` |
| `/drinking-fountains/us/wyoming` | Wyoming, **Michigan** | 5 | `/us/michigan/wyoming` |

**`new-york` is NOT a collision** — Overture splits New York City into boroughs
(`manhattan`, `queens`, `brooklyn`), so no canonical US city holds that slug and the state takes
it uncontested.

**Decision: the region wins the bare slug.** It is deterministic and stable — the alternative
(suffixing a colliding region's slug) would make a *state's* URL depend on whether some unrelated
city exists, so adding or removing a city could silently rename a state's URL. Stable URLs matter
more than three legacy pages.

**Cost and mitigation.** Two of the three are trivial (3 and 5 fountains). The one that costs
something is Washington, DC (196 fountains): its content moves to
`/us/district-of-columbia/washington`, which is a *better*, unambiguous URL, is in the sitemap,
and is crawled from the DC region page. To mitigate the ambiguity for users, **a region page whose
slug also matches a city elsewhere in the country renders a disambiguation link** to that city
("Looking for Washington, District of Columbia?"). This is a named, tested UI element, not an
incidental one.

### 3.3 Page types (replaces #127 §4.4's table)

| Route | Source | Content | Indexable? |
|---|---|---|---|
| `/drinking-fountains` | `place_kind='country'` rows with `fountain_count > 0` (countries are **not** `is_canonical` rows — that flag governs city/region URL ownership only) | Intro + country list w/ counts | Yes (always) |
| `/drinking-fountains/[country]` | `place_kind='country'` | Intro + count + its regions (or its cities if no region tier) | Yes iff `fountain_count >= K` and the country is `city_routes_ready` |
| `/drinking-fountains/[country]/[region]` | `place_kind='region'` | Intro + count + its cities + top fountains | Yes iff `fountain_count >= K` and **the region's country** is `city_routes_ready` |
| `/drinking-fountains/[country]/[region]/[city]` | `place_kind='city'` | Intro + count + ranked fountain list | **Yes — primary**, iff `fountain_count >= K` and **the city's country** is `city_routes_ready` |

`city_routes_ready` lives on `place_scope_config` and is **country-scoped** — the existing
`_scope_city_routes_ready()` helper (missing row ⇒ false) is reused unchanged and now gates
region routes as well as city routes. One owner signoff per country, not two.

The hub is the only always-indexable page: it is a real navigational index and is thin only if we
have no countries at all, which cannot happen in production.

---

## 4. Data model

### 4.1 `place_scope_config` — two states, not three

- **Add `eligible_region_subtypes text[] NOT NULL DEFAULT '{region}'`.** Deliberately **NOT
  NULL**, so the column has exactly two meanings and no `COALESCE` tri-state trap:
  - **non-empty array** → the country has a region tier at those subtypes;
  - **empty array `'{}'`** → the country has **no** region tier (2-level URLs).
  - A country with **no row at all** falls back to the code default `{region}` (mirroring how
    `eligible_city_subtypes` already defaults to `{locality, localadmin}`).
- **The migration backfills the two existing rows explicitly** — it must not let the server
  default decide:
  - `us` → `'{region}'`
  - `lu` → `'{}'` — Luxembourg's municipal tier is `county` communes (#127 §11.5). Giving LU a
    region tier would nest its communes under cantons and **change its live URLs**. LU stays
    2-level, exactly as it is today.
- **Add a disjointness CHECK** (`ck_place_scope_config_tiers_disjoint`):
  `CHECK (NOT (eligible_city_subtypes && eligible_region_subtypes))`. A subtype that is
  simultaneously the region tier and the city tier would make `place_kind` ambiguous — fail closed
  at the schema rather than pick a silent winner.
- Expose a single **`has_region_tier(country)`** helper (`cardinality(...) > 0`, missing row ⇒
  true) used by every SQL and API path, so the emptiness rule is encoded once.
- `city_routes_ready` is **unchanged**.

### 4.2 `place_boundaries`

- **Add `place_kind text NULL`**: `'country' | 'region' | 'city' | NULL`. Derived during the
  membership refresh from `subtype` + the country's eligible sets. `NULL` = a loaded polygon that
  owns no URL tier (a US county, a neighborhood, an ineligible subtype). Storing it makes routing
  and the partial indexes explicit instead of re-deriving the subtype ladder in five places.
- **`parent_id` semantics change** (the column already exists): region → country; city → its
  **canonical** region when the country has a region tier, else → country; country → NULL.
- **Replace the canonical unique index.** Drop `uq_place_boundaries_country_slug_canonical`; add:
  - `uq_place_boundaries_region_canonical` — unique `(country_code, slug)`
    `WHERE is_canonical AND place_kind = 'region'`
  - `uq_place_boundaries_city_canonical` — unique `(country_code, parent_id, slug)`
    `WHERE is_canonical AND place_kind = 'city'`

**The invariant that makes the city index sufficient.** The index enforces URL uniqueness only if
every canonical city's `parent_id` is the country or a **canonical** region — otherwise two
canonical cities could map to the same public path via a non-canonical region that shares a
winning region's slug. **This holds by construction, not by hope:** §5 step 7 sets a city's
`parent_id` *only* to a canonical region (or the country), and it runs *after* canonical regions
are chosen in step 6. A city whose `parent_id` is NULL is never canonical (step 8). The scoped
update paths (§5.1) never re-parent cities and never re-select canonical regions, so they cannot
break it either. This invariant is asserted by a test, not merely documented.

### 4.3 `fountains`

- **Add `region_place_id uuid NULL`** FK → `place_boundaries(id)` `ON DELETE SET NULL`, indexed —
  the third denormalized membership FK alongside the existing `country_place_id` / `city_place_id`
  (migration `0015_fountain_membership.py`).

---

## 5. Membership refresh — `refresh_all_memberships()`

The pass is **10 steps, and genuinely acyclic**. Revision 1 was not: it derived a fountain's region
from its city's parent, while region canonicality was tie-broken on region `fountain_count` — so
counts depended on parentage which depended on canonicality which depended on counts. Two rules
break it:

> **(a) `region_place_id` is the direct point-in-polygon match** against the country's eligible
> region polygons. It is **never** derived from the fountain's city.
>
> **(b) Canonical *region* selection is purely geometric** — it never reads a fountain count. So no
> fountain write can ever change which region owns a level-2 URL (this is what makes the scoped
> paths in §5.1 provably safe).

1. **Rebuild `place_boundary_cells`** — unchanged (`ST_Subdivide`, `TRUNCATE` + re-`INSERT` +
   `ANALYZE`).
2. **Derive `place_kind`** for every boundary from `subtype` + the country's eligible sets.
3. **Parent the regions:** `region.parent_id` = the `place_kind='country'` row with the same
   `country_code` (a cheap column lookup — what the existing `_PARENT_SET_SQL` already does, and
   correct for this tier).
4. **Assign the three fountain FKs** — `country_place_id`, `region_place_id`, `city_place_id` —
   each by an **independent** point-in-polygon LATERAL against `place_boundary_cells`
   (`ST_Covers(c.geom, f.location::geometry)`, the existing pattern). City assignment is unchanged
   (most-specific eligible: `locality` > `localadmin` > `county`, smallest-area, `overture_id`
   tie-break). An unmatched point still yields **country-only, never a coarser forced tier**
   (#127 §11.5). This is the **raw** assignment — it may land on a non-canonical row; step 9 fixes
   that.
5. **Select canonical regions** — one per `(country_code, slug)` among `place_kind='region'`,
   tie-broken **`ST_Area(boundary) DESC, overture_id ASC`**. `boundary` is `Geography`, so this is
   **geodesic** area in m² — *not* `ST_Area(boundary::geometry)`, which would be degrees² and
   latitude-distorted, making "largest region wins" wrong away from the equator. Region
   canonicality is not on the hot path, so correctness beats the geometry shortcut. **Deliberately
   count-free** (rule (b)): a region's URL ownership is a pure function of the boundary data,
   immutable under fountain writes.
6. **Parent the cities:** `city.parent_id` = the smallest-area **canonical** region covering
   `ST_PointOnSurface(city.boundary::geometry)`; if the country has no region tier → the country;
   if the country has a region tier but no canonical region covers the city → **NULL** (the
   degenerate case of §3, which then cannot be canonical).
7. **Recount `fountain_count`** for every place — a 3-way `UNION ALL` over the three FK columns
   (was 2-way). A region's count is **every non-hidden fountain inside it**, not the sum of its
   cities' counts: fountains in unincorporated areas still roll up to the state. This is the honest
   number and it is what the state page displays.
8. **Select canonical cities** — one per `(country_code, parent_id, slug)` among
   `place_kind='city'` with a **non-NULL** `parent_id`; tie-break subtype priority
   (`locality` > `localadmin` > `county`), then `fountain_count DESC`, then `overture_id ASC`
   (preserving #127 §4.3's "prefer the richer page").
9. **Remap `fountains.city_place_id` onto the canonical city of its URL group.** *(New in rev 3 —
   this closes a real reachability hole.)* Step 4 assigns the raw covering polygon, which may be the
   **non-canonical** twin of a `(country_code, parent_id, slug)` group. Every public city endpoint
   filters `WHERE city_place_id = <canonical place id>`, so those fountains would exist, be counted,
   and satisfy the "city resolved" indexability predicate — while **appearing on no city page at
   all**. So:
   - if the assigned city is non-canonical, repoint `city_place_id` at the **canonical** row of its
     `(country_code, parent_id, slug)` group;
   - if the assigned city has a **NULL parent** (the degenerate §3 case — it owns no URL and has no
     canonical sibling), set `city_place_id = NULL` so the fountain is country-only rather than
     falsely "city resolved".

   **Consequence:** a non-NULL `city_place_id` now *always* points at a canonical, URL-owning city.
   This keeps the existing `fountain_indexable_predicate()` (`city_place_id IS NOT NULL`,
   `backend/app/filters.py`) correct **by construction** — no predicate change needed — and
   guarantees every fountain with a city is listed on exactly one crawlable city page.
10. **Recount `fountain_count`** again, so the published counts reflect the step-9 remap (a
    non-canonical twin ends at 0; the canonical row carries the group's fountains).

**Containment test (step 7).** `ST_PointOnSurface` is used rather than the centroid (a centroid can
fall outside a concave or multi-part polygon) and rather than full `ST_Covers(parent, child)`
(brittle against boundary-precision disagreements between tiers). `boundary` is
`Geography(MULTIPOLYGON,4326)`, so the expression casts explicitly —
`ST_PointOnSurface(pb.boundary::geometry)` — and is tested against the **parent's
`place_boundary_cells`** via the GiST index, exactly like the fountain PIP, so this does not
regress into a raw geography scan across every region × city.

**Breadcrumbs come from the place tree, not from `region_place_id`.** A fountain's displayed
hierarchy is `city → city.parent_id → country`. Because `region_place_id` is an independent
geometric fact, the two can disagree for a **city that straddles a state line** (Texarkana, Kansas
City): the fountain is listed on its city's page (nested under the city's region) while being
*counted* in the region its point actually falls in. Both statements are true, the breadcrumb is
always coherent, and this divergence is **asserted by a test** rather than left as a latent
surprise.

**Idempotence is a required test.** Step 4 re-derives the raw assignment from geometry alone on
every run, overwriting step 9's remap, so steps 5→10 reproduce identically. The test therefore
asserts **the final state after two refreshes equals the final state after one** (snapshot
`fountains.{country,region,city}_place_id` + `place_boundaries.{place_kind,parent_id,is_canonical,
fountain_count}` and compare) — *not* "zero rows written", since step 4 legitimately rewrites the
remapped FK back to raw before step 9 re-applies it.

### 5.1 Scoped update paths — `recompute_fountain_membership()` / `recompute_place_counts()`

These already exist (a user add, an OSM import, a hide/unhide, an admin delete) and **must not be
left behind by this change**, or canonical state goes stale the moment a fountain is added.

A scoped update:
1. Re-assigns all three FKs for the touched fountain (the step-4 LATERALs, scoped by `fountain_id`).
2. **Applies the step-9 canonical remap** to that fountain — so a scoped write can never introduce
   a fountain pointing at a non-canonical city.
3. Recounts the affected places (old ∪ new).
4. Re-selects **canonical cities** for the affected `(country_code, parent_id, slug)` groups; if the
   winner changed, **re-applies the step-9 remap to that whole group's fountains**.
5. **Recounts every city place in the affected group *again*, after that remap** — the scoped
   mirror of full-refresh step 10. Without it the counts go stale exactly when the winner flips:
   old winner A holds 10 remapped fountains, B overtakes it, the remap moves A's fountains to B, and
   unless A and B are recounted **after** the move, A keeps a non-zero count and B is undercounted —
   which can flip `indexable` around the threshold `K`. Tested with a winner flip asserting final
   counts `A = 0` and `B = <group total>`.

**They never re-select canonical regions and never re-parent cities — and this is now an
invariant, not an assumption.** Because canonical region selection is **purely geometric**
(step 5, rule (b)), *no fountain write can change it*. There is no count to go stale. Region
parentage and canonicality change only when boundaries change, i.e. only on a **boundary load** —
which always runs the full refresh (`boundary_cli` already calls `refresh_all_memberships`).

Review-1 justified this with "duplicate region slugs don't occur in the data, and the coverage
report would surface it." That was observability, not an invariant, and it was rightly rejected.
Rule (b) replaces it with a structural guarantee.

**Belt and braces — the coverage gate turns the residual risk into a hard blocker.** A duplicate
`(country_code, slug)` among `place_kind='region'` rows means one region silently owns another's
level-2 URL. The Slice-1e coverage gate (`backend/app/imports/seo_coverage_cli.py`) therefore
**blocks `city_routes_ready` for that country** — it is a gate failure, not a warning line.

The scoped paths' limits are **explicit and tested**: a scoped update leaves `place_kind`, region
canonicality and city parentage untouched, and never violates the §4.2 invariant.

---

## 6. Backend API (`backend/app/routers/places.py`)

Route shapes use **literal prefixes** (`regions`, `cities`, `resolve`) so that FastAPI's
declaration-order sensitivity for dynamic segments cannot bite — `/places/us/cities` can never be
captured as `{region}`. Tests assert this explicitly.

- `GET /api/v1/places` — canonical **countries**. Unchanged.
- `GET /api/v1/places/{country}/regions` — canonical regions, most fountains first. **Empty list
  for a country with no region tier.**
- `GET /api/v1/places/{country}/cities` — a **2-level** country's canonical cities.
- `GET /api/v1/places/{country}/regions/{region}/cities` — a region's canonical cities.
- `GET /api/v1/places/{country}/regions/{region}/fountains` — the region page's top fountains +
  `indexable`.
- `GET /api/v1/places/{country}/regions/{region}/cities/{city}/fountains` — the nested city page.
- `GET /api/v1/places/{country}/resolve/{slug}` — **the level-2 resolver**, returning
  `{ kind: 'region' | 'city', canonical_path, place }` or 404. The §3.1 decision lives here, once,
  server-side — the web page is a dumb consumer and never re-derives it.
- `GET /api/v1/places/{country}/{city}/fountains` — **retained** (2-level countries + backwards
  compatibility). Declared last.

`indexable` stays a **server-computed verdict** (#127 §7): `fountain_count >= K` **AND** the
place's country is `city_routes_ready`. The web never re-derives the threshold.

---

## 7. Web (`web/app/drinking-fountains/`)

- `page.tsx` — **new hub.** Countries with counts, linking down. Linked from the footer and
  `core.xml`.
- `[country]/page.tsx` — lists **regions** when the country has a region tier, else its cities.
- `[country]/[place]/page.tsx` — **the resolver route.** Next forbids two dynamic segments at one
  level, so the existing `[city]/` directory is **renamed to `[place]/`**. Implements §3.1: region
  page, 2-level city page, 308 redirect, or 404.
- `[country]/[place]/[city]/page.tsx` — the city page (the existing city page, moved).
- Breadcrumbs on every level with `BreadcrumbList` JSON-LD, so the hierarchy is machine-legible.

**Style guide (mandatory — `CLAUDE.md`).** These new elements are added to `docs/style-guide.md`
**before** they ship: **hub country grid**, **region list**, **breadcrumb trail (+ JSON-LD)**, and
the **region-page disambiguation link** (§3.2).

---

## 8. Sitemaps — exact contract

- `core.xml` — add `/drinking-fountains`.
- **`regions.xml` — new chunk.** Canonical regions of `city_routes_ready` countries.
- `cities.xml` — same set as today, but each URL is **nested** for cities under a region tier.
- **`fountains.xml` must be chunked.** It is capped at `SITEMAP_FOUNTAIN_CAP = 50000`, the US alone
  is at 24,466, and worldwide will exceed the 50k-URL sitemap limit.
  - New route: **`web/app/sitemaps/fountains/[chunk]/route.ts`**, serving
    **`/sitemaps/fountains/<n>.xml`**.
  - The `[chunk]` segment MUST match **`^(\d+)\.xml$`**; anything else → **404**. `<n>` is
    **zero-based**. Chunk `n` requests `limit=50000, offset=n*50000` from the existing backend
    endpoint (which already accepts `offset` and already returns `total_count` — **no backend
    change**).
  - The index at `/sitemap.xml` emits `ceil(total_count / 50000)` chunk entries (so
    `total_count = 100000` → chunks `0` and `1`, **not** three; `total_count = 0` → no chunk
    entries). An `<n>` at or beyond that count → **404**, never an empty 200.
  - The legacy **`/sitemaps/fountains.xml` 308-redirects to `/sitemaps/fountains/0.xml`** so the
    URL already known to Search Console does not break.
- **`/sitemap.xml` becomes dynamic and therefore needs a failure contract.** It is static today; it
  must now fetch `total_count` to know how many fountain chunks to emit. If that fetch fails, it
  **returns an uncacheable transient `503`** — matching the existing
  `web/app/sitemaps/fountains.xml/route.ts` pattern. It must **never** serve a cacheable index that
  silently omits the fountain chunks, which would de-list every fountain URL.
- Every chunk stays < 50k URLs (#127 §6).

---

## 9. Worldwide boundary coverage

`.github/boundary-source-regions.yml` gains one `overture:<cc>` row per ISO country that has an
active fountain scope, all pinned to the immutable Overture release `2026-06-17.0` already in use
(pin, never chase latest — #127 §11.3).

**Count, derived from the current `.github/osm-import-regions.yml`** (111 active scopes = 53 US
state scopes + 58 non-US scopes). Scopes are **not** 1:1 with countries:
`asia/malaysia-singapore-brunei` → **MY, SG, BN**; `europe/guernsey-jersey` → **GG, JE**;
`europe/ireland-and-northern-ireland` → **IE** (the NI part belongs to GB). That yields **61
non-US countries + US = 62**; `us` and `lu` already exist, so **60 new rows**. The plan carries the
full enumeration.

**Uncertain country codes — verify, never assume.** Overture's `country` value for `XK` (Kosovo),
`FO` (Faroe Islands), `GG` / `JE` / `IM` (crown dependencies) and `NC` (New Caledonia) may be
absent or may nest under a parent state. The boundary-load **dry-run reports a feature count**; a
dry-run that loads **zero features is the signal that the code is wrong or unsupported** — retire
that row rather than ship a country that can never resolve. This is a per-country rollout step, not
an assumption baked into the spec.

---

## 10. Migration, downgrade, and deploy ordering

The migration re-derives membership for **existing** US/LU rows. US cities acquire a region parent,
so **their canonical URLs change in the same deploy**.

- **The 308-redirect resolver (§3.1) and the migration MUST ship in the same release.** If the
  migration lands without the resolver, 1,015 indexed URLs 404.
- **`downgrade()` is a full old-model recomputation, not just an index swap.** The upgrade
  legitimately creates canonical rows that *violate* the old unique index (both Portlands), so the
  order is load-bearing:
  1. Drop `uq_place_boundaries_city_canonical` + `uq_place_boundaries_region_canonical`.
  2. `UPDATE place_boundaries SET is_canonical = false` (clear the new-model winners).
  3. Restore the old parentage: every non-country boundary's `parent_id` → its country row (the
     original `_PARENT_SET_SQL` behavior).
  4. Re-select canonical under the **old** rule — one per `(country_code, slug)` among
     city-eligible subtypes, tie-break `fountain_count`.
  5. **Only then** create `uq_place_boundaries_country_slug_canonical` (it would fail if created
     before steps 2–4).
  6. Drop `fountains.region_place_id`, `place_boundaries.place_kind`,
     `place_scope_config.eligible_region_subtypes` and its CHECK.
- **Tested end-to-end:** upgrade → downgrade → the old index exists, is satisfied, and the flat
  city API serves again.
- `alembic check` must report **no drift**, and the new index/constraint **names** are asserted
  against `pg_indexes` / `pg_constraint` — `alembic check` does not compare CHECK-constraint
  definitions, so a misnamed check can otherwise ship silently
  (`claude_help/testing-ci.md`).

**Rollout order after merge:**
1. Deploy (`gh workflow run deploy.yml --ref main`) — migration + resolver + pages go live
   together. Verify US/LU behavior (including the three §3.2 redirect/collision cases) **before**
   loading any new country.
2. Boundary-load **Germany** (dry-run → apply) as the validation country: confirm its city tier
   really is `locality`/`localadmin`, and that **Hamburg** — a city-state that is simultaneously a
   *Land* and a city — resolves as a **city** and not only as a region. Adjust DE's
   `place_scope_config` if not.
3. Fan out the remaining countries, checking each dry-run's feature count (§9).
4. Run the coverage gate; sign off `city_routes_ready` per country **in a reviewed migration** —
   loading a country does **not** index it.

---

## 11. Testing

- **Membership**
  - Two same-slug cities in different regions of one country **both** become canonical — the
    Portland case, the direct regression test for defect 3.
  - **Reachability (§5 step 9):** two same-slug city polygons in the **same** parent region — every
    fountain in the non-canonical twin is remapped onto the canonical row and **is listed on the
    canonical city page**. Nothing is orphaned. A fountain whose only covering city has a NULL
    parent gets `city_place_id = NULL` and is therefore not falsely "city resolved".
  - **Canonical region selection ignores fountain counts** (§5 rule (b)): adding/hiding fountains
    never flips a region's canonicality.
  - `refresh_all_memberships()` run **twice** yields an identical final state (idempotence, §5 —
    snapshot-compare, not "zero writes").
  - The §4.2 invariant: no canonical city has a NULL parent or a non-canonical region parent.
  - A region-vs-city slug collision resolves to the region (§3.2).
  - A country with no region tier keeps 2-level cities (the LU case).
  - An unmatched point → country-only.
  - A city straddling a region border: its fountains list on the city's page while counting in the
    PIP region (§5) — the breadcrumb stays coherent.
  - **Scoped paths** (§5.1): a single-fountain recompute re-canonicalizes its city group but leaves
    `place_kind`, region canonicality and city parentage untouched, and does not violate the
    invariant.
- **Migration:** upgrade on a seeded US-like fixture promotes both Portlands; downgrade restores
  the old index without violating it; index/CHECK names asserted from the catalog.
- **Resolver:** all four branches of §3.1, plus the three enumerated collisions.
- **Redirects:** a legacy flat city URL 308s to its nested URL and the target is canonical.
- **Sitemaps:** nested city URLs; `regions.xml`; `fountains.xml` chunk boundaries at exactly 50k
  and at `total_count % 50000 == 0`; an out-of-range chunk 404s; the legacy `fountains.xml` 308s.
- **API:** `/places/us/cities` and `/places/us/resolve/x` are not captured by a dynamic
  `{region}`/`{city}` route (§6).
- **Indexability:** a country that is not `city_routes_ready` is `noindex` and absent from
  sitemaps, even with a high `fountain_count`.

---

## 12. Decisions

| Decision | Choice | Why |
|---|---|---|
| City URL shape | Nest under region; 308 from legacy flat URLs | The only shape that can represent duplicate city names; preserves the indexed URLs |
| Region segment | Per-country, data-driven; empty set ⇒ no tier | City-states and micro-countries have no meaningful state tier |
| Mixed 2-/3-level within one country | **Not allowed** | Keeps level 2 unambiguous: in a region-tier country, level 2 is regions only |
| Region-vs-city slug collision | Region wins; 3 enumerated legacy URLs change identity | Deterministic and stable — suffixing the region would let an unrelated city rename a state's URL |
| `fountains.region_place_id` | **Direct PIP only**, never derived from the city | Removes the canonicality↔count cycle; makes the pass acyclic and idempotent |
| Canonical **region** tie-break | **Purely geometric** (`ST_Area DESC, overture_id`) — never a fountain count | No fountain write can change a level-2 URL owner; makes the scoped paths provably safe rather than "probably fine" |
| `fountains.city_place_id` | **Remapped onto the canonical city** of its URL group (step 9); NULL if the group owns no URL | Closes a real reachability hole — a fountain on a non-canonical twin would be counted and "city resolved" yet listed on **no** page |
| Duplicate region slug in a country | **Hard coverage-gate blocker** on `city_routes_ready` | An invariant, not a warning line |
| Breadcrumb source | The place tree (`city.parent_id`), not `region_place_id` | Coherent even when a city straddles a region border |
| Region `fountain_count` | Every fountain in the region, not the sum of its cities | Honest; fountains outside any city still roll up |
| `eligible_region_subtypes` | `NOT NULL`, empty array ⇒ no tier | Two states, not three — no `COALESCE` tri-state trap |
| Scoped update paths | Re-canonicalize cities only; never re-parent or re-canonicalize regions | Regions change only on a boundary load, which runs the full pass |
| `place_kind` | Stored, derived on refresh | Explicit routing + explicit partial indexes; no re-derived subtype ladders |
| New-country indexing | Still gated by `city_routes_ready` | Loading data is not the same as publishing it |
