# SEO crawlable pages — Slice 5 SHIPPED to `main` (2026-07-04)

Self-contained handoff. This session shipped **Slice 5 (fountain-detail metadata + fountains
sitemap)** for the crawlable-SEO effort (#127) and deployed+verified it live. You can continue from
this file alone.

> ## ▶ START HERE (next conversation): finish PR #163 (mobile-doctor)
> **This is the requested pickup task.** #163 (`fix/mobile-expo-doctor-sdk56-patches`, lockfile-only)
> was blocked all last session by CI's pnpm `minimumReleaseAge` (24h) gate. **That gate lifts at
> `2026-07-04 08:52:15Z`** (precise — see §1), so by the next conversation it should be OPEN. The
> job: re-run #163's CI, confirm `mobile-doctor` + `workspace-js` + `pnpm-audit` all go green, Codex
> review it (lockfile-only → quick), and squash-merge. That turns `mobile-doctor` green for **all**
> future PRs. **Full step-by-step runbook + definition-of-done is in §1.** Do NOT touch Slice 5 —
> it's done + live.

Plan of record: `docs/plans/2026-07-02-crawlable-seo-pages.md` (Slice 5). Spec:
`docs/specs/2026-07-02-crawlable-seo-pages-design.md` (§5 Backend, §6 Sitemap, §7 Metadata &
thin-content policy). Prior handoff (superseded for Slice 5): `handoffs/2026-07-04-seo-slice4-shipped-deployed-handoff.md`.

`main` HEAD: `4420114 feat: fountain-detail SEO metadata + fountains sitemap (#127, Slice 5) (#171)`
(plus the two `docs: handoff` commits on top).

---

## TL;DR — what changed this session

| Item | What | State |
|------|------|-------|
| **PR #171** | Slice 5 — `/fountains/{id}/place` + `/fountains/sitemap` API, detail-page `generateMetadata` + city h1, `fountains.xml` sitemap chunk | **MERGED** to `main` (`4420114`) |
| **Deploy** | `deploy.yml` dispatched from `main` → built+rolled out backend+web | **DEPLOYED + VERIFIED live** (run `28700136508`, success) |
| **#163** | mobile-doctor fix (Expo SDK-56 patch bump) | **OPEN, still parked** on the min-release-age window (opens ~2026-07-04 **08:53Z**) |

**SEO feature status:** Slices 0, 1a–1e-data, 2, 3, 4 = done + LIVE. **Slice 5 = merged AND now LIVE
in prod** (see §3). Remaining: Slice 1e (coverage report/gate), #128 GA4 (owner-local), sitemap
resubmit in GSC+Bing (owner-local — now includes the fountains chunk).

---

## 1. #163 (mobile-doctor) — THE PICKUP TASK, full runbook

**What it is.** PR **#163** (`fix/mobile-expo-doctor-sdk56-patches`, head `32dff96`) is a
**lockfile-only** bump adopting the Expo SDK-56 patch releases that fix `mobile-doctor`. It is NOT
SEO work; it's the standing fix for the `mobile-doctor` red that shows on every PR (including the
SEO slices, which merged past it via the documented owner override).

**Why it's been stuck (confirmed from the CI logs, not a guess).** Its last CI run (from
~2026-07-03 23:47Z) failed THREE checks — `mobile-doctor`, `workspace-js`, `pnpm-audit` — all for
the SAME root cause: CI's pnpm **`minimumReleaseAge` (24h)** gate. `workspace-js`'s "Install
workspace deps" step errored with **`ERR_PNPM_MINIMUM_RELEASE_AGE_VIOLATION`: 21 lockfile entries
failed verification** (the SDK-56 patches were published ~2026-07-03 08:50–08:52Z, inside the 24h
cutoff). `pnpm-audit` installs the same frozen lockfile, so it failed at install for the same reason
(confirm on the fresh run). `backend`, CodeQL, `Analyze (*)`, `pip-audit`, `trivy-fs` were all green.

**When the gate lifts — precise.** The latest-published blocked entry was at **2026-07-03
08:52:15Z**, so all 21 entries cross 24h old at **`2026-07-04 08:52:15Z`**. After that, a fresh CI
run installs cleanly and all three checks should go green. (This session ended ~08:22Z, ~30 min shy.)

### Runbook (do this in order)

1. **Confirm the gate has lifted:** `date -u` — proceed only if now ≥ `2026-07-04 08:52:15Z`.
2. **Verify state + rebase if needed.** `gh pr view 163 --json headRefOid,mergeable,state` and
   `gh pr checks 163`. `main` moved this session (Slice 5 + handoffs). If GitHub shows #163 behind
   `main` / not mergeable, update the branch first:
   `gh pr update-branch 163` (merges `main` in) — a lockfile-only PR shouldn't conflict.
3. **Re-run its CI** (the stale run won't re-trigger itself): `gh pr checks 163 --watch`, or force a
   fresh run — `gh run rerun <failed-run-id>` for the two run ids on the PR, or push an empty commit
   to the branch (`git commit --allow-empty`). Simplest reliable path: check out the branch and
   `gh pr update-branch 163` (step 2) which pushes a new head and triggers CI.
4. **Confirm ALL of these are green:** `mobile-doctor`, `workspace-js`, `pnpm-audit` (plus the
   already-green `backend`/CodeQL/Analyze/pip-audit/trivy-fs). If `pnpm-audit` is STILL red after the
   gate lifts, it's a real advisory — read `gh run view <id> --log-failed`, and if it's a genuine
   CVE, handle per SECURITY.md / `.trivyignore`-style justification (do NOT blanket-ignore).
5. **Codex review loop** (`claude_help/codex-review-process.md`) — lockfile-only, so a quick pass:
   bypass mode (`sandbox:"danger-full-access"`, `approval-policy:"never"`), MCP
   `cwd = /mnt/d/repos/fountainrank`, repo-relative paths, write `temp/codex-reviews/pr-163-review-1.md`,
   loop to `VERDICT: APPROVED`, address every PR comment.
6. **Squash-merge:** `gh pr merge 163 --squash --delete-branch`.

**Definition of done:** #163 merged with `mobile-doctor` + `workspace-js` + `pnpm-audit` green and
Codex `APPROVED`. After merge, **`mobile-doctor` goes green on `main` and all future PRs** — the
"documented override" for SEO slices is no longer needed.

**Hard DON'T:** do NOT commit `minimumReleaseAgeExclude` (or otherwise force a <24h install) to rush
it — that undermines a supply-chain security control. Just wait for the gate. Memory:
`fountainrank-ci-minimum-release-age-gate`. Also verify code before assuming — Expo SDK patches are a
coordinated set (memory `fountainrank-hoisted-linker-masks-expo-doctor-duplicates`); the lockfile in
#163 is the coordinated bump, don't cherry-pick.

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

## 3. Deploy + verification (this session) — Slice 5 is LIVE

**Deploy is manual dispatch** (memory `fountainrank-deploy-is-manual-dispatch`). Ran:
`gh workflow run deploy.yml --ref main` → run `28700136508`, **success** (Build+push 2m41s; Deploy to
DOKS 1m13s; DB-migration step a **no-op** — Slice 5 adds no migration; rollouts completed).

**Verified live (all passing):**
- **API** `https://api.fountainrank.com`:
  - `GET /api/v1/fountains/{id}/place` for a Manhattan fountain → 200: `city` Manhattan
    (`fountain_count` 447), `country` US (24465), `indexable: true`.
  - `GET /api/v1/fountains/sitemap?limit=5` → 200, **`total_count` = 18696** indexable fountains
    (of 24465 US total — the rest have no city or are unrated+not-working), ids ordered.
- **Web** `https://fountainrank.com`:
  - **Indexable** fountain `/fountains/004c1f0c-…` → 200, `<title>Drinking fountain in Manhattan</title>`,
    `<link rel="canonical" …/fountains/004c1f0c-…>`, **no** `robots` meta (correct), and it **is
    listed** in `/sitemaps/fountains.xml`.
  - **Non-indexable** fountain `/fountains/7497d710-…` (no city → `indexable:false`) → 200,
    `<title>Public drinking fountain</title>`, `<meta name="robots" content="noindex, follow">`, and
    it is **absent** from the sitemap. Both §7 branches confirmed on live data.
  - `/sitemap.xml` → 200, references core + countries + cities + attributes + **fountains** chunks.
    `/sitemaps/fountains.xml` → 200, 18696 `/fountains/{id}` URLs.

## 4. Next tasks (recommended order)

1. **Finish #163** (the requested pickup) once now ≥ `2026-07-04 08:52:15Z` — **full runbook in §1.**
   Quick (lockfile-only) and unblocks `mobile-doctor` for all PRs.
2. **Resubmit the sitemap in GSC + Bing** (spec §10) — **owner-local**; now includes the fountains
   chunk. `seo-mcp` tools (`gsc_sitemaps`, `gsc_search_analytics`, `bing_*`) available.
3. **Slice 1e — coverage report/gate** (spec §4.2/§7). Per-scope stats (matched/unmatched, top
   unmatched clusters, city-assignment % by subtype). Lets the owner raise `K`/`K_attr` per scope
   with signoff. Backend-heavy; no new public routes.
4. **#128 GA4** — owner-local: add the GA4 property id to the SEO agent registry; run
   `seo_health_check` until GA4 = ok. Key events excluded (spec §8.3).

Also outstanding (unrelated): Dependabot **#151** (frontend-js) & **#138** (backend-python).

---

## 5. How to work in this repo (env gotchas — carried forward, still true)

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

## 6. The per-slice ship gate (what "done" means)

branch off `main` → implement (TDD) → **backend** `uv run pytest`/ruff green + **web** tsc/prettier +
your new vitest green + **api-client regen** if the contract changed → PR → **CI green on `backend` +
`workspace-js`** → **Codex `VERDICT: APPROVED` + every comment addressed** → **squash-merge**
(`gh pr merge <N> --squash --delete-branch`). `mobile-doctor` red is the pre-existing #163 override
for SEO slices — confirm the OTHER checks are green first. Deploy (manual) after the slice(s) land.
