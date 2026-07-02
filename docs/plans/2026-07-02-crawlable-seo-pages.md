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

## Slice 0 — Boundary source decision (spike, no shipped behavior)

The boundary source is **independent of the per-fountain import registry** (which is per-state, so
the wrong unit for country polygons). **Primary candidate: a prebuilt, OSM-derived global
admin-boundary dataset** (ODbL) with stable OSM ids + `name`/ISO tags. Vet it on a small area
(e.g. a single small country): admin_level 2/8 coverage, `place=*` fallback availability,
invalid-ring rate, stable-id availability, size, licensing/attribution. Compare against the
**fallback** path (generate from a Geofabrik planet/continent extract via `osmium tags-filter`→
`osmium export`, which then MUST decode osmium's `a<2*rel+1>` area ids + a round-trip test).
**Deliverable:** a decision note appended to the spec (chosen source + toolchain + id contract) and
a real sample GeoJSON checked for `ST_MakeValid` cleanliness. No production code ships in Slice 0.

## Slice 1 — Boundary load pipeline + `place_boundaries` + membership backfill (no public routes)

- **1a.** `place_boundaries` table + reversible Alembic (spec §5 shape: `place_kind`, nullable
  `admin_level`, `osm_type`/`osm_id`, `is_canonical`, `parent_id`; GIST index on `boundary`;
  **partial unique index on `(country_code, slug)` WHERE `is_canonical`** — matches the public URL,
  which omits `admin_level`). Tests: migration up/down; model round-trip; `alembic check` clean;
  index/constraint names verified in `pg_indexes`/`pg_constraint`.
- **1b.** Boundary **loader** for the chosen source (Slice 0). Ingest admin (level 2 + local) +
  `place=*` fallback polygons; build MULTIPOLYGONs; `ST_MakeValid` + reject/flag still-invalid;
  set `place_kind` + full OSM provenance; derive `country_code` + sticky `slug` + parent link
  (city→country by containment). **Stable-id contract:** use the dataset's stable OSM id, or (osmium
  path) decode the `a<2*rel+1>` area id — upsert idempotently keyed on `(osm_type, osm_id)`.
  **Fixtures: a relation multipolygon with holes, an invalid/open relation, and a polygonal
  (way/relation) `place=*` fallback** (raw place nodes are excluded — no polygon for point-in-polygon).
  Pure extraction/slug/collision/id-decode logic unit-tested (incl. the area-id round-trip).
- **1c.** New **`osm-boundary-load.yml`** CI workflow (manual dispatch): fetch the chosen boundary
  dataset (its own small boundary-source registry, independent of the fountain registry); install
  GDAL (+ `osmium-tool` only if the osmium path was chosen); run the loader via **`ogr2ogr`**;
  **load through the CI-only production data-load path** (mirror the fountain merge). Structured logs
  of found/inserted/updated/skipped + invalid-ring reasons.
- **1d.** **Mandatory precomputed membership** (spec §5): assign each fountain to its **canonical**
  city/country place (`fountain_places` or `country_place_id`/`city_place_id`), selecting the
  canonical place per `(country_code, slug)` (§4.3) + denormalized `fountain_count`; deterministic
  refresh on boundary load, OSM import, and user add; transactional count updates. Backfill job.
  Tests: containment assignment + canonical selection + counts on a fixture; refresh correctness.
- **1e.** **Coverage report/gate** (spec §4.2, §7): per scope emit boundary count, matched/
  unmatched fountains, top unmatched clusters, invalid-ring skips, city-assignment %. A scope's
  city routes are "ready" only above a threshold or with explicit owner signoff.

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
