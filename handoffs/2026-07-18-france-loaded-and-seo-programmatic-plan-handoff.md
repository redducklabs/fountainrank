# Handoff — France unblocked (boundary_area precompute) + owner-approved SEO programmatic plan (2026-07-18)

Pick-up doc for a clean session. Two threads: (1) the worldwide boundary fan-out is **done except
France**, and France's blocker is **fixed, shipped, deployed, and re-dispatched** — the new session
just **verifies it committed**; (2) the owner reviewed an SEO audit and **approved ALL
recommendations** — that's the real body of work below. The owner has said they don't know SEO and
wants us to drive it; execute with judgment.

Supersedes `handoffs/2026-07-17-fanout-fix-shipped-monitoring-handoff.md` (fan-out is now drained).

---

## 1. State at handoff (~2026-07-18 23:40Z — RE-VERIFY, don't trust)

- **Boundary fan-out: 61 of 62 configured countries loaded.** Reconciliation (source of truth):
  ```sql
  SELECT DISTINCT lower(pb.country_code)
  FROM place_boundary_cells c JOIN place_boundaries pb ON pb.id = c.place_id ORDER BY 1;
  ```
  (read-only via `kubectl exec` into a `fountainrank-backend-*` pod using `app.db.get_engine()`;
  this join is heavy under load — use `SET statement_timeout`.) At handoff, `fr` was the only
  configured-active country not committed. The six territories the previous handoff expected to
  fail-closed (`fo gg im je nc xk`) **all loaded** — the pinned Overture release `2026-06-17.0` has
  country features for them, so **registry retirement is moot** (do not open retirement PRs).
- **France re-load is IN FLIGHT** (run `29663997146`, on image `d1a7707f90ab`), in the publish stage
  (`publish_started` 23:33:21Z). It carries the 8h pod deadline; the binding limit is the **6h
  GitHub-hosted runner cap** (pod started ~22:46Z → cap ≈ 04:46Z), and it entered publish with >5h of
  runway, so it has ample headroom to finish. **First action for the new session: confirm the run
  concluded `success` and `fr` now has committed cells** (reconciliation query above; also
  `gh run view 29663997146 --json status,conclusion`). If it somehow failed again, read the teardown
  JSON in the run log and see §2.
- Git: `main` at `d1a7707` (PR #253 merged). Deploy run `29663825631` succeeded; live backend image
  `d1a7707f90ab` (verified). Site healthy (`/readyz`, homepage, `/api/v1/places` all 200).

---

## 2. France blocker — root cause + the fix that shipped (context, mostly closed)

**Why France failed twice.** Its first failure (run `29620154317`) was the old **5h pod
`active_deadline_seconds`** — genuinely fixed by raising it to 8h in **PR #252**. Its second failure
(run `29630881513`, on the 8h pod deadline) was a **different, tighter ceiling: the hard 6-hour job
limit on GitHub-hosted `ubuntu-latest` runners** that *babysit* the loader pod. GitHub cancelled the
job at 5h59m (`##[error]The operation was canceled.`), ~18 min from done; fail-closed teardown reaped
the session and France rolled back. The pod does the real work and would finish on its own; the
runner cap is what kills it. **Durable fact — see memory `fountainrank-boundary-load-6h-runner-cap`.**

**The fix (PR #253, `d1a7707`, merged + deployed).** The recoverable time was a per-load hotspot: the
city-parent region lateral ran `ORDER BY ST_Area(pb.boundary)` (a geodesic area over large region
multipolygons) **once per city** — 37,026 times for France to produce ~13 distinct region areas.
Fix = store `place_boundaries.boundary_area` (`ST_Area(boundary, true)`, populated by the loader on
insert/conflict, migration `0028`, nullable + `SET LOCAL lock_timeout='3s'`, no backfill) and read it
via `COALESCE(pb.boundary_area, ST_Area(pb.boundary))` in the 7 membership order-bys.
Behavior-preserving (same ordering). Spec: `docs/specs/2026-07-18-boundary-area-precompute-design.md`.

**Proven effect (measured on the live re-run):** France city-parenting **1h57m → ~20 min** (~5.7×),
its whole pre-publish phase ~2h26m → ~47 min. Publish (the ~2h `_ASSIGN_CANDIDATE_SQL` fountain-assign
UPDATE) is unchanged — its cost is the `ST_Covers` PIP, not `ST_Area` — but with compute slashed,
France fits under 6h with margin. Memory updated: `fountainrank-city-parenting-slow-fractal-geometry`.

**If France ever needs loading again and is still tight against 6h:** the remaining lever is
decoupling the load from the 6h-capped runner (async pod-dispatch, or self-hosted runner). Both are
**owner decisions** (the self-hosted path reverses the deliberate Class-A/B isolation — see the
runner-cap memory). Do NOT do either silently; the boundary_area fix was chosen precisely to avoid
that. A plain re-dispatch of a >6h country will fail identically.

Re-dispatch command (only if needed):
`gh workflow run osm-boundary-load.yml --ref main -f scope_id=overture:fr -f overture_release_id=2026-06-17.0 -f dry_run=false`

---

## 3. SEO work — OWNER APPROVED ALL RECOMMENDATIONS. This is the main job.

Context: the place-hierarchy pages (`/drinking-fountains/[country]/[place]/[city]`) are the
programmatic-SEO surface, and the worldwide load makes thousands of them cross the thin-content gate
into the index. The templates are already well-built (intent-matched titles/H1, canonicals, sticky
slugs, `noindex` thin-content gate, `BreadcrumbList` schema, 301 casing normalization). The sitemap
system is real (index → `countries`/`regions`/`cities`/`fountains` children, indexable-only). The
work below closes the gaps the load exposes. **Standing rule: `claude_help/seo.md` MUST be read
before any SEO-agent/GSC/GA4/Bing measurement work; SEO measurement uses the `seo` skill + site name
`fountainrank`.**

### 3a. [PRIORITY 1] Fix the cities-sitemap scaling bug — the load breaks discovery (task #52)

`web/app/sitemaps/cities.xml/route.ts` builds ONE urlset. It warns at 45k URLs but the sitemap
protocol **hard limit is 50,000 URLs/file** — over it Google rejects the whole file. Post-fan-out
"ready cities" (France 37,026 alone + Italy ~8k + Germany + …) will exceed 50k → **invalid sitemap →
Google stops discovering exactly the pages we just loaded.** Also `PER_COUNTRY_CAP = 1000` fetches ≤
1000 cities per region, so dense regions (Île-de-France, etc.) get truncated (logged, but the cities
are dropped from the sitemap). Fix:
- Chunk `cities.xml` like the existing `web/app/sitemaps/fountains/[chunk]/route.ts` pattern; update
  the sitemap index (`web/app/sitemap.xml/route.ts`) to list the city chunks.
- Raise/paginate the per-region and per-country caps so no ready city is omitted (verify against the
  `/api/v1/places` limit caps; page if needed).
- Reduce the `force-dynamic` N+1 backend fan-out (per country → per region → per region-cities) or
  add caching — at 62 countries this build is expensive and slow for Googlebot.
- Verify final URL counts after France finishes (`curl` each child sitemap, count `<url>`).
- Highest impact — it gates indexing of the entire load. Web-only change; full CI + Codex gate.

### 3b. [PRIORITY 2] Richer structured data + sideways internal linking

- **`ItemList` structured data on place pages.** City/region/country templates currently emit only
  `BreadcrumbList`. Add an `ItemList` of the listed fountains (and consider `Place` per item) so
  Google reads these as fountain directories. The directory root (`web/app/drinking-fountains/page.tsx`)
  already emits `ItemList` via `jsonLdScript` — extend that pattern down the hierarchy. Files:
  `web/app/drinking-fountains/[country]/page.tsx`, `.../[country]/[place]/page.tsx`,
  `.../[country]/[place]/[city]/page.tsx`; helper `web/lib/seo/jsonld.ts`.
- **Sibling / nearby internal links.** Pages currently link only UP (parent) and DOWN (individual
  fountains) — no lateral links. Add "other cities in {region}" / "nearby cities" (and region
  siblings) so crawl equity and ranking signal flow across the new pages. Biggest cheap win for a
  programmatic set. Needs a backend "sibling/nearby places" affordance if one doesn't exist — check
  `web/lib/places.ts` and the `/api/v1/places` endpoints first.

### 3c. [PRIORITY 3] Positioning copy — APPROVED WORDING (do NOT ship the superlative)

Owner approved the **defensible, numbers-backed** positioning and explicitly went with the
recommendation AGAINST "world's most comprehensive list of fountains." **Do NOT use that literal
claim** — it is disprovable (we import from OpenStreetMap, which has more raw fountain points; Google
Maps has more still) and is weak for ranking (Google ignores/penalizes promotional superlatives).
Approved direction (render counts DYNAMICALLY from live data, ~285k fountains / 62 countries at
handoff):
- Homepage hero: **"The largest community-rated guide to public drinking fountains."**
- Homepage meta description: "Browse 285,000+ public drinking fountains across 62 countries, rated by
  the community for working status and quality. Find water near you and refill for free."
  (Current copy is in `web/app/layout.tsx` — `title` / description consts near the top.)
- Place-page titles: e.g. "Public drinking fountains in {city} — {N} mapped & rated" (adds "public" +
  count; current is "Drinking fountains in {city}"). Keep the deepest titles reasonably short.
Ship as a normal web change once implemented; the wording itself is pre-approved.

### 3d. [OPTIONAL / LATER] Smaller levers

- `force-dynamic` on every place page + sitemap = no caching → heavy backend load and slow pages at
  crawl scale. Consider ISR/caching for indexable pages (careful with the freshness of counts /
  indexable flags).
- OpenGraph images (pages set OG title/description/url but no image) — social sharing, minor SEO.
- hreflang / localized copy — international intent exists ("trinkbrunnen near me"); a future lever for
  ranking place pages in-country, not urgent.

### SEO measurement baseline (for tracking the payoff)

Current stance (GSC, 28 days to ~2026-07-16, via the `seo` skill / `mcp__seo-mcp__gsc_search_analytics`,
site `fountainrank`, providers gsc/ga4/bing all `ok`): **~0 clicks, tiny impressions (1–8/query),
2,599 pages already surfacing**; a handful of high-intent queries already on page 1 ("water fountain
near me" pos ~4.7, "where to get free water near me" pos 2, "public drinking fountains" pos 8). Query
intent is exactly our long-tail ("[city] water fountains", "drinking fountain near me", multilingual).
Track the place-page cohort's impressions→clicks as countries index, to prove the fuse is lit. GA4
property `543842314`; seo-agent operational identity is in `claude_help/seo.md`.

---

## 4. Key files

- SEO: `web/app/drinking-fountains/**` (place templates), `web/app/sitemaps/**/route.ts` +
  `web/app/sitemap.xml/route.ts` (sitemaps), `web/app/robots.ts`, `web/lib/seo/*`, `web/lib/places.ts`,
  `web/app/layout.tsx` (homepage title/desc).
- Boundary load (context): `backend/app/membership.py` (the 7 `COALESCE(boundary_area, …)` order-bys),
  `backend/app/imports/boundary_load.py` (`_UPSERT_SQL` populates `boundary_area`),
  `backend/migrations/versions/0028_boundary_area.py`, `.github/workflows/osm-boundary-load.yml`.

## 5. Process / guardrails (unchanged)

- All work: branch → PR → **CI green + Codex `VERDICT: APPROVED` + every PR comment addressed** →
  **squash-merge**. Codex via the MCP server in bypass mode (`sandbox: danger-full-access`,
  `approval-policy: never`), cwd `/mnt/d/repos/fountainrank`; read `claude_help/codex-review-process.md`.
- Backend verifies locally via isolated `UV_PROJECT_ENVIRONMENT` + `./run.ps1 check -Backend`;
  **web component-render + full JS unit suites are CI-only on this Windows/WSL host** — for the SEO
  web work, rely on CI's `workspace-js` for the render/unit suites; verify `tsc`/ESLint/Prettier/
  `next build` locally (`claude_help/local-dev.md`, `claude_help/testing-ci.md`).
- **No AI attribution** in commits/PRs; **no time estimates** in any doc/PR/commit (owner is strict).
- Deploy is a manual CI dispatch (`gh workflow run deploy.yml --ref main`) — only with **no boundary
  load in flight**; validate `/readyz` + homepage + image SHA. Never hand-mutate the cluster/DB.
- DB inspection is read-only via the backend pod's `get_engine()`; the fan-out DB was recently under
  autovacuum load after France's aborted UPDATE (self-healed) — expect heavy joins over
  `place_boundary_cells` to be slow; always `SET statement_timeout`.

## 6. Open tasks (TaskCreate IDs this session)

- #49 (in_progress) — Load France via boundary_area precompute. **Verify France committed, then close.**
- #52 (pending) — Cities-sitemap chunking fix (SEO priority 1).
- #50 ✅ place-page SEO audit; #51 ✅ positioning copy draft (both delivered above).
- New session should file tasks for 3b (ItemList + internal links) and 3c (positioning copy).

## 7. Reference index

- France fix: spec `docs/specs/2026-07-18-boundary-area-precompute-design.md`; PR #253; deadline PR #252.
- Memories: `fountainrank-boundary-load-6h-runner-cap`, `fountainrank-city-parenting-slow-fractal-geometry`.
- Incident/monitoring history: `handoffs/2026-07-17-fanout-fix-shipped-monitoring-handoff.md`,
  `handoffs/2026-07-15-city-parenting-perf-optimization-handoff.md`.
- SEO ops: `claude_help/seo.md`; product SEO playbook `docs/runbooks/seo.md`.
- Commit THIS handoff with the first SEO PR (matches the established uncommitted-handoff pattern).
