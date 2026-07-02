# Crawlable SEO pages + GA4 measurement — design spec (2026-07-02)

Design for **#127 (crawlable public pages for organic search entry points)** and
**#128 (configure GA4 for SEO performance analysis)**. This spec is the input to
an implementation plan; it is **not yet Codex-reviewed** — review it before
planning per `claude_help/codex-review-process.md`.

Prereqs already merged this session (do not redo): **#125** `robots.txt` + `sitemap.xml`
route handlers and **#126** `www→apex` 308 redirect + self-referential canonical tags
(PR #153, on `main`). `web/lib/seo/site.ts` centralizes the canonical origin;
`web/app/sitemap.ts` currently lists only the static pages and explicitly defers
per-fountain / dynamic URLs to this work.

---

## 1. Problem

GSC shows near-zero organic visibility (6 impressions / 0 clicks over 28 days).
The only crawlable content is the homepage (a map app) plus `/privacy` and
`/terms`. There are no pages that match the observed/expected intents
("public drinking fountains near me", "drinking fountains in <city>", "bottle
filler", "wheelchair accessible fountain").

## 2. Critical finding that shapes the design — **fountains have no names**

`FountainDetail` (`backend/app/schemas.py`) has **no `name`/`address`/`city`** —
only `location` (lat/lng), `is_working`, ratings, `current_status`, attributes.
The web detail page hardcodes `<h1>Public drinking fountain</h1>` for every
fountain (`web/components/fountain/FountainDetail.tsx:31`).

**Implication:** naively emitting one indexable page per fountain would create
thousands of near-identical, title-duplicate, thin pages — which **hurts** SEO
(Google demotes thin/duplicate content) rather than helping. Per-fountain pages
are only worth indexing if each gets a **real location name** (reverse-geocoded
locality) and enough content. This is the central design decision below.

## 3. Goals / non-goals

**Goals**
- Ship server-rendered, publicly-readable pages that map to real query intents,
  each with a unique title, meta description, canonical URL, and meaningful text.
- Include the indexable pages in `sitemap.xml`; exclude/`noindex` thin ones.
- Keep everything consistent with the existing canonical host + metadata setup.

**Non-goals**
- Blog/editorial content. Auth-gated surfaces (`/account`, `/admin`) stay out of
  the index (already disallowed in `robots.ts`).
- Mass-indexing every fountain regardless of content quality (see §2).

## 4. Proposed page types (each an indexable, SSR route)

| Route (proposed) | Content | Indexable? |
|---|---|---|
| `/drinking-fountains/[city]` (city/locality landing) | Intro copy + count + a list/map of that locality's fountains, top-rated first | **Yes** — the primary organic play |
| `/drinking-fountains/bottle-fillers`, `/wheelchair-accessible-drinking-fountains` (attribute landings) | Curated copy + fountains with that attribute (optionally per-city) | **Yes** |
| `/drinking-fountains-near-me` (intent landing) | Explains near-me + deep-links to the map (geolocation) and top cities | **Yes** (static, no geo in URL — "near me" can't be a static URL) |
| `/fountains/[id]` (existing detail) | Add reverse-geocoded locality to `<h1>`/title; add `generateMetadata` | **Selective** — index only when a locality resolves **and** the fountain has content (≥1 rating / working+verified); else `noindex` |

**Key decision — how to derive "city/locality" (fountains have no locality field). Options:**
- **A. Reverse-geocode + persist.** Batch reverse-geocode each fountain to
  `locality`/`admin_area` (extend `backend/app/geocoding.py`; LocationIQ is
  already wired via the public `/api/v1/geocode`, but that is *forward* geocode —
  reverse needs adding + rate-limit/caching). Store on the fountain; regenerate on
  import. Enables both city pages and per-fountain titles. **Most flexible, most work.**
- **B. Reuse OSM registry regions.** The OSM import already carries region
  `scope_bounds` (`backend/app/models.py:232`). Use those polygons as the "areas"
  and generate a landing per region. **Less granular (regions, not cities), but no
  new geocoding.**
- **C. Curated seed of top cities** with bounding boxes; query via the existing
  `/fountains/bbox`. **Fast to ship, limited coverage, manual upkeep.**

Recommendation: **A** for the real product (reverse-geocoded locality unlocks both
city pages and non-thin per-fountain titles), with **C** as an optional
launch-fast subset. Confirm with owner (§8).

## 5. Backend work

- Reverse-geocode support (Option A): a cached reverse-geocode in
  `geocoding.py`; a migration adding `locality` / `admin_area` (+ index) to the
  fountain; a backfill (one-off + on import). Respect LocationIQ rate limits.
- Aggregation/enumeration endpoints (public, unauthenticated, cache-friendly):
  - list localities with fountain counts (for city-page generation + sitemap);
  - fountains in a locality (paginated, ranked) for the city page;
  - fountains by attribute (+ optional locality);
  - an enumeration of indexable fountain ids for the sitemap.
- Follow existing patterns: PostGIS `(lon,lat)` via `app/geo.py`, structured logs,
  `list[str]`-as-`str` settings rule, drift-free Alembic.

## 6. Sitemap strategy

- Move to a **dynamic** sitemap. With the worldwide OSM import (#131) the URL
  count can exceed the 50k/sitemap limit, so use Next.js **`generateSitemaps`** to
  emit a **sitemap index** with chunks (cities chunk, attribute chunk, fountains
  chunks). `robots.txt` already points at `/sitemap.xml`.
- Only include indexable URLs (§4). Set `lastModified` from real data
  (`last_verified_at` / `last_rated_at`) where available.

## 7. Metadata & thin-content policy

- `generateMetadata` on every indexable route: unique title + description +
  `alternates.canonical` (resolves against `metadataBase`, already set).
- `noindex` (via `robots: { index: false }`) for: hidden fountains, fountains with
  no resolved locality, and any page with no meaningful content.
- Keep OG/Twitter absolute URLs (inherited from `metadataBase`).
- New UI/pages → update `docs/style-guide.md` (project rule).

## 8. Open decisions for the owner

1. **City derivation:** Option A (reverse-geocode + persist), B (OSM regions), or
   C (curated cities) — or A-scoped-to-a-few-cities for launch?
2. **Index individual fountains at all?** Only-with-locality+content, or
   aggregate pages only (skip per-fountain indexing entirely)?
3. **GA4 key events (see §9):** add them (small privacy-design change) or leave
   GA4 path-only for now?

## 9. #128 — GA4 for SEO measurement

Status: **GA4 is already installed** (`web/lib/analytics.ts`, id
`G-BG3PYM6T43`; consent-gated; **deliberately path-only** — query strings
stripped, no account identifiers — per `docs/specs/2026-06-30-ga4-web-analytics-design.md`).
Organic landing-page + traffic-source data is therefore **already collected**
automatically once traffic exists.

Remaining work is mostly **owner-local, not repo code**:
- Add the FountainRank **GA4 property id** to the SEO agent's local registry
  (no secrets committed); run `seo_health_check` until GA4 reports `ok`.
- Verify GA4 Realtime shows traffic on the production apex.

**Optional code (needs a spec addendum + Codex review):** define key events
(`sign_in`, `add_fountain`, `rate_fountain`, `use_location`). This is a change to
the intentionally minimal, privacy-first GA4 design, so it must stay
consent-gated and carry **no PII / no identifiers / no query strings**. Recommend
deciding in §8.3 before implementing.

## 10. Rollout / verification

- `curl` representative pages → confirm meaningful HTML in the initial response.
- Confirm indexable pages appear in `sitemap.xml`; thin/hidden ones are excluded
  or `noindex`.
- After deploy: resubmit the sitemap in GSC/Bing; watch impressions/clicks by
  page+query over the next completed 28-day window; compare GSC clicks vs GA4
  organic sessions by landing page.

---

## Process note

This is a significant, multi-layer feature (backend geo + web routes + dynamic
sitemap). Per `claude_help/development-process.md`: **Codex-review this spec →
write a dated plan in `docs/plans/` → Codex-review the plan → implement
task-by-task.** Do not start implementation code before the spec + plan are
Codex-approved.
