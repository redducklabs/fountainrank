# Crawlable SEO pages + GA4 measurement — design spec (2026-07-02)

Design for **#127 (crawlable public pages for organic search entry points)** and the
owner-config tail of **#128 (GA4)**. Input to `docs/plans/2026-07-02-crawlable-seo-pages.md`.
Revised after Codex plan-review-1.

Prereqs already merged (do not redo): **#125** `robots.txt` + `sitemap.xml` route handlers,
**#126** `www→apex` 308 redirect + canonical tags (PR #153). `web/lib/seo/site.ts` centralizes
the canonical origin; `web/app/sitemap.ts` currently lists only static pages.

---

## 1. Problem

GSC shows near-zero organic visibility (6 impressions / 0 clicks over 28 days). The only
crawlable content is the homepage (a map app) + `/privacy` + `/terms`. No pages match the
real intents ("public drinking fountains near me", "drinking fountains in <city>", "bottle
filler", "wheelchair accessible fountain").

## 2. Critical finding — **fountains have no names**

The persisted `Fountain` (`backend/app/models.py`) has **no name/address/city** and does not
keep OSM tags (those stay on the staging `OsmImportCandidate`) — only `location` (lat/lng),
`is_working`, ratings, `current_status`, attributes. The detail page hardcodes
`<h1>Public drinking fountain</h1>`. So per-fountain pages, as-is, would be thin duplicate
content; place names must come from geometry we own, **not a geocoding call**.

## 3. Goals / non-goals

**Goals:** SSR, publicly-readable pages matching real intents (each unique title/description/
canonical/text); **real city-level value**, not just countries; indexable pages in the sitemap,
thin ones `noindex`; **zero additional LocationIQ / per-request geocoding calls**.

**Non-goals:** editorial content; indexing auth-gated surfaces (already disallowed in
`robots.ts`); mass-indexing fountains/places regardless of place+content quality.

## 4. Chosen approach — offline OSM admin boundaries (no LocationIQ)

**Decision (owner, 2026-07-02):** load OSM **administrative boundary polygons once, offline**,
into PostGIS and do point-in-polygon (`ST_Covers`) against the fountain point. The boundary's
`name` supplies the place name fountains lack (§2). Country + city pages.

### 4.1 Boundary source & pipeline (resolves plan-review-1 [BLOCKER]; plan-review-2 [MAJOR] source + ids)

Boundary data has its **own source, INDEPENDENT of the per-fountain OSM import registry**. That
registry (`.github/osm-import-regions.yml`) is intentionally per-state for the US (aggregate
`north-america/us` is rejected), so a fountain-import PBF is the **wrong unit for authoritative
country polygons**. Instead:

- **Primary: a prebuilt, OSM-derived global administrative-boundary dataset** (ODbL — carry the
  attribution) providing admin_level 2 (country) + local levels + `place=*` polygons with **stable
  OSM ids** and `name`/ISO tags. Loaded **once** (refreshed infrequently) via `ogr2ogr` into
  `place_boundaries`, in a **dedicated CI workflow `osm-boundary-load.yml`** (manual dispatch) that
  writes through the existing **CI-only production data-load path** (never local, never the backend
  pod). Its scope is a **small boundary-source registry of its own**, not the fountain registry.
- **Alternative (Slice 0 spike only):** generate boundaries from Geofabrik **planet/continent**
  extracts via `osmium tags-filter`→`osmium export`. If chosen, it **MUST** apply osmium's area
  `type_id` decode — relation areas are emitted as `a<2*relation_id+1>`; the existing import already
  handles this — to recover a stable `osm_relation_id`, with a **round-trip test** proving a real
  multipolygon relation maps back to its OSM relation id.
- Repair geometry with `ST_MakeValid`; reject/flag still-invalid (logged). Store full OSM
  provenance (`osm_type`, `osm_id`) so upsert identity + slug stickiness survive refresh.

### 4.2 Admin levels + fallback places (resolves [MAJOR] coverage; [MAJOR] non-admin places)

Prefer `admin_level=8` (city); where sparse, fall back to the nearest populated local level (7/6)
and/or named `place=city|town` polygons; country from `admin_level=2`; country-only where no usable
local level exists. Because fallback places are **not** administrative relations, `place_boundaries`
represents both kinds **without sentinels**: nullable `admin_level`, a `place_kind`
(`admin` | `place`), `source_kind`, and full OSM provenance (`osm_type` node/way/relation + `osm_id`),
with per-kind geometry validation. **Country pages come from `admin_level=2`, never the per-state
import `scope_bounds`.** Only **polygonal** `place=*` features are eligible (relation/way, or a
dataset-provided derived polygon) — raw place **nodes** are excluded, since membership is
point-in-polygon and a node has no area. The loader test suite includes a polygonal `place=*`
fixture, not only boundary-relation fixtures.

### 4.3 URL / API identity contract (resolves [MAJOR] identity ×2)

- **Country segment:** ISO-3166-1 alpha-2 (lowercased) — `/drinking-fountains/us`.
- **City segment:** a slug **unique within its country across ALL place kinds**. Because the public
  URL `/drinking-fountains/[country]/[city]` does **not** carry `admin_level`, the DB uniqueness is
  **`(country_code, slug)`**, NOT `(admin_level, country_code, slug)`. Membership backfill selects
  **one canonical SEO place per `(country_code, slug)`** (prefer admin_level 8, then 7/6, then
  `place=*`; tie-break by `fountain_count`) via an `is_canonical` flag; non-canonical candidates are
  retained but **excluded from the public namespace**.
- `place_boundaries` stores an **immutable `id`** + the sticky `slug`; API lookup is by full
  hierarchy `GET /api/v1/places/{country}/{city}/fountains` or immutable id — never a global slug.
- **Renamed boundary:** slug is sticky (assigned once); a changed slug keeps the old route as a 301
  to the new canonical; the canonical tag uses the current stored slug.

### 4.4 Page types (each an indexable, SSR route)

| Route | Set from | Content | Indexable? |
|---|---|---|---|
| `/drinking-fountains/[country]` | admin_level=2 | Intro + count + top cities + top fountains | Yes |
| `/drinking-fountains/[country]/[city]` | admin_level=8 (or fallback) | Intro + count + list/map, top-rated first | **Yes — primary** |
| `/drinking-fountains/bottle-fillers`, `/wheelchair-accessible-drinking-fountains` | attribute filter (§4.5) | Curated copy + matching fountains | Yes (global; `noindex` below `K`) |
| `/drinking-fountains-near-me` | static | Explains near-me + map deep-link + top cities | Yes |
| `/fountains/[id]` | + containing city | `generateMetadata`, city in `<h1>`/title | **Selective** — §7 predicate; else `noindex` |

### 4.5 Attribute pages (resolves [MINOR] attributes ×2)

Filter on the **existing seeded attribute keys `bottle_filler` and `wheelchair_reachable`**
(`backend/migrations/versions/0006_seed_attribute_types.py`, `backend/app/filters.py`) — the route
labels stay human-readable (`/drinking-fountains/bottle-fillers`,
`/wheelchair-accessible-drinking-fountains`). Global pages with a **minimum fountain count
`K_attr`**; per-city attribute variants are **out of scope for v1**. `noindex` below `K_attr`.

## 5. Backend

- **`place_boundaries`** (new): immutable `id`; `place_kind` (`admin`|`place`); nullable
  `admin_level`; `source_kind`; OSM provenance (`osm_type`, `osm_id`); `name`; `country_code`;
  `slug`; `parent_id` FK→self; **`is_canonical`** (the one SEO place per `(country_code, slug)`,
  §4.3); `boundary` `Geography(MULTIPOLYGON,4326)` **GIST-indexed**; `source_label`; timestamps.
  Public-namespace uniqueness: a **partial unique index on `(country_code, slug)` WHERE
  `is_canonical`** (matches the public URL, which omits `admin_level`). Reversible Alembic; verify
  index/constraint names in `pg_indexes`/`pg_constraint`.
- **Precomputed membership is MANDATORY** (resolves [MAJOR] perf). Assign each fountain to its
  country/city at boundary-load and at fountain create/import time (a `fountain_places` table or
  `country_place_id`/`city_place_id` columns on `fountains`), plus **denormalized `fountain_count`
  per place**. The **public request path uses the precomputed assignment**, never a live
  `ST_Covers`. Live point-in-polygon is a backfill/operator path only. Define refresh triggers
  (boundary load, OSM import, user add), staleness tolerance, and how counts are transactionally
  updated or rebuilt.
- **Public, unauthenticated, cache-friendly endpoints** — explicit pagination caps + cache
  headers + hidden-row filters **in the contract**, not just tests; `(lon,lat)` via `app/geo.py`:
  - `GET /api/v1/places` — countries / cities (by parent) with counts, only count ≥ `K`.
  - `GET /api/v1/places/{country}/{city}/fountains` — ranked, paginated.
  - `GET /api/v1/fountains/by-attribute` — attribute (± place).
  - `GET /api/v1/fountains/{id}/place` + the **public indexing predicate** (§7).

## 6. Sitemap (resolves [MAJOR] — Next `generateSitemaps` corrected)

Next.js `generateSitemaps` emits **multiple files at `/.../sitemap/[id].xml`** — it does **not**
turn `/sitemap.xml` into an index. Topology:
- A **sitemap index** served at `/sitemap.xml` (explicit route handler) that references the chunk
  sitemaps (the `generateSitemaps` `/sitemap/[id].xml` outputs and/or explicit chunk handlers).
  `robots.ts` keeps pointing at `/sitemap.xml` (now the index). Keep each chunk < 50k URLs.
- Chunks: countries, cities, attributes, and selectively fountains. `lastModified` from real data.
- Handle Next 16's async `id` param. **Tests fetch/inspect the actual built routes**, not only the
  returned arrays.

## 7. Metadata & thin-content policy (resolves [MAJOR] predicate)

- One **public indexing predicate** in a shared server helper / one backend response, computed
  from **public, non-hidden, unauthenticated** data only — auth/admin data never influences
  indexability or SEO copy. A fountain is indexable iff: a city resolves **AND** it is not hidden
  **AND** (`rating_count ≥ 1` **OR** (`is_working` **AND** `current_status` not a negative state)).
  Places/attribute pages indexable iff `fountain_count ≥ K`.
- `generateMetadata` uses that predicate; `noindex` (`robots: { index: false }`) everything else.
- `generateMetadata` on the dynamic `force-dynamic` detail page must fetch **public** data only
  (not the viewer-aware/admin path). Tests: hidden vs visible, rated vs unrated, verified vs stale.
- Unique title/description/`alternates.canonical` (resolves against `metadataBase`). New page
  templates → `docs/style-guide.md`.

## 8. Decisions

1. **City derivation — RESOLVED:** offline OSM admin boundaries (level 2 + 8, with §4.2
   fallback) from an **independent prebuilt boundary source** (§4.1), loaded once; PostGIS
   point-in-polygon; **no LocationIQ**.
2. **Index individual fountains — RESOLVED: yes, selectively**, under the §7 predicate.
3. **GA4 key events — EXCLUDED from this plan.** #128's repo scope is nil (GA4 already
   installed); events, if ever wanted, are a separate GA4-spec addendum + PR. #128's remaining
   work is owner-local registry config (§9).

## 9. #128 — GA4 (owner-local, not repo code)

GA4 already installed (`web/lib/analytics.ts`, `G-BG3PYM6T43`, consent-gated, path-only per
`docs/specs/2026-06-30-ga4-web-analytics-design.md`); organic landing-page/source data is already
collected. Remaining: owner adds the GA4 property id to the SEO agent's local registry (no secrets
committed) and runs `seo_health_check` until GA4 = `ok`; confirm GA4 Realtime on the apex.

## 10. Rollout / verification

`curl` representative country/city/attribute pages → meaningful HTML in the initial response;
validate the sitemap index + chunks fetch as real routes; excluded/thin pages are `noindex` and
absent from the sitemap. After deploy: resubmit the sitemap in GSC + Bing; watch impressions/
clicks by page+query over the next completed 28-day window; compare GSC clicks vs GA4 organic
sessions by landing page.

---

## Process note

Significant multi-layer feature. Per `claude_help/development-process.md`: this spec + the plan
must be **Codex-approved** before implementation code; then implement task-by-task. The boundary
load (production data-load writes) uses the **CI-only production data-load path** — never a local
production DB write; local tests + Alembic use the normal local PostGIS container.
