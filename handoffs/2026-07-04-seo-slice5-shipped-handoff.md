# SEO crawlable pages — Slice 5 SHIPPED to `main` (2026-07-04)

Self-contained handoff. This session shipped **Slice 5 (fountain-detail metadata + fountains
sitemap)** for the crawlable-SEO effort (#127). You can continue from this file alone.

Plan of record: `docs/plans/2026-07-02-crawlable-seo-pages.md` (Slice 5). Spec:
`docs/specs/2026-07-02-crawlable-seo-pages-design.md` (§5 Backend, §6 Sitemap, §7 Metadata &
thin-content policy). Prior handoff (superseded for Slice 5): `handoffs/2026-07-04-seo-slice4-shipped-deployed-handoff.md`.

`main` HEAD: `4420114 feat: fountain-detail SEO metadata + fountains sitemap (#127, Slice 5) (#171)`.

---

## TL;DR — what changed this session

| Item | What | State |
|------|------|-------|
| **PR #171** | Slice 5 — `/fountains/{id}/place` + `/fountains/sitemap` API, detail-page `generateMetadata` + city h1, `fountains.xml` sitemap chunk | **MERGED** to `main` (`4420114`) |
| **Deploy** | NOT dispatched this session | **NOT deployed** — Slice 5 is on `main` but not live yet |
| **#163** | mobile-doctor fix (Expo SDK-56 patch bump) | **OPEN, still parked** on the min-release-age window (opens ~2026-07-04 **08:53Z**) |

**SEO feature status:** Slices 0, 1a–1e-data, 2, 3, 4 = done + LIVE in prod (deployed last session).
**Slice 5 = merged to `main`, NOT yet deployed.** Remaining: **deploy Slice 5**, Slice 1e (coverage
report/gate), #128 GA4 (owner-local), sitemap resubmit in GSC+Bing (owner-local).

---

## 1. #163 (mobile-doctor) — READ FIRST, it's red on every PR

**Unchanged.** `mobile-doctor` is RED on `main` (and every open PR) due to pre-existing Expo SDK-56
patch drift + CI's pnpm `minimumReleaseAge` (~24h) gate — NOT any SEO work. PR #163
(`fix/mobile-expo-doctor-sdk56-patches`, lockfile-only) is the correct bump; it can't pass CI until
the patches cross 24h old: **~2026-07-04 08:53Z**. As of this session's end (~08:00Z) it was still
gated — could not be finished.

**To finish #163 (once now ≥ 08:53Z):** re-run its CI (`gh pr checks 163 --watch`, or push an empty
commit / re-run the workflow). **Watch `pnpm-audit`** — it was red alongside `mobile-doctor`/
`workspace-js` on the last stale run; confirm it clears once the gate passes, else investigate.
Once `mobile-doctor` + `workspace-js` + `pnpm-audit` are green, Codex-review it (lockfile-only) and
squash-merge. Then `mobile-doctor` goes green for all future PRs. Do **NOT** commit
`minimumReleaseAgeExclude` to force a <24h install. Memory: `fountainrank-ci-minimum-release-age-gate`.

Slice 5 (PR #171), like #164/#165/#166 before it, was squash-merged **past** the red `mobile-doctor`
(documented owner override for SEO slices — the OTHER checks were green + Codex `APPROVED`). That
override does NOT extend to unrelated red checks.

---

## 2. Slice 5 — what shipped (MERGED, PR #171, `4420114`)

### The single public indexing predicate (spec §7)
`backend/app/filters.py` → `fountain_indexable_predicate()`: one SQL `WHERE` expression, the single
source of truth reused by BOTH new endpoints so they can't drift. A fountain is indexable **iff**:
- a **city resolves** (`city_place_id IS NOT NULL`) **AND**
- it is **not hidden** **AND**
- (`rating_count >= 1` **OR** (`is_working` **AND** `current_status` NOT IN `('degraded',
  'not_working')`)).

`NEGATIVE_STATUS_VALUES = ('degraded','not_working')`. `reported_issue` is a NON-flipping advisory
(per `app/conditions.py`), deliberately NOT a hard negative; `ok`/`NULL` pass. `current_status IS
NULL` is handled explicitly (SQL `NULL NOT IN (...)` is unknown, not true). Computed **only from
public, non-hidden columns** — auth/admin state can NEVER influence indexability (spec §7). **Note:
the K-gate applies to place/attribute pages, NOT individual fountains** — a fountain in a below-K
city can still be indexable on its own merits (implemented per spec §7).

### Backend endpoints (`backend/app/routers/fountains.py`)
- **`GET /api/v1/fountains/{id}/place`** → `FountainPlaceOut { fountain_id, city, country,
  indexable }` (`city`/`country` are `PlaceOut | None`). 404s hidden/unknown (like the detail
  endpoint). Reads precomputed `city_place_id`/`country_place_id` membership — **never a live
  `ST_Covers`** (spec §5). `indexable` evaluated in the same query that loads the row. Public +
  cacheable.
- **`GET /api/v1/fountains/sitemap`** → `FountainSitemapOut { fountain_ids, total_count }`. Indexable
  ids ordered by `id` (stable pagination), `limit` ≤ 50000, `offset`. `total_count` is the full
  indexable total so the sitemap builder can log truncation. **Declared BEFORE `/fountains/{fountain_id}`**
  so the literal `sitemap` path isn't parsed as a UUID (same trick as `by-attribute`).
- Schemas in `backend/app/schemas.py` (`FountainPlaceOut`, `FountainSitemapOut`). No migration (uses
  existing columns); `alembic check` = no drift. api-client regenerated.
- Tests: `backend/tests/test_fountain_place_api.py` (16) — city/country resolution, the full §7 truth
  table, hidden→404, unknown→404, non-uuid→422, public+cacheable; sitemap listing/exclusions,
  pagination, limit bounds, cacheable. **Full backend suite: 611 passed.**

### Web
- `web/app/fountains/[id]/page.tsx` → `generateMetadata`: **city in the title**
  (`Drinking fountain in {city}` / `Public drinking fountain`), canonical `/fountains/[id]`, and the
  backend `indexable` verdict drives `robots` (below-predicate → `{index:false, follow:true}`;
  hidden/unknown/backend-down → `{index:false, follow:false}`). Fetches the **public** `/place` only
  (never the viewer/admin detail path); `cache()` dedupes it with the page render.
- `web/components/fountain/FountainDetail.tsx` → optional `locationLabel` prop → the `h1` reads
  "Public drinking fountain in {city}" on the public page; generic fallback with no city / on the
  admin path (which doesn't fetch the public place).
- `web/lib/places.ts` → `fountainPath`, `getFountainPlaceServer`, `getIndexableFountainsServer`,
  `SITEMAP_FOUNTAIN_CAP`, `FountainPlaceOut`/`FountainSitemapOut` types.
- `web/app/sitemaps/fountains.xml/route.ts` (NEW, `force-dynamic`) — indexable fountain URLs; a
  noindex fountain is omitted. **On backend failure it logs + returns an uncacheable transient 503**
  (NOT a cacheable empty sitemap — Codex pr-171 [MINOR] fix). Added to the index in
  `web/app/sitemap.xml/route.ts`.
- `docs/style-guide.md` → "Fountain-detail SEO metadata" entry.
- Tests: `web/app/fountains/[id]/page.test.tsx` (+6), `web/app/sitemap.test.ts` (+3).

CI on #171: `backend` + `workspace-js` (web lint/tsc/test + mobile lint/tsc/test + prettier +
`next build`) + all audits + CodeQL green; `mobile-doctor` red (pre-existing #163). Codex
`VERDICT: APPROVED` after one [MINOR] (the 503 fix), re-reviewed to APPROVED
(`temp/codex-reviews/pr-171-review-{1,2}.md`).

---

## 3. Next tasks (recommended order)

1. **Deploy Slice 5** — manual dispatch (`gh workflow run deploy.yml --ref main` then
   `gh run watch <id>`). Builds+rolls out backend+web together; **no migration** so the Alembic step
   is a no-op. Memory: `fountainrank-deploy-is-manual-dispatch`. **Verify live** after:
   - `GET https://api.fountainrank.com/api/v1/fountains/{id}/place` for a known fountain (pick one
     from `GET /api/v1/places/us/manhattan/fountains`) → 200 with `city`/`country`/`indexable`.
   - `GET https://api.fountainrank.com/api/v1/fountains/sitemap` → 200, `fountain_ids` + `total_count`.
   - `https://fountainrank.com/fountains/{id}` → 200; view-source: title includes the city, and
     `<link rel="canonical" href="…/fountains/{id}">`; `<meta name="robots">` present only when
     noindex.
   - `https://fountainrank.com/sitemaps/fountains.xml` → 200 urlset of `/fountains/{id}` URLs;
     `https://fountainrank.com/sitemap.xml` now references the **fountains** chunk.
2. **Finish #163** once now ≥ 2026-07-04 08:53Z (see §1) — quick, unblocks `mobile-doctor` for all PRs.
3. **Resubmit the sitemap in GSC + Bing** (spec §10) — **owner-local**; now includes the fountains
   chunk. `seo-mcp` tools (`gsc_sitemaps`, `gsc_search_analytics`, `bing_*`) available.
4. **Slice 1e — coverage report/gate** (spec §4.2/§7). Per-scope stats (matched/unmatched, top
   unmatched clusters, city-assignment % by subtype). Lets the owner raise `K`/`K_attr` per scope
   with signoff. Backend-heavy; no new public routes.
5. **#128 GA4** — owner-local: add the GA4 property id to the SEO agent registry; run
   `seo_health_check` until GA4 = ok. Key events excluded (spec §8.3).

Also outstanding (unrelated): Dependabot **#151** (frontend-js) & **#138** (backend-python).

---

## 4. How to work in this repo (env gotchas — carried forward, still true)

- **Backend tests need an isolated Windows UV env** (repo's `backend/.venv` is WSL-built). Create
  once, reuse:
  ```bash
  cd backend
  export UV_PROJECT_ENVIRONMENT='<a Windows path OUTSIDE the repo, e.g. your scratchpad>/fr-backend-venv'
  uv sync --frozen        # once
  uv run pytest -q        # PostGIS container fountainrank-db-1 on :5436 must be up (docker ps)
  uv run ruff check . ; uv run ruff format --check .
  ```
  E501 hits docstrings/comments — `ruff format` won't wrap those; shorten by hand. Full backend
  suite this session: **611 passed**. Memory: `fountainrank-windows-wsl-local-check-workarounds`.
- **Local web full suite is UNRELIABLE here** (hoisted `node_modules` duplicates React; `pnpm run
  <script>` triggers a no-TTY purge). **CI's `workspace-js` is the authority.** Locally, run the
  reliable checks directly from `web/`:
  ```bash
  node ../node_modules/vitest/vitest.mjs run <your test files>      # your own tests (reliable)
  node ../node_modules/typescript/bin/tsc --noEmit
  # prettier lives in the pnpm store; find it, then run with the ABSOLUTE .cjs path:
  #   node "$PWD/node_modules/.pnpm/prettier@<ver>/node_modules/prettier/bin/prettier.cjs" --check <files>
  # eslint EACCESes on web/node_modules/react locally -> rely on CI's workspace-js
  ```
  Async server-component tests: mock `next/link`, `next/navigation`, `lib/places` (spread actual,
  override the server fetch), `SiteHeader`, `../lib/server/log`; import `generateMetadata` alongside
  the default export; use `await screen.findBy*`. See the Slice 5 page tests.
- **api-client regen** after any backend schema/endpoint change (two manual steps — `pnpm run
  generate` fails here):
  ```bash
  ( cd backend && UV_PROJECT_ENVIRONMENT='<isolated>' uv run python -m app.export_openapi ../packages/api-client/openapi.json )
  node node_modules/openapi-typescript/bin/cli.js packages/api-client/openapi.json -o packages/api-client/src/schema.d.ts
  # commit BOTH files (prettier-ignored; .gitattributes normalizes CRLF->LF — the CRLF warning is expected)
  ```
- **Codex review is the merge gate** (`claude_help/codex-review-process.md`): bypass mode
  (`sandbox:"danger-full-access"`, `approval-policy:"never"`), MCP `cwd = /mnt/d/repos/fountainrank`,
  repo-relative paths in the prompt, loop to `VERDICT: APPROVED`, address every PR comment. Codex
  posts as `aronweiler` (its gh account) and can't `gh pr review --approve` its own account's PR — a
  `VERDICT:` comment counts.
- **Deploy** = `gh workflow run deploy.yml --ref main` then `gh run watch <id>`; deploys backend+web
  together. Deploy from CI only, never locally.

---

## 5. The per-slice ship gate (what "done" means)

branch off `main` → implement (TDD) → **backend** `uv run pytest`/ruff green + **web** tsc/prettier +
your new vitest green + **api-client regen** if the contract changed → PR → **CI green on `backend` +
`workspace-js`** → **Codex `VERDICT: APPROVED` + every comment addressed** → **squash-merge**
(`gh pr merge <N> --squash --delete-branch`). `mobile-doctor` red is the pre-existing #163 override
for SEO slices — confirm the OTHER checks are green first. Deploy (manual) after the slice(s) land.
