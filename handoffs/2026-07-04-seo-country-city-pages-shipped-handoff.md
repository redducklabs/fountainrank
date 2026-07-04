# SEO crawlable pages — Slices 2 & 3 SHIPPED + mobile-doctor parked (2026-07-04)

Self-contained handoff. This session shipped the **country pages (Slice 2)** and **city pages
(Slice 3, the primary SEO payoff)** for the crawlable-SEO effort (#127), and opened a fix for the
unrelated **mobile-doctor** CI red. You can continue from this file alone.

Plan of record: `docs/plans/2026-07-02-crawlable-seo-pages.md`. Spec:
`docs/specs/2026-07-02-crawlable-seo-pages-design.md`. Prior handoff (now superseded for Slices
2/3): `handoffs/2026-07-03-seo-next-tasks-handoff.md`.

---

## TL;DR — what changed this session

| PR | What | State |
|----|------|-------|
| **#164** | Slice 2 — country pages + sitemap index topology | **MERGED** to `main` (`6456a13`) |
| **#165** | Slice 3 — city pages + cities sitemap + country→city links | **MERGED** to `main` (`0e3a7e4`) |
| **#163** | mobile-doctor fix (Expo SDK-56 patch bump) | **OPEN, parked** on the min-release-age window |

`main` HEAD after this session: `0e3a7e4 feat: crawlable city SEO pages + cities sitemap (#127, Slice 3) (#165)`.

**SEO feature status:** Slices 0, 1a–1e-data, 2, 3 = done. **Remaining: Slice 4 (attribute pages),
Slice 5 (fountain-detail metadata), Slice 1e (coverage report/gate).** Nothing is deployed yet —
web deploy is manual and happens *after* the SEO slices land (see "Deploy & verify").

---

## 1. mobile-doctor (PR #163) — READ THIS FIRST, it blocks every PR's checks

**Symptom:** `mobile-doctor` is RED on `main` and therefore on **every** open PR. This is NOT caused
by any SEO work.

**Root cause (a 2-control catch-22, ~24h):**
- `expo-doctor` demands Expo SDK-56 **patch** releases (`expo 56.0.13→56.0.14`, `expo-constants
  56.0.19→56.0.20`, `expo-linking 56.0.14→56.0.15`, `expo-router 56.2.12→56.2.13`,
  `expo-splash-screen 56.0.11→56.0.12`) → red until we bump.
- **CI now enforces a pnpm `minimumReleaseAge` supply-chain gate (~24h)** on the self-hosted
  `redducklabs-runners`. Those patches were published `2026-07-03 08:51Z`, so `pnpm install
  --frozen-lockfile` (in both `workspace-js` and `mobile-doctor`) fails with
  `ERR_PNPM_MINIMUM_RELEASE_AGE_VIOLATION` on all 21 entries — the bump can't be installed until it
  ages 24h. (This corrects the stale 2026-07-02 handoff claim "CI has no min-release-age gate" — the
  gate was added since. The local `pnpm-workspace.yaml` `minimumReleaseAgeExclude` is skip-worktree
  and NEVER reaches CI.)

**PR #163 = the correct bump** (branch `fix/mobile-expo-doctor-sdk56-patches`, only
`mobile/package.json` + `pnpm-lock.yaml`). It just can't pass CI until the patches cross 24h old:
**~2026-07-04 08:53Z** (latest publish `expo-splash-screen@56.0.12` @ `08:52:15Z`).

**Owner decision (this session):** *wait* for the window; do NOT bypass the gate. Documented in
`docs/specs/2026-07-01-web-search-and-mobile-polish-design.md:162` ("self-resolves as the patches
age … merging while red is an explicit owner decision"). **Do NOT** commit `minimumReleaseAgeExclude`
to `pnpm-workspace.yaml` to force a <24h install — that undermines a deliberate security control.

**To finish #163 (after ~2026-07-04 08:53Z):** just re-run its CI (`gh pr checks 163 --watch`, or
push an empty commit / re-run the workflow). Once `mobile-doctor` + `workspace-js` are green,
Codex-review it (it's a lockfile-only change — a quick loop) and squash-merge. No code change needed.
Once #163 is on `main`, `mobile-doctor` goes green for all future PRs.

Memory written: `fountainrank-ci-minimum-release-age-gate`.

---

## 2. Slice 2 — country pages (MERGED, PR #164, `6456a13`)

**Backend — `GET /api/v1/places`** (`backend/app/routers/places.py`, `list_places`):
- No `country` param → **countries**; `?country=<iso2>` → that country's **cities** (children).
- Filters `fountain_count >= seo_place_min_fountains` (K). Reads precomputed columns only — **never a
  live `ST_Covers`** (spec §5). `limit`/`offset` caps + public `Cache-Control` **in the contract**.
- **Countries are NOT filtered on `is_canonical`** (they're keyed by `country_code`, one `class='land'`
  row per code from the loader). Cities ARE filtered on `is_canonical` (it collapses same-
  `(country_code, slug)` city collisions). **This was a Codex `[BLOCKER]`** — my first version filtered
  countries on `is_canonical`, but `app/membership.py` only marks *city-eligible* rows canonical, so
  in prod every country (US/LU) would have returned `[]`/404. Guarded now by
  `test_real_refresh_makes_country_and_city_listable` (runs the real `refresh_all_memberships`).
- New schema `PlaceOut` (`backend/app/schemas.py`): `id, country_code, slug, name, subtype,
  fountain_count`.
- New settings (`backend/app/config.py`): `seo_place_min_fountains: int = 3`,
  `seo_cache_max_age_seconds: int = 3600`.

**Web — `/drinking-fountains/[country]`** (`web/app/drinking-fountains/[country]/page.tsx`):
- SSR: `<h1>`, count, **top-cities links** (`getCountryCitiesServer`). `generateMetadata`:
  title/description + `alternates.canonical`; **404 (`notFound()`) below-gate / unknown country**;
  `robots:{index:false}` for the unknown case. `cache()` dedupes the lookup between metadata & render.
- `web/lib/places.ts`: `getCountriesServer`, `getCountryCitiesServer`, `countryPath`, `cityPath`,
  `PlaceOut`. (Slice 3 added `getCityFountainsServer`, `CityFountainsOut`, `SITEMAP_COUNTRY_CAP`.)

**Sitemap topology fix (plan `[MAJOR]`):** Next `generateSitemaps` does NOT produce an index, so:
- `web/app/sitemap.xml/route.ts` — explicit `<sitemapindex>` referencing the chunks.
- `web/app/sitemaps/core.xml/route.ts` — the former static pages (`/`, `/leaderboard`, `/privacy`,
  `/terms`). `web/app/sitemaps/countries.xml/route.ts` — ready `>=K` countries.
- `web/lib/seo/sitemap.ts` — pure XML builders (`buildUrlset`, `buildSitemapIndex`, `escapeXml`,
  `sitemapResponse`), unit-tested. The old single `web/app/sitemap.ts` was removed. `robots.ts`
  already points at `/sitemap.xml` (now the index).

Style-guide: `docs/style-guide.md` → "SEO place pages" entry.

---

## 3. Slice 3 — city pages (MERGED, PR #165, `0e3a7e4`)

**Backend — `GET /api/v1/places/{country}/{city}/fountains`** (`places.py`, `city_fountains`):
- Resolves the **canonical** city owning `(country_code, slug)` — both matched **lowercased** (slugs
  are stored lowercased) + `is_canonical=true` + `subtype != 'country'`. **404** if none.
- Returns its **non-hidden** fountains **best-rated first**: `ORDER BY ranking_score DESC NULLS LAST,
  rating_count DESC, id`. Reads precomputed `city_place_id` — never a live `ST_Covers`. `limit`
  (default 100, ≤500) / `offset` caps + `Cache-Control`.
- New schema `CityFountainsOut = { place: PlaceOut, fountains: list[FountainPin], indexable: bool }`.
  **`indexable` is the spec §7 thin-content predicate computed server-side** (`fountain_count >= K`)
  — the single source of `K`, so the web sets `noindex` from it without knowing the threshold.
- Reuses `FountainPin` + `latitude_of`/`longitude_of` (`app/geo.py`) exactly like `fountains.py`.

**Web — `/drinking-fountains/[country]/[city]`** (`web/app/drinking-fountains/[country]/[city]/page.tsx`):
- SSR ranked fountain list, each row a `Link` to `/fountains/[id]`. Fountains have **no names**
  (spec §2), so each row is "Drinking fountain" (+ "· Out of order") with a rating (`formatAverage`).
- `generateMetadata`: title/description + canonical (sticky slug); **`noindex` when `!indexable`**;
  `notFound()` for a missing city. **301**: `permanentRedirect` any non-canonical URL casing to the
  canonical lowercase `/[cc]/[slug]`.
- **Country page top cities are now LINKS** (the Slice 2 defer — Codex `[MAJOR]` — unblocked now).

**Sitemap:** `web/app/sitemaps/cities.xml/route.ts` — ready `>=K` cities under ready countries;
added to the index. Fetches countries at `SITEMAP_COUNTRY_CAP` (1000, the API cap) with a `log`
guard if hit — **this was a Codex `[MAJOR]`** (it originally used the helper's 200 default = a silent
cap); the same guard was applied to `countries.xml`.

Style-guide: the "SEO place pages" entry now covers the city page too.

---

## 4. Deliberate scope decisions & DEFERRALS (so you don't "re-fix" them)

- **K default = 3** (`seo_place_min_fountains`, tunable). Countries are unaffected (US/LU are large);
  it mainly gates near-empty city pages. Slice 1e (coverage gate) can raise it per-scope.
- **`indexable` is computed in the backend** (not `K` leaked to web) — spec §7's "one backend response".
- **Below-gate handling differs by design:** country pages **404** below K (the *list* endpoint can't
  return a sub-K country); city pages **render + `noindex`** below K (the by-slug endpoint can, and
  small cities are legitimate). Both are absent from the sitemap + parent links. Codex approved this.
- **"301" = canonical URL-casing normalization only.** True slug-**rename** → 301 is **DEFERRED**: it
  needs a slug-history table the current sticky-slug model doesn't have (and sticky slugs mean no
  rename trigger exists). Note it if you ever add slug renaming.
- **Single `cities.xml` chunk** with per-country-cap + 50k-URL **log guards** (never silent). Splitting
  into multiple chunks via `generateSitemaps` is DEFERRED until the data approaches 50k (US/LU far under).
- **No embedded map** on city pages — the ranked list is the crawlable SEO content; an interactive
  MapLibre map is a client-only enhancement with no SEO value. A map deep-link can come later.
- **"Top fountains" on the country page** was intentionally NOT built (country pages link to cities,
  which link to fountains). No country-level fountains endpoint exists.

---

## 5. How to work in this repo (env gotchas that cost time — do these)

- **Backend tests need the isolated UV env** (the repo's `backend/.venv` is WSL-built and Windows
  `uv` can't use it — `Access is denied` on `.venv/lib64`). Create a Windows-side env once and reuse:
  ```bash
  cd backend
  export UV_PROJECT_ENVIRONMENT='<a Windows path OUTSIDE the repo, e.g. your scratchpad>/fr-backend-venv'
  uv sync --frozen        # once
  uv run pytest -q        # thereafter (PostGIS container fountainrank-db-1 on :5436 must be up)
  uv run ruff check . ; uv run ruff format --check .
  ```
  Memory: `fountainrank-windows-wsl-local-check-workarounds`.
- **Local web full test suite is UNRELIABLE here** — the hoisted `node_modules` **duplicates React**
  (`TypeError: Cannot read properties of null (reading 'useState')`) and eslint hits `EACCES` on
  `web/node_modules/react`. `pnpm run <script>` also triggers a no-TTY modules-purge. **CI's
  `workspace-js` is the authority** for the full web suite + eslint + `next build`. Locally, run the
  **reliable** checks directly, bypassing pnpm:
  ```bash
  # from web/ :  (these ARE reliable locally)
  node ../node_modules/vitest/vitest.mjs run <your new test files>   # your own tests
  node ../node_modules/typescript/bin/tsc --noEmit
  node ../node_modules/prettier/bin/prettier.cjs --check <files>     # or --write
  node ../node_modules/eslint/bin/eslint.js <files>                  # often EACCESes -> rely on CI
  ```
- **Async server-component tests:** use `await screen.findBy*` (not `getBy*`) — React 19 async
  components settle after render (a `getBy*` right after `render()` sees an empty DOM). Mock
  `next/link` (`() => <a href>`), `next/navigation` (`notFound`/`permanentRedirect` throw sentinels),
  `SiteHeader`, and `../lib/server/log`. See `web/app/drinking-fountains/[country]/[city]/page.test.tsx`.
- **api-client regen** (after any backend schema/endpoint change). `pnpm run generate` fails here
  (the backend step uses the broken `.venv`; the types step hits the pnpm purge). Run the two steps
  manually:
  ```bash
  ( cd backend && UV_PROJECT_ENVIRONMENT='<isolated>' uv run python -m app.export_openapi ../packages/api-client/openapi.json )
  node node_modules/openapi-typescript/bin/cli.js packages/api-client/openapi.json -o packages/api-client/src/schema.d.ts
  # commit BOTH packages/api-client/openapi.json + src/schema.d.ts (they're prettier-ignored; .gitattributes normalizes CRLF->LF)
  ```
- **Codex review is the merge gate** (`claude_help/codex-review-process.md`): bypass mode
  (`sandbox:"danger-full-access"`, `approval-policy:"never"`), MCP `cwd = /mnt/d/repos/fountainrank`,
  repo-relative paths in the prompt, loop to `VERDICT: APPROVED`, address every comment. Codex reviews
  posted to the PR appear under the `aronweiler` account.

---

## 6. The per-slice ship gate (what "done" means)

branch off `main` → implement (TDD) → **backend** `uv run pytest`/ruff green + **web** tsc/prettier +
your new vitest green → PR → **CI green on `backend` + `workspace-js`** → **Codex `VERDICT: APPROVED`
+ every comment addressed** → **squash-merge**.

**`mobile-doctor` is red on every PR until #163 lands** — it's the pre-existing Expo drift, unrelated
to any SEO slice. The owner chose to **squash-merge SEO slices past it** (explicit owner override per
the spec). Confirm the *other* checks are all green first (`gh pr checks <N>`), then
`gh pr merge <N> --squash --delete-branch`.

---

## 7. Next tasks (recommended order)

1. **Slice 4 — attribute pages** (plan §Slice 4, spec §4.5). Filter the seeded attribute keys
   `bottle_filler` + `wheelchair_reachable` (`backend/app/filters.py`,
   `backend/migrations/versions/0006_seed_attribute_types.py`). API `GET /api/v1/fountains/by-attribute`
   (global; count ≥ `K_attr`; ranked/paginated/cache/hidden-filter). Web
   `/drinking-fountains/bottle-fillers`, `/wheelchair-accessible-drinking-fountains`, and a **static**
   `/drinking-fountains-near-me`. Sitemap attribute chunk; `noindex` below `K_attr`. Style-guide +
   tests. (Per-city attribute variants are out of scope for v1.)
2. **Slice 5 — fountain-detail metadata** (plan §Slice 5, spec §7). Add `generateMetadata` to
   `web/app/fountains/[id]/page.tsx` (city in title/`<h1>`, canonical), fetching **public** data only
   (not the viewer/admin path); the shared **public indexing predicate** (spec §7: city resolves AND
   not hidden AND (`rating_count>=1` OR (`is_working` AND `current_status` not negative))). `noindex`
   when it fails. Add ready fountains to a **fountains** sitemap chunk. Tests: hidden/visible,
   rated/unrated, verified/stale, and that auth/admin data never affects indexability.
3. **Slice 1e — coverage report/gate** (spec §4.2/§7). Per-scope stats (matched/unmatched, top
   unmatched clusters, city-assignment % by subtype). Lets the owner raise `K` per scope with signoff
   (sets the scope's eligible-city subtypes in `place_scope_config`). Gate for confident city coverage.
4. **#128 GA4** — owner-local (no repo code): add the GA4 property id to the SEO agent registry; run
   `seo_health_check` until GA4 = ok. Key events excluded (spec §8.3).

Also outstanding (unrelated): **#163** (finish after the window), Dependabot **#151** (frontend-js) &
**#138** (backend-python).

---

## 8. Deploy & verify (AFTER the SEO slices land — do NOT deploy mid-slice)

Web deploy is **manual** (`gh workflow run deploy.yml --ref main`, memory
`fountainrank-deploy-is-manual-dispatch`). Membership/boundary loads go through
`osm-boundary-load.yml` (CI-only prod write). After the slices are on `main`:
1. Deploy web.
2. `curl` representative pages → real HTML in the initial response:
   `/drinking-fountains/us`, `/drinking-fountains/us/<a-real-slug>`, an attribute page.
3. Validate the sitemap **index + chunks** fetch as real routes: `/sitemap.xml`, `/sitemaps/core.xml`,
   `/sitemaps/countries.xml`, `/sitemaps/cities.xml` (+ attribute/fountains chunks once Slices 4/5 land).
4. Resubmit the sitemap in **GSC + Bing**; track impressions/clicks by page+query.

---

## 9. Reference — endpoints & routes now live in code (not yet deployed)

- **API:** `GET /api/v1/places` (countries | `?country=<iso2>` cities),
  `GET /api/v1/places/{country}/{city}/fountains`.
- **Web routes:** `/drinking-fountains/[country]`, `/drinking-fountains/[country]/[city]`,
  `/sitemap.xml` (index), `/sitemaps/core.xml`, `/sitemaps/countries.xml`, `/sitemaps/cities.xml`.
- **The hard rule for all public place paths:** read the precomputed membership columns
  (`fountains.city_place_id`/`country_place_id`, `place_boundaries.fountain_count`/`is_canonical`/
  `slug`/`country_code`/`parent_id`) — **never** a live `ST_Covers` (spec §5).
- **Data reality:** prod has US + LU membership populated (`place_boundaries` LU 114 + US 35,016;
  membership for all 49,891 fountains). Countries are `is_canonical=false`; cities' canonical winner
  is `is_canonical=true`.
