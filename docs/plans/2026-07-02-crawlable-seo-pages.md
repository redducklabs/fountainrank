# Crawlable SEO pages — implementation plan (2026-07-02)

Implements `docs/specs/2026-07-02-crawlable-seo-pages-design.md` (#127). Revised after Codex
plan-review-1. **Approach: offline OSM admin boundaries → PostGIS point-in-polygon; no
LocationIQ; country + city pages.**

Rules: one task at a time, TDD where it applies, frequent Conventional commits, branch → PR →
CI green + Codex `VERDICT: APPROVED` + comments addressed → squash-merge. New UI →
`docs/style-guide.md`. **Production data-load writes (the boundary load) go through the CI-only
production data-load path — never a local production DB write; local tests + Alembic use the
normal local PostGIS container.** IaC read-only locally. This plan must be Codex-approved before
Slice 1 code.

Sliced by **vertical, releasable increments** — each ships its data + API + web route + sitemap/
noindex policy + tests together (a slice never exposes a public route without its discoverability
+ indexability controls).

---

## Slice 0 — Boundary source decision (spike, no shipped behavior) — ✅ DONE (2026-07-02)

**Decision: Overture Maps Divisions `division_area`, release-pinned, loaded via DuckDB from
anonymous public S3.** Full decision note + evidence in **spec §11**; sample artifact at
`docs/specs/2026-07-02-crawlable-seo-pages-slice0-sample.geojson` (7 features — 4 `Polygon` + 3
`MultiPolygon` raw; all validate as `MULTIPOLYGON` after `ST_Multi` coercion in PostGIS 17-3.5). Vetted hands-on: 0.000% invalid rings across 228k features in 8
countries; US = 31,831 `locality` polygons (San Diego + suburbs + county all present); `ST_Covers`
PIP verified; ODbL-1.0 + CC0-1.0 licensing.

**Deltas that carry into Slice 1 (see spec §11.4–§11.6):**
- **Identity key = Overture GERS `division_area.id`** (`overture_id`), NOT an OSM id. OSM
  `(osm_type, osm_id)` is **best-effort provenance** — from `sources[]` where
  `dataset='OpenStreetMap'`, prefer relation > way > node, decode `^([nwr])(\d+)@\d+$`, drop
  `@version`; nullable. (The `a<2*rel+1>` decode is **not** used on the Overture path — only on the
  osmium fallback.)
- **City tier is a `subtype`, not `admin_level=8`.** Overture `admin_level` is normalized
  (country=0, region=1, county=2, **NULL** at `locality`). Country ← `subtype='country'`; city ← the
  finest polygonal municipal tier per country (`locality`/`localadmin`, falling back to `county`
  where a country has no locality tier — e.g. Luxembourg communes). Overture `locality` subsumes the
  §4.2 `place=*` fallback.
- **Filter `class='land'`** (excludes the maritime `division_area` twin → one area per division).
- `place_boundaries` gains `overture_id` (unique), `subtype`, `class`; `admin_level`/`osm_type`/
  `osm_id` nullable (Slice 1a finalizes the columns).
- The boundary-source registry stores the **pinned `overture_release_id`** (immutable, reproducible).

*Original spike scope (for reference): the boundary source is **independent of the per-fountain
import registry** (per-state → wrong unit for country polygons). Primary candidate vetted was a
prebuilt OSM-derived dataset; the compared fallback was osmium-from-Geofabrik (kept as a per-scope
escape hatch, spec §11.7). Deliverable = decision note appended to the spec + a real sample GeoJSON
checked for `ST_MakeValid` cleanliness; no production code in Slice 0.*

## Slice 1 — Boundary load pipeline + `place_boundaries` + membership backfill (no public routes)

**Built around the Slice-0 decision (Overture Divisions `division_area`; spec §11). The OSM-native /
`admin_level=8` / `(osm_type,osm_id)`-keyed design has been replaced — that model now lives ONLY in
the fallback path (spec §11.7).**

- **1a.** `place_boundaries` table + reversible Alembic (spec §5 as amended by §11.6):
  **`overture_id` (unique — the upsert key)**, `subtype`, `class`, nullable `admin_level`
  (Overture-normalized, informational), nullable `osm_type`/`osm_id` (provenance), `name`,
  `country_code`, `slug`, `is_canonical`, `parent_id` (FK→self, containment-derived);
  `boundary Geography(MULTIPOLYGON,4326)` GIST-indexed; **partial unique index on
  `(country_code, slug)` WHERE `is_canonical`**. Tests: migration up/down; model round-trip;
  `alembic check` clean; index/constraint names verified in `pg_indexes`/`pg_constraint`.
- **1b.** Boundary **loader** for Overture `division_area` (spec §11.3–§11.6). Consume the
  DuckDB-fetched GeoJSON/FlatGeobuf (release-pinned, `class='land'`); **key upserts idempotently on
  `overture_id`** (GERS); **`ST_Multi`-coerce** every geometry into the `MULTIPOLYGON` column
  (Overture mixes `Polygon`/`MultiPolygon`), then `ST_MakeValid` + reject/flag still-invalid
  (expected rare — 0% in the Slice-0 spike, but keep the guard). Set `subtype`, `class`,
  `admin_level`; derive `country_code` from `country`; assign a **sticky `slug`** from
  `names.primary`; **decode OSM provenance** from `sources[]` where `dataset='OpenStreetMap'` (prefer
  relation>way>node, `^([nwr])(\d+)@\d+$`, drop `@version`) into nullable `osm_type`/`osm_id`.
  `parent_id` is derived by containment (1d), NOT from Overture's hierarchy (do not load the point
  `division` type). **Fixtures (real Overture shape): a `Polygon` feature and a `MultiPolygon`
  feature (coercion path), a feature with NO OSM source (nullable provenance), and a multi-entry
  `sources[]` exercising the relation>way>node decode.** Pure extraction/slug/collision/
  provenance-decode logic unit-tested. *(The `a<2*rel+1>` area-id round-trip test belongs to the
  fallback osmium loader only, §11.7 — not this path.)*
- **1c.** New **`osm-boundary-load.yml`** CI workflow (manual dispatch): **validate** the dispatched
  release-id + country scope against the **boundary-source registry** using the fail-closed pattern
  of `backend/app/imports/regions.py` (syntax allow-list; **reject arbitrary S3/HTTP paths**; bind
  the scope to an **active** row **before any remote read**); install **DuckDB** (+ GDAL/`osmium-tool`
  only for the §11.7 fallback); fetch `division_area` from the pinned Overture release on anon public
  S3 (`country`/bbox pushdown); PostGIS-validate; **load through the CI-only production data-load
  path — `kubectl exec` into the running backend pod (mirror `osm-import-pbf.yml`)**, the single
  write rule (spec §4.1 as amended by §11.3). Structured logs of found/inserted/updated/skipped +
  invalid-ring reasons.
- **1d.** **Mandatory precomputed membership** (spec §5, §11.5): assign each fountain to its
  **canonical** city + country place via the concrete **city-assignment ladder** (§11.5) — among the
  covering `division_area` rows whose `subtype` is in the scope's eligible-city set (default
  `{locality, localadmin}`, `+county` where a scope opts in), pick the highest-priority subtype
  (`locality`>`localadmin`>`county`), smallest-area on ties; **unmatched points → country only, no
  city**. Store `country_place_id`/`city_place_id` (or `fountain_places`) + denormalized
  `fountain_count`; select the canonical place per `(country_code, slug)` (§4.3) via `is_canonical`;
  deterministic refresh on boundary load, OSM import, and user add; transactional count updates.
  Backfill job. **Tests (per Codex spec-review): overlapping tiers (`locality` inside `county`), slug
  collisions across subtypes, a scope with partial locality coverage, an unmatched/unincorporated
  point → country-only**, plus counts + refresh correctness on a fixture.
- **1e.** **Coverage report/gate** (spec §4.2 as amended, §7): per scope emit boundary count,
  matched/unmatched fountains, top unmatched clusters, invalid-ring skips, and **city-assignment % by
  subtype**. A scope's city routes are "ready" only above a threshold or with explicit owner signoff
  (which also sets the scope's eligible-city subtype set, §11.5).

## Slice 2 — Country pages (vertical: API + route + sitemap + noindex + tests)

- API `GET /api/v1/places` (countries, counts ≥ `K`; pagination cap + cache headers + hidden-row
  filter in the contract).
- Web `/drinking-fountains/[country]` (ISO-2 segment): SSR content, `generateMetadata`
  (title/description/canonical), links to top cities + top fountains. Style-guide entry.
- Sitemap: add a **country chunk**; only ready/≥`K` countries; `noindex` others. Tests fetch the
  real sitemap route + assert the country set.

## Slice 3 — City pages (the primary SEO payoff; same vertical shape)

- API `GET /api/v1/places/{country}/{city}/fountains` (hierarchical identity per spec §4.3;
  ranked, paginated, caps + cache + hidden filter).
- Web `/drinking-fountains/[country]/[city]`: SSR list/map, `generateMetadata`, canonical using
  the sticky slug; 301 for renamed slugs. Style-guide entry.
- Sitemap: **city chunk(s)** (chunk < 50k) for ready scopes only; `noindex` below `K` /
  below the coverage gate. Tests fetch real routes; assert included vs `noindex` sets.

## Slice 4 — Attribute pages

- API `GET /api/v1/fountains/by-attribute` (existing seeded keys `bottle_filler`,
  `wheelchair_reachable`; global; count ≥ `K_attr`). Web `/drinking-fountains/bottle-fillers`,
  `/wheelchair-accessible-drinking-fountains`
  + `/drinking-fountains-near-me` (static). Sitemap attribute chunk; `noindex` below `K_attr`.
  Style-guide entries. Tests.

## Slice 5 — Fountain-detail metadata (selective)

- Shared **public indexing predicate** helper (spec §7), public/non-hidden data only. Add
  `generateMetadata` to `web/app/fountains/[id]/page.tsx` (city in title/`<h1>`, canonical),
  fetching **public** data (not the viewer/admin path); `noindex` when the predicate fails.
  Add ready fountains to a **fountains sitemap chunk**. Tests: hidden/visible, rated/unrated,
  verified/stale, and that auth/admin data never affects indexability.

## Ship + verify (per slice, and final)

Full local CI mirror green; PRs Codex-approved; squash-merge. After the SEO slices are on `main`,
**deploy web** (manual). `curl` representative country/city/attribute pages → meaningful HTML in
the initial response; validate the sitemap index + chunks as real routes. Resubmit the sitemap in
**GSC + Bing**; track impressions/clicks by page+query over the next completed 28-day window.

## #128 — GA4 (owner-local; no repo code in this plan)

Owner: add the GA4 property id to the SEO agent registry (no secrets committed); `seo_health_check`
→ GA4 `ok`; confirm GA4 Realtime on the apex. Key events are **excluded** (spec §8.3).

## Sitemap topology note (Codex plan-review-1 [MAJOR])

Next `generateSitemaps` produces `/.../sitemap/[id].xml`; it does not make `/sitemap.xml` an index.
Serve an explicit **sitemap index** at `/sitemap.xml` referencing the chunk files; `robots.ts`
already points there. Account for Next 16 async `id`. Tests must fetch the actual built routes.

## Risks / watch-items
- **Boundary extraction (Slice 0/1b)** is the crux — settle the source + toolchain in Slice 0 on a
  small scope before building the rest. Fail closed + log skips; the coverage gate (1e) prevents
  silently shipping country-only pages when city coverage is poor.
- **Scale:** never live-`ST_Covers` on the public path — the precomputed membership (1d) + GIST
  index are mandatory before any public route (Slice 2+).
- **CI-only writes:** the boundary load reuses the existing production-write pattern; no local DB
  write path is introduced.
