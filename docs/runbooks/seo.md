# Runbook — SEO (crawlable pages, sitemaps, coverage, measurement)

Everything FountainRank does to be discovered by search engines, and the actions the **owner**
personally takes to maximize exposure. Two halves: **Part A** is how the system works (reference);
**Part B** is your playbook (the human-only actions). Nothing here is automatic-vs-manual by
accident — if it's in Part B, no code does it for you.

- **Design specs:** `docs/specs/2026-07-02-crawlable-seo-pages-design.md` (the feature, #127) and
  `docs/specs/2026-07-04-seo-coverage-gate-design.md` (coverage report + readiness gate, Slice 1e).
- **Plan:** `docs/plans/2026-07-02-crawlable-seo-pages.md`.
- **Related runbook:** `docs/runbooks/osm-fountain-import.md` (how fountains get into the DB in the
  first place — SEO ranks what that imports).
- **No secrets in this doc.** Reference env var names only; never paste GA4 property ids, GSC/Bing
  verification tokens, or credentials.

---

## Part A — How SEO works here

### A.0 The core problem it solves
Fountains have **no names** ("fountain #4821" is not a search term). So FountainRank creates
**place context** search engines can rank: pages for *drinking fountains in `<city>`* and
*`<country>`*, built by point-in-polygon assigning every fountain to the administrative area that
contains it. That assignment is precomputed (never a live query on a page load).

### A.1 Data pipeline (what makes a page exist)
1. **Fountains** land via the OSM import (`docs/runbooks/osm-fountain-import.md`).
2. **Boundaries** are loaded from **Overture Maps Divisions** (`division_area`, release-pinned) into
   `place_boundaries` via the **`osm-boundary-load.yml`** workflow. Countries (`subtype='country'`)
   and cities (per-country city subtype — `locality`/`localadmin`, `+county` where a scope opts in).
3. **Membership** (`backend/app/membership.py`) precomputes, per fountain, its containing **country**
   and most-specific eligible **city**, plus the denormalized `fountain_count`, the `is_canonical`
   winner per `(country_code, slug)`, and `parent_id`. Refreshed on every boundary load, OSM import,
   and user add.
4. **Coverage report + readiness gate** (`backend/app/seo_coverage.py`, Slice 1e) reports how well a
   scope is covered and gates whether its **city** routes are indexed (see A.5).

### A.2 Page types (all server-rendered, indexable routes)
| Route | Content | Indexable? |
|---|---|---|
| `/drinking-fountains/[country]` | count + top cities + top fountains | Yes (any loaded country) |
| `/drinking-fountains/[country]/[city]` | list/map, top-rated first | **Yes — the primary SEO payoff**, gated (A.5) |
| `/drinking-fountains/bottle-fillers`, `/wheelchair-accessible-drinking-fountains` | attribute-filtered list | Yes; `noindex` below `K_attr` |
| `/drinking-fountains-near-me` | static explainer + map deep-link + top cities | Yes |
| `/fountains/[id]` | detail, city in `<h1>`/title | **Selective** — §7 predicate; else `noindex` |

Titles/descriptions/`canonical` are unique per page (`generateMetadata`). Slugs are **sticky**; a
renamed boundary keeps the old URL as a 301 to the canonical slug.

### A.3 robots + sitemaps
- **`/robots.txt`** (`web/app/robots.ts`) — allows crawling, disallows `/account` + `/admin`, points
  at `/sitemap.xml`.
- **`/sitemap.xml`** (`web/app/sitemap.xml/route.ts`) — an explicit **sitemap index** (Next's
  `generateSitemaps` does not produce one) referencing five chunks under `/sitemaps/`:
  - `core.xml` — static pages (home, leaderboard, legal)
  - `countries.xml` — loaded countries ≥ `K`
  - `cities.xml` — canonical cities ≥ `K` **in ready scopes only** (A.5)
  - `attributes.xml` — attribute pages ≥ `K_attr`
  - `fountains.xml` — selectively-indexable fountain detail pages
- Chunks are `force-dynamic` so they reflect live data; each stays < 50k URLs (warns before the cap).

### A.4 Indexability rules (the thin-content policy, spec §7)
One predicate, computed from **public, non-hidden** data only (auth/admin data never affects SEO):
- **Places** (country/city) indexable iff `fountain_count ≥ K` (`seo_place_min_fountains`, default 3).
- **Attribute pages** indexable iff matching count `≥ K_attr` (`seo_attribute_min_fountains`).
- **A fountain** indexable iff a city resolves **AND** not hidden **AND** (`rating_count ≥ 1` **OR**
  (`is_working` **AND** `current_status` not negative)).
- Everything below its gate renders but is `noindex` — reachable, just not promoted.

### A.5 The per-scope readiness gate (Slice 1e)
Beyond the per-city `K` gate, each **scope** (country) carries a `city_routes_ready` flag on
`place_scope_config`. A scope's **city** routes (the cities sitemap chunk + each city page's
indexability) are live **only when that scope is ready**. Country routes are never gated. This stops
a poorly-covered new country from exposing thin/misleading city pages before its coverage is good.

- **Check coverage:** run **`seo-coverage-report.yml`** (manual dispatch, no inputs, read-only) — it
  prints a per-scope JSON report (boundary counts, matched/unmatched fountains, `city_coverage_pct`,
  city-assignment split by subtype, where coverage is missing, invalid-geometry health, and a
  ready/not-ready *recommendation*). It reads **one consistent snapshot** (it serializes with
  boundary loads and takes the membership lock), so it never reports a half-loaded state, and it
  **never writes** — safe to run anytime.
- **Sign off:** if coverage is good, open a PR that sets `city_routes_ready = true` (and the eligible
  city subtypes) for that scope on `place_scope_config` — a reviewed data migration. `us` and `lu`
  are already signed off.

### A.6 Measurement (GA4)
GA4 is already installed (`web/lib/analytics.ts`, consent-gated, path-only per
`docs/specs/2026-06-30-ga4-web-analytics-design.md`). It measures traffic; it does not affect
indexability. The remaining GA4 setup is owner-local (Part B).

---

## Part B — Owner playbook (your personal actions)

These are **not** done by any workflow. Do them to get and keep exposure. None expose secrets in the
repo — verification tokens / property ids live in the relevant console or your local SEO-agent
registry, never committed.

### B.1 Submit the sitemap to Google Search Console + Bing — the single biggest lever (#125)
The sitemap is **live** (`https://fountainrank.com/sitemap.xml`). Search engines still need to be
told and the domain verified.
1. **Google Search Console** (search.google.com/search-console): add the `fountainrank.com` property
   (Domain property → DNS TXT verification, or URL-prefix). Then **Sitemaps → add
   `https://fountainrank.com/sitemap.xml`**. Confirm it reads the index + all five chunks.
2. **Bing Webmaster Tools** (bing.com/webmasters): add the site (you can **import from GSC** to skip
   re-verification), then submit the same sitemap URL.
3. After a crawl cycle, check **Coverage/Pages** for indexed counts and fix anything reported as
   excluded that shouldn't be.

### B.2 Finish GA4 wiring (#128)
Add the GA4 **property id** to your local SEO-agent registry (not committed), then run
`seo_health_check` until GA4 shows `ok`, and confirm **GA4 Realtime** registers a hit on the apex.
This unlocks organic landing-page/query reporting for the SEO pages.

### B.3 Sign off new country scopes as you expand coverage (ongoing, Slice 1e)
Every new country you want city pages for:
1. Add its row to `.github/boundary-source-regions.yml` (PR) and run **`osm-boundary-load.yml`**
   (dry-run first, then `dry_run=false`) — see the OSM import runbook.
2. Run **`seo-coverage-report.yml`** and read the JSON. Good coverage = most fountains get a city and
   the assignment lands on real municipal tiers.
3. Open the signoff PR (`city_routes_ready = true` + eligible subtypes on `place_scope_config`). Its
   city routes then enter the sitemap + become indexable.

Loading **more countries at all** is itself an exposure lever — every ready scope adds indexable
city pages.

### B.4 Set the app-store URLs when listings exist (#135)
Set `NEXT_PUBLIC_APP_STORE_URL` / `NEXT_PUBLIC_GOOGLE_PLAY_URL` on the web deploy once the store
listings are public, so app links resolve (helps cross-linking + brand SERP presence).

### B.5 Ongoing monitoring
- **GSC:** track impressions/clicks by **page + query** over completed 28-day windows; watch which
  city/country/attribute pages gain traction and which stay flat (candidates for more fountains or
  better copy).
- **Bing Webmaster:** same, plus its crawl/indexing diagnostics.
- **GA4:** organic landing pages + sources for the SEO routes.
- Re-submit / re-ping the sitemap after a big content change (a large boundary load or many new
  fountains) isn't required (chunks are dynamic), but a manual GSC "validate/inspect" on a new
  scope's top city page confirms it's indexable.

---

## Quick verification (anytime)
```bash
curl -sI https://fountainrank.com/robots.txt        | head -1     # 200
curl -s  https://fountainrank.com/robots.txt                      # points at /sitemap.xml
curl -s  https://fountainrank.com/sitemap.xml                     # index: 5 <sitemap> chunks
curl -s  https://fountainrank.com/sitemaps/cities.xml | head -20  # city URLs for ready scopes
curl -sI https://fountainrank.com/drinking-fountains/us | head -1 # 200 (a country page)
```
For indexability, fetch a page and check its `<meta name="robots">` — indexable pages omit it;
gated pages emit `noindex`.
