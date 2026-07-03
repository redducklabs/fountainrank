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

> **Superseded by §11 (Slice 0 decision).** The concrete source is **Overture Divisions
> `division_area`**, keyed on the **GERS `overture_id`** (not OSM ids), loaded via **DuckDB** (not
> `ogr2ogr`-from-a-file), and written by the **same CI backend-pod `kubectl exec` as the fountain
> import** (§11.3 — the single write rule; "never local" holds, and the earlier "never the backend
> pod" phrasing in the bullets below is **retired** in favor of mirroring `osm-import-pbf.yml`). Read
> the bullets below as the original hypothesis; **§11.4–§11.6 are the binding contract.**

Boundary data has its **own source, INDEPENDENT of the per-fountain OSM import registry**. That
registry (`.github/osm-import-regions.yml`) is intentionally per-state for the US (aggregate
`north-america/us` is rejected), so a fountain-import PBF is the **wrong unit for authoritative
country polygons**. Instead:

- **Primary: a prebuilt, OSM-derived global administrative-boundary dataset** (ODbL — carry the
  attribution) providing admin_level 2 (country) + local levels + `place=*` polygons with **stable
  OSM ids** and `name`/ISO tags. Loaded **once** (refreshed infrequently) via `ogr2ogr` into
  `place_boundaries`, in a **dedicated CI workflow `osm-boundary-load.yml`** (manual dispatch) that
  writes through the existing **CI-only production data-load path** (never from a local/dev machine;
  CI-only, via the same backend-pod `kubectl exec` the fountain import uses — the single write rule,
  §11.3). Its scope is a **small boundary-source registry of its own**, not the fountain registry.
- **Alternative (Slice 0 spike only):** generate boundaries from Geofabrik **planet/continent**
  extracts via `osmium tags-filter`→`osmium export`. If chosen, it **MUST** apply osmium's area
  `type_id` decode — relation areas are emitted as `a<2*relation_id+1>`; the existing import already
  handles this — to recover a stable `osm_relation_id`, with a **round-trip test** proving a real
  multipolygon relation maps back to its OSM relation id.
- Repair geometry with `ST_MakeValid`; reject/flag still-invalid (logged). Store full OSM
  provenance (`osm_type`, `osm_id`) so upsert identity + slug stickiness survive refresh.

### 4.2 Admin levels + fallback places (resolves [MAJOR] coverage; [MAJOR] non-admin places)

> **Superseded by §11.5:** the `admin_level`-based tiering below is OSM-native. Under Overture,
> `admin_level` is normalized (country=0, region=1, county=2, NULL at `locality`) — city selection is
> by **subtype** per the §11.5 ladder, and Overture's `locality` already merges admin + populated
> place, subsuming the `place=*` fallback described below.

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

> **Superseded by §11.5:** the *Set from* column's `admin_level=2`/`admin_level=8` is OSM-native.
> Under the Overture source, country = `subtype='country'` and city = the per-country city subtype
> (§11.5); Overture `admin_level` (country=0, region=1, county=2, NULL at `locality`) is **not** the
> city selector.

### 4.5 Attribute pages (resolves [MINOR] attributes ×2)

Filter on the **existing seeded attribute keys `bottle_filler` and `wheelchair_reachable`**
(`backend/migrations/versions/0006_seed_attribute_types.py`, `backend/app/filters.py`) — the route
labels stay human-readable (`/drinking-fountains/bottle-fillers`,
`/wheelchair-accessible-drinking-fountains`). Global pages with a **minimum fountain count
`K_attr`**; per-city attribute variants are **out of scope for v1**. `noindex` below `K_attr`.

## 5. Backend

> **As amended by §11.4/§11.6 (Overture source):** the identity/upsert key is the Overture GERS
> **`overture_id`** (add it, unique); `osm_type`/`osm_id` are **nullable provenance**, not the key;
> add `subtype` + `class`; `admin_level` is nullable + Overture-normalized (not the city selector);
> the loader `ST_Multi`-coerces geometries. Read the OSM-provenance wording below as superseded
> accordingly.

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
   point-in-polygon; **no LocationIQ**. **Now concrete (Slice 0, §11): Overture Maps Divisions
   `division_area`, keyed on the GERS `overture_id`; country = `subtype='country'`, city = the
   per-country city subtype (§11.5); Overture `admin_level` is normalized, not OSM.**
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

---

## 11. Slice 0 decision note — boundary source (2026-07-02)

Deliverable of Slice 0 (spike; no production code). **Decision:** use the Overture Maps
Divisions theme, feature type `division_area`, release-pinned, loaded with DuckDB from
anonymous public cloud storage. This section is authoritative where it supersedes the
OSM-native assumptions in §4.1 / §4.2 / §4.4 / §5 / §8 (called out inline). Vetted hands-on against real data;
the fallback (osmium-from-Geofabrik) was compared and kept only as a per-scope escape hatch.

### 11.1 What was vetted
- **Tooling:** DuckDB 1.5.4 (`spatial` + `httpfs`) reading
  `s3://overturemaps-us-west-2/release/2026-06-17.0/theme=divisions/type=division_area/*.parquet`
  **anonymously** (`SET s3_region='us-west-2'`; no credentials, no requester-pays); **PostGIS
  17-3.5** (identical to CI) for geometry validation; GDAL 3.14 `ogr2ogr` for the PostGIS load.
- **Samples:** Luxembourg (365 features, loaded into PostGIS), 8 diverse countries
  (DE/FR/GB/JP/NG/MX/BR/IT — 228,094 features) for a validity rate at scale, and the US /
  San Diego area (our launch geography).

### 11.2 Evidence (why Overture)
- **Geometry validity: 0.000% invalid** across 228,094 `division_area` features in 8 countries;
  Luxembourg **365/365 valid** in PostGIS 17-3.5 with `ST_MakeValid` a no-op (no
  `GEOMETRYCOLLECTION` degeneration). Overture ships pre-cleaned geometry — a major operational
  win over raw OSM. *(Keep `ST_MakeValid` + reject/flag as a guard in the loader anyway.)*
- **City-tier coverage is polygonal and rich:** US = **31,831 `locality` polygons**; the San Diego
  launch area resolves as `locality` polygons for **San Diego** and every suburb (Chula Vista,
  Carlsbad, Coronado, El Cajon, Encinitas, Escondido, La Mesa, National City, Poway, Santee…)
  plus **San Diego County**. Luxembourg = 100 communes.
- **Point-in-polygon membership works:** `ST_Covers` on a point in Luxembourg City returns
  country → canton → commune (the city page) → macrohood, in one query.
- **Stable identity + OSM provenance:** every LU feature carries OSM provenance
  (322 relation + 43 way, **0 null**). Extracting **relation > way > node** yields the true
  boundary relation (LU country → `relation/2171347`, San Diego → `relation/253832`,
  California → `relation/165475`).
- **Duplication is only land vs maritime:** a division may have a `class='land'` **and** a
  `class='maritime'` `division_area` sharing `division_id`. Filtering **`class='land'`** gives
  exactly **one area per division, 1:1** — confirmed across **160,506 divisions in 8 countries
  including archipelagos** (ID, PH, GR, JP, NO, CA, US, GB): `max(land areas per division) = 1`,
  multi-island places stored as a single MultiPolygon (US alone: 59,316 land = 59,316 divisions;
  199 maritime). So keying on `division_area.id` is safe — no geometry union needed.
- **License is workable, subject to ODbL:** sources are **ODbL-1.0** (OpenStreetMap) + **CC0-1.0**
  (Esri Community Maps name translations) — no *incompatible* terms, but ODbL is **not
  obligation-free**: we must preserve **attribution** (`© OpenStreetMap contributors`, already
  carried) and honor ODbL's **share-alike / database** obligations for any published derived boundary
  data. Slice 1 keeps the source provenance + attribution so those obligations stay satisfiable.

### 11.3 Chosen toolchain
- **Fetch/transform:** DuckDB reads the **pinned** Overture release from anon S3 with `country`
  (and/or `bbox`) **predicate pushdown** — a single-country pull is MB-scale, so **no 6 GB PBF and
  no ~87 GB planet download**. Query shape: `WHERE class='land' AND subtype IN (…)`, emit GeoJSON /
  FlatGeobuf via `ST_AsGeoJSON`, coercing geometry with `ST_Multi` (§11.6). (Equivalent alternative:
  GDAL Parquet driver via `/vsis3/…` with `AWS_NO_SIGN_REQUEST=YES` + `-spat`/`-where`.)
  ```sql
  INSTALL spatial; INSTALL httpfs; LOAD spatial; LOAD httpfs; SET s3_region='us-west-2';
  COPY (
    SELECT id, division_id, subtype, class, admin_level, names.primary AS name,
           country, region, sources,
           ST_Multi(geometry) AS geometry     -- faithful MULTIPOLYGON (Overture mixes Polygon/MultiPolygon)
    FROM read_parquet(
      's3://overturemaps-us-west-2/release/2026-06-17.0/theme=divisions/type=division_area/*.parquet')
    WHERE country = 'LU' AND class = 'land'
      AND subtype IN ('country','region','county','localadmin','locality')
  ) TO 'out.geojson' WITH (FORMAT GDAL, DRIVER 'GeoJSON');
  ```
- **Load — one write rule:** a dedicated **`osm-boundary-load.yml`** (manual dispatch) writes through
  the **same CI-only production data-load path the fountain import uses** — `kubectl exec` into the
  running backend pod from CI and run a loader CLI there, **mirroring `osm-import-pbf.yml`**,
  PostGIS-validating before the write. This is CI-only and **never** runs from a local/dev machine.
  This is the **single** write mechanism (it supersedes §4.1's earlier "never the backend pod"
  phrasing — see the §4.1 amendment note; a dedicated Kubernetes Job would only be a *future* spec
  revision if a global load outgrows pod-exec, not a second concurrent option). Emit structured logs
  of found/inserted/updated/skipped + invalid-ring reasons, as the fountain merge does.
- **Registry + release pinning (fail-closed):** the **boundary-source registry** (its own small
  file, independent of `.github/osm-import-regions.yml`) records the **immutable
  `overture_release_id`** + the allowed country scopes. The workflow **inherits the fail-closed
  validation of `backend/app/imports/regions.py`**: allow-list the release-id + country-scope syntax,
  **reject arbitrary S3/HTTP paths**, and bind the dispatched scope to an **active** registry row
  **before any remote read** — unknown/retired scopes fail closed, exactly as the fountain import
  validates before download. Releases are reproducible; refresh is a deliberate re-dispatch with a
  new pinned id (coverage drifts release-to-release — the 2026-06-17 notes record Czechia/Slovakia
  locality coverage dropping after OSM tag edits — so pin, never chase "latest").

### 11.4 Identity + id contract — **supersedes §4.1's OSM-key mandate**
- **Upsert key = the Overture GERS `division_area.id`** (designed stable across releases), stored as
  `overture_id`. **Not** an OSM id — Overture does not hand us a single clean OSM relation id per
  boundary (the per-property `sources[]` often points at a name node, and a minority of features are
  geoBoundaries-conflated with no OSM record at all).
- **OSM provenance (best-effort, nullable):** from `sources[]` where `dataset='OpenStreetMap'`,
  **prefer relation > way > node**, decode `^([nwr])(\d+)@\d+$` → `(osm_type, osm_id)`, **discard the
  `@version`**. Nullable; never the sole key. *(No `a<2*rel+1>` area-id parity decode needed here —
  Overture emits `n`/`w`/`r` + id directly; that decode stays only on the osmium fallback.)*
- `division_id` is stored as **optional provenance** (the link to the point `division` record);
  **`parent_id` is derived by containment (`ST_Covers`), NOT from Overture's hierarchy — so we do
  not load the point `division` feature type.**

### 11.5 Level model — **supersedes §4.2's `admin_level=8`/`=2` wording**
- Overture `admin_level` is a **normalized** hierarchy, **not** OSM's: `country`→0, `region`→1,
  `county`→2, and **NULL at the `locality` tier**. **Do not select cities by `admin_level=8`.**
- **Country page** ← `subtype='country'`.
- **City page — concrete assignment ladder (binding for Slice 1d).** A fountain's city is the
  **most specific eligible city polygon that covers the point**, resolved deterministically:
  1. **Eligible set (per scope):** a scope's eligible city subtypes default to
     `{locality, localadmin}`; a scope with no/thin locality coverage (e.g. Luxembourg, whose
     municipal tier is `subtype='county'` communes) explicitly **opts in** `county`. The eligible set
     is recorded per scope (coverage gate — Slice 1e / §4.2) so US counties do **not** silently become
     "cities."
  2. **Priority:** among the covering `division_area` rows whose `subtype` is in the scope's eligible
     set, pick the **highest-priority subtype** `locality` > `localadmin` > `county`; on the
     (non-expected) chance several rows of that subtype cover the point, pick the **smallest-area**
     one.
  3. **Unmatched points** (no eligible city polygon covers them — unincorporated/under-covered areas)
     get a **country page only, never a coarser forced tier.**
  4. The §4.3 **`is_canonical` per-`(country_code, slug)`** selection then resolves any remaining slug
     collisions **across** subtypes (prefer the higher-priority subtype, tie-break by
     `fountain_count`). Exclude `neighborhood`/`microhood`/`macrohood` (too granular); `region` is
     only the country's child, never a city. **Overture `county` is country-relative** (US county vs
     LU commune) — hence the per-scope eligible set, not a fixed global subtype.

  Slice 1d **MUST** test: overlapping tiers (a `locality` inside a `county`), slug collisions across
  subtypes, a scope with **partial** locality coverage, and an **unmatched** point → country-only.
- Overture's **`locality` already merges "administrative area" + "populated place,"** so §4.2's
  separate polygonal `place=city|town` fallback is **subsumed** — and every `division_area` is a
  polygon by construction, so the "exclude raw place nodes" concern is moot.
- The §4.3 **`is_canonical` per-`(country_code, slug)`** selection **stays**, re-expressed over
  Overture subtypes (specificity ladder, tie-break by `fountain_count`).

### 11.6 `place_boundaries` schema deltas — refines §5 (finalized in Slice 1a)
- **Add** `overture_id` (unique — the upsert key), `subtype`, `class`.
- Keep `admin_level` **nullable** (Overture-normalized, informational only — not the city selector).
- `osm_type` / `osm_id` **nullable** (provenance).
- `place_kind` (`admin`|`place`) is now **derivable from `subtype`** (localities are both) — fold it
  into `subtype` or keep it as a derived convenience column.
- The loader **`ST_Multi`-coerces every geometry** before inserting into the
  `Geography(MULTIPOLYGON,4326)` column — Overture emits a mix of `Polygon` and `MultiPolygon`
  (the §11.8 sample has both). The DuckDB fetch applies `ST_Multi(geometry)` (§11.3) and the load
  coerces defensively (`ST_Multi` / `ogr2ogr -nlt PROMOTE_TO_MULTI`) so a raw `Polygon` never fails
  the `MULTIPOLYGON` insert.

### 11.7 Fallback (documented, not chosen): osmium-from-Geofabrik
DIY generation from **per-country** Geofabrik extracts via `osmium tags-filter boundary=administrative,place=* → osmium export -u type_id`, reusing the **already-built** `a<2*rel+1>`
area-id decode in `backend/app/imports/osmium_geojson.py`. Gives **native OSM `admin_level`
(2/4/6/8) + relation ids** — maximal determinism — for any scope where Overture's municipal coverage
proves inadequate. **Not chosen as primary** because continent extracts (Europe ~32 GB, N. America
~18 GB, Asia ~15 GB) **exceed the 6 GB CI cap** and **clip** country (`admin_level=2`) relations at
continent edges; the planet is ~87 GB; per-country orchestration reproduces work Overture already
did; and Overture wins on validity, coverage, licensing, and a tiny pushdown footprint. Kept as a
**per-scope escape hatch**, invoked only where the coverage gate (Slice 1e) flags Overture as thin.

### 11.8 Sample artifact
`docs/specs/2026-07-02-crawlable-seo-pages-slice0-sample.geojson` — 7 `class='land'` features
(Luxembourg country + 3 communes; San Diego city + San Diego County; California). **Overture emits
mixed geometry types — this raw sample has 4 `Polygon` + 3 `MultiPolygon`** (a faithful fixture that
exercises the mandatory `ST_Multi` coercion, §11.6). Geometry is **simplified** for size
(country/region ~200 m, city ~50 m — the loader uses full resolution). Each feature carries the
extracted properties (`overture_id`, `country_code`, `region`, `subtype`, `admin_level`, `class`,
`name`) + **decoded OSM provenance** (`osm_type`/`osm_id`). Loaded into PostGIS 17-3.5 (with
`ST_Multi` / `ogr2ogr -nlt PROMOTE_TO_MULTI`) all **7/7 validate** as `MULTIPOLYGON`. Regenerate full
resolution via the §11.3 DuckDB query.

### 11.9 Handoff Slice-0 checklist — resolved
- **Boundary dataset/source picked** (Overture Divisions `division_area`) and vetted on a small area ✅
- **CI input confirmed:** Overture releases are **immutable and re-fetchable** from anon S3 by pinned
  id — nothing to retain in-repo; the boundary-source registry records the pinned `overture_release_id` ✅
- **Ready for Slice 1** — start at **1a** (`place_boundaries` table + reversible Alembic), applying
  the §11.4–§11.6 deltas.
