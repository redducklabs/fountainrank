# SEO crawlable pages — Slice 4 SHIPPED + whole SEO feature DEPLOYED to prod (2026-07-04)

Self-contained handoff. This session shipped **Slice 4 (attribute pages)** for the crawlable-SEO
effort (#127), then **deployed the entire SEO feature (Slices 2/3/4) to production and verified it
live**. You can continue from this file alone.

Plan of record: `docs/plans/2026-07-02-crawlable-seo-pages.md`. Spec:
`docs/specs/2026-07-02-crawlable-seo-pages-design.md`. Prior handoff (superseded for Slice 4 + the
deploy): `handoffs/2026-07-04-seo-country-city-pages-shipped-handoff.md`.

`main` HEAD (deployed): `f61d217 feat: crawlable attribute + near-me SEO pages (#127, Slice 4) (#166)`.

---

## TL;DR — what changed this session

| Item | What | State |
|------|------|-------|
| **PR #166** | Slice 4 — attribute-page API + 2 attribute routes + near-me hub + attributes sitemap chunk | **MERGED** to `main` (`f61d217`) |
| **Deploy** | `deploy.yml` dispatched from `main` → built+rolled out backend+web at `f61d217` | **DEPLOYED + VERIFIED live** (run `28698357621`, success) |
| **#163** | mobile-doctor fix (Expo SDK-56 patch bump) | **OPEN, still parked** on the min-release-age window (opens ~2026-07-04 **08:53Z**) |

**SEO feature status:** Slices 0, 1a–1e-data, 2, 3, 4 = done **and now LIVE in prod**. The prior
handoff's "nothing is deployed yet" is **resolved** — the whole crawlable-SEO surface (country/city/
attribute pages + sitemap index & chunks) is deployed. **Remaining: Slice 5 (fountain-detail
metadata), Slice 1e (coverage report/gate), #128 GA4 (owner-local).**

---

## 1. #163 (mobile-doctor) — READ FIRST, it's red on every PR

**Unchanged from the prior handoff.** `mobile-doctor` is RED on `main` (and therefore on every open
PR) due to pre-existing Expo SDK-56 patch drift + CI's pnpm `minimumReleaseAge` (~24h) gate — NOT any
SEO work. PR #163 (`fix/mobile-expo-doctor-sdk56-patches`, lockfile-only) is the correct bump; it
just can't pass CI until the patches cross 24h old: **~2026-07-04 08:53Z**.

**To finish #163 (once now ≥ 08:53Z):** re-run its CI (`gh pr checks 163 --watch`, or push an empty
commit / re-run the workflow). **Watch `pnpm-audit` too** — on #163's last (stale) run it was ALSO
red alongside `mobile-doctor`/`workspace-js`; confirm whether that clears once the min-release-age
gate passes, and if not, investigate before merging. Once `mobile-doctor` + `workspace-js` +
`pnpm-audit` are green, Codex-review it (lockfile-only — a quick loop) and squash-merge. Once #163 is
on `main`, `mobile-doctor` goes green for all future PRs. Do **NOT** commit
`minimumReleaseAgeExclude` to force a <24h install (undermines a security control). Memory:
`fountainrank-ci-minimum-release-age-gate`.

The two prior SEO slices (#164, #165) and this one (#166) were all squash-merged **past** the red
`mobile-doctor` (explicit, documented owner override for SEO slices — the OTHER checks were green +
Codex `APPROVED`). Keep that override in mind; it does not extend to unrelated red checks.

---

## 2. Slice 4 — attribute pages (MERGED, PR #166, `f61d217`)

**Backend — `GET /api/v1/fountains/by-attribute?attribute=<key>`** (`backend/app/routers/fountains.py`,
`fountains_by_attribute`):
- Whitelisted to the two SEO keys **`bottle_filler`, `wheelchair_reachable`** via a `Literal`
  (`SeoAttribute`) + `SEO_ATTRIBUTE_FILTERS` in `backend/app/filters.py`. Unknown/missing/non-SEO
  attribute → **422** (Literal validation; the generated client types the param as the union).
- Non-hidden fountains whose crowdsourced consensus matches, **best-rated first** (`ranking_score`
  desc nulls last, `rating_count` desc, `id`), `limit`≤500 + `offset` + public `Cache-Control`.
  Reuses `attribute_consensus_match` (the same `_attr_match` the map filters use, `include_unknown=
  False` → a `no`/tie(NULL)/absent consensus never matches). Reads the denormalized
  `fountain_attribute_consensus` — **never** recomputes, never a live `ST_Covers`.
- **Declared BEFORE `/fountains/{fountain_id}`** so the literal path isn't parsed as a UUID.
- Response `AttributeFountainsOut = { attribute, fountains, total_count, indexable }`
  (`backend/app/schemas.py`). `total_count` = COUNT over the same match predicate; **`indexable` =
  `total_count >= seo_attribute_min_fountains`** (new setting **`K_attr`, default 3**, in
  `backend/app/config.py`) — computed server-side so the web sets `noindex` without knowing the
  threshold (same contract as Slice 3's `indexable`).
- Regenerated api-client (`packages/api-client/openapi.json` + `src/schema.d.ts`).
- Tests: `backend/tests/test_attribute_pages_api.py` (10) — ranked/shape, both keys, hidden excluded,
  `no`/tie excluded, below-gate & zero-match not-indexable, pagination, unknown/non-SEO 422, limit
  bounds, public/cacheable.

**Web** (all `force-dynamic`, share `web/components/AttributePage.tsx` + `buildAttributeMetadata`):
- `/drinking-fountains/bottle-fillers` (`web/app/drinking-fountains/bottle-fillers/page.tsx`) — a
  **static** segment, so it wins over the `/drinking-fountains/[country]` dynamic sibling (Next orders
  literal children before `[]`). Verified live.
- `/wheelchair-accessible-drinking-fountains` (top-level — the URL is the target search phrase).
- `/drinking-fountains-near-me` (`web/app/drinking-fountains-near-me/page.tsx`) — **static hub,
  always indexable**: solid brand-blue "Open the map near you" CTA deep-linking to `/`, "Popular
  cities" (busiest country's top cities), "Browse by country". Degrades to the CTA when no places.
- Attribute pages always render (200); the backend `indexable` verdict drives `noindex` — below
  `K_attr`, zero matches, or backend-down → `{ index: false, follow: true }` and omitted from the
  sitemap.
- `web/lib/places.ts`: `SeoAttributeKey`, `AttributeFountainsOut`, `getFountainsByAttributeServer`,
  `ATTRIBUTE_PAGES` registry, `NEAR_ME_PATH`.
- Sitemap: `web/app/sitemaps/attributes.xml/route.ts` (indexable attribute pages + near-me), added to
  the index in `web/app/sitemap.xml/route.ts`. Tests in `web/app/sitemap.test.ts`.
- Style-guide: `docs/style-guide.md` → "SEO attribute pages" + "Near-me hub" entries.

CI on #166: `backend` + `workspace-js` (full web suite + eslint + `next build`) + all audits green;
`mobile-doctor` red (pre-existing #163). Codex `VERDICT: APPROVED`, no findings
(`temp/codex-reviews/pr-166-review-1.md`).

---

## 3. Deploy + verification (this session) — the whole SEO feature is LIVE

**Deploy is manual dispatch** (memory `fountainrank-deploy-is-manual-dispatch`): `deploy.yml` fires
only on `v*.*.*` tags or `workflow_dispatch` — routine pushes to `main` do NOT deploy. One dispatch
builds+pushes **both** backend + web images at `main` HEAD and rolls them out together (runs Alembic
migrations before the readiness gate — a **no-op** for Slice 4, which adds no migration).

Ran: `gh workflow run deploy.yml --ref main` → run `28698357621`, **success** (build-push + deploy
jobs green; backend/web/logto/healthz/basemap rollouts all completed).

**Verified live (all passing):**
- **API** `https://api.fountainrank.com`:
  - `GET /api/v1/fountains/by-attribute?attribute=bottle_filler` → 200, ranked real fountains,
    `total_count=2`, `indexable=false`.
  - `…?attribute=wheelchair_reachable` → 200, `total_count=1`, `indexable=false`.
  - `…?attribute=nope` → **422**.
  - `GET /api/v1/places?limit=5` → 200: **US `fountain_count=24465`, LU `167`** (LU name
    `Lëtzebuerg`, slug `letzebuerg`). Top US city slug = **`manhattan`**.
- **Web** `https://fountainrank.com`:
  - `/drinking-fountains/bottle-fillers` → 200, h1 correct, `<meta name="robots" content="noindex,
    follow">` (below gate — correct).
  - `/wheelchair-accessible-drinking-fountains` → 200, noindex (correct).
  - `/drinking-fountains-near-me` → 200, **no robots-noindex** (indexable — correct).
  - `/drinking-fountains/us` → 200; `/drinking-fountains/us/manhattan` → 200.
  - `/sitemap.xml` → references core + countries + cities + **attributes** chunks.
  - `/sitemaps/attributes.xml` → 200, lists **only** `/drinking-fountains-near-me` (both attribute
    pages omitted because they're below the gate → the noindex→sitemap-omission wiring works on live
    data). `core`/`countries`/`cities` chunks all 200.

**⚠️ Operational note — attribute pages are noindex until data accrues.** Prod attribute observations
are sparse (`bottle_filler`=2, `wheelchair_reachable`=1 globally, both < `K_attr`=3), so the two
attribute pages are **noindex + absent from the sitemap** right now. This is the **designed**
thin-content behavior — they will automatically become indexable and enter `attributes.xml` once
their `total_count ≥ 3` (more crowdsourced attribute observations, or lower `K_attr` in
`backend/app/config.py`). Nothing to fix; just know the pages are intentionally not-yet-indexed.

---

## 4. Next tasks (recommended order)

1. **Finish #163** once now ≥ 2026-07-04 08:53Z (see §1) — quick, unblocks `mobile-doctor` for all
   PRs. (Time-gated, not effort-gated.)
2. **Resubmit the sitemap in GSC + Bing** (spec §10) — **owner-local**, now that the sitemap index +
   chunks are live. Then track impressions/clicks by page+query. (The country/city pages are the real
   payoff; attribute pages are noindex until §3's data note resolves.) `seo-mcp` tools
   (`gsc_sitemaps`, `gsc_search_analytics`, `bing_*`) are available if you want to drive it.
3. **Slice 5 — fountain-detail metadata** (plan §Slice 5, spec §7). Add `generateMetadata` to
   `web/app/fountains/[id]/page.tsx` (city in title/`<h1>`, canonical), fetching **public** data only
   (not the viewer/admin path); the shared **public indexing predicate** (spec §7: city resolves AND
   not hidden AND (`rating_count≥1` OR (`is_working` AND `current_status` not negative))). `noindex`
   when it fails. Add ready fountains to a **fountains** sitemap chunk (new
   `web/app/sitemaps/fountains.xml/route.ts` + add to the index). Needs a backend public
   fountain-place/indexability endpoint (spec §5/§7: `GET /api/v1/fountains/{id}/place` + predicate).
   Tests: hidden/visible, rated/unrated, verified/stale, and that auth/admin data never affects
   indexability. **Higher blast radius** — it touches the existing user-facing detail page.
4. **Slice 1e — coverage report/gate** (spec §4.2/§7). Per-scope stats (matched/unmatched, top
   unmatched clusters, city-assignment % by subtype). Lets the owner raise `K`/`K_attr` per scope with
   signoff. Backend-heavy; no new public routes.
5. **#128 GA4** — owner-local: add the GA4 property id to the SEO agent registry; run
   `seo_health_check` until GA4 = ok. Key events excluded (spec §8.3).

Also outstanding (unrelated): Dependabot **#151** (frontend-js) & **#138** (backend-python).

---

## 5. How to work in this repo (env gotchas — carried forward, still true)

- **Backend tests need an isolated Windows UV env** (the repo's `backend/.venv` is WSL-built; Windows
  `uv` can't use it). Create once, reuse:
  ```bash
  cd backend
  export UV_PROJECT_ENVIRONMENT='<a Windows path OUTSIDE the repo, e.g. your scratchpad>/fr-backend-venv'
  uv sync --frozen        # once
  uv run pytest -q        # PostGIS container fountainrank-db-1 on :5436 must be up (docker ps)
  uv run ruff check . ; uv run ruff format --check .
  ```
  Full backend suite this session: **595 passed**. Memory:
  `fountainrank-windows-wsl-local-check-workarounds`.
- **Local web full suite is UNRELIABLE here** (hoisted `node_modules` duplicates React;
  `pnpm run <script>` triggers a no-TTY purge). **CI's `workspace-js` is the authority.** Locally, run
  the reliable checks directly, bypassing pnpm, from `web/`:
  ```bash
  node ../node_modules/vitest/vitest.mjs run <your test files>      # your own tests (reliable)
  node ../node_modules/typescript/bin/tsc --noEmit
  # prettier: the `../node_modules/...` path can MODULE_NOT_FOUND from web/; use the ABSOLUTE path:
  node /<abs>/fountainrank/node_modules/prettier/bin/prettier.cjs --check <files>   # or --write
  # eslint EACCESes on web/node_modules/react locally -> rely on CI's workspace-js
  ```
  Async server-component tests: mock `next/link`, `next/navigation`, `SiteHeader`, `../lib/server/log`;
  use `await screen.findBy*`. Give thin route files a **named** default export (avoid `react/
  display-name` in CI eslint). See the Slice 4 page tests.
- **api-client regen** after any backend schema/endpoint change (two manual steps — `pnpm run generate`
  fails here):
  ```bash
  ( cd backend && UV_PROJECT_ENVIRONMENT='<isolated>' uv run python -m app.export_openapi ../packages/api-client/openapi.json )
  node node_modules/openapi-typescript/bin/cli.js packages/api-client/openapi.json -o packages/api-client/src/schema.d.ts
  # commit BOTH files (prettier-ignored; .gitattributes normalizes CRLF->LF — the CRLF warning is expected)
  ```
- **Codex review is the merge gate** (`claude_help/codex-review-process.md`): bypass mode
  (`sandbox:"danger-full-access"`, `approval-policy:"never"`), MCP `cwd = /mnt/d/repos/fountainrank`,
  repo-relative paths in the prompt, loop to `VERDICT: APPROVED`, address every PR comment. Codex
  can't cleanly run the web vitest in WSL (worker-startup issue) — verify the web tests Windows-side.
- **Deploy** = `gh workflow run deploy.yml --ref main` then `gh run watch <id> --exit-status`; it
  deploys backend+web together. **Verify** with `curl` against `https://api.fountainrank.com` and
  `https://fountainrank.com` (see §3 for the exact checks). Deploy from CI only, never locally.

---

## 6. The per-slice ship gate (what "done" means)

branch off `main` → implement (TDD) → **backend** `uv run pytest`/ruff green + **web** tsc/prettier +
your new vitest green + **api-client regen** if the contract changed → PR → **CI green on `backend` +
`workspace-js`** → **Codex `VERDICT: APPROVED` + every comment addressed** → **squash-merge**
(`gh pr merge <N> --squash --delete-branch`). `mobile-doctor` red is the pre-existing #163 override for
SEO slices — confirm the OTHER checks are green first. Deploy (manual) after the slice(s) land.

---

## 7. Reference — endpoints & routes now LIVE in prod

- **API:** `GET /api/v1/places` (countries | `?country=<iso2>` cities),
  `GET /api/v1/places/{country}/{city}/fountains`,
  `GET /api/v1/fountains/by-attribute?attribute=bottle_filler|wheelchair_reachable`.
- **Web:** `/drinking-fountains/[country]`, `/drinking-fountains/[country]/[city]`,
  `/drinking-fountains/bottle-fillers`, `/wheelchair-accessible-drinking-fountains`,
  `/drinking-fountains-near-me`; `/sitemap.xml` (index) + `/sitemaps/{core,countries,cities,
  attributes}.xml`.
- **Hard rule for all public place paths:** read the precomputed membership columns
  (`fountains.city_place_id`/`country_place_id`, `place_boundaries.fountain_count`/`is_canonical`/
  `slug`/`country_code`/`parent_id`) and the denormalized `fountain_attribute_consensus` — **never** a
  live `ST_Covers` (spec §5).
- **Data reality (prod, verified this session):** countries US `fountain_count=24465`, LU `167` (LU
  name `Lëtzebuerg`, slug `letzebuerg`); top US city `manhattan`. Attribute consensus is sparse
  (`bottle_filler`=2, `wheelchair_reachable`=1) → attribute pages noindex until ≥ `K_attr` (3).
