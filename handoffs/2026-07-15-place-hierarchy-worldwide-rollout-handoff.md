# Handoff — Place hierarchy + worldwide boundary rollout (2026-07-15)

Pick-up doc for a fresh conversation. The feature is **built, merged, deployed, and verified**; the
only work left is the **long-running boundary fan-out** (loading the remaining ~54 countries) and a
small tail of cleanups. Everything needed to resume is below.

---

## 1. What this was

The user asked for: a top-level `/drinking-fountains` hub with **country → state/province → city**
drill-down, indexable for search engines, covering **all** imported fountains (US, Europe, and many
more). It started from the question "what would the city URL for Hamburg be?" — which exposed that
the site had no state tier, no hub, and a canonical-URL scheme that could only represent **one** city
per duplicate name.

## 2. Status at a glance

- **Feature: LIVE.** `/drinking-fountains` hub, country/state/city pages, nested city URLs, 308
  redirects from the old flat URLs, chunked sitemaps — all deployed to production.
- **Original question answered:** `https://fountainrank.com/drinking-fountains/de/hamburg` returns
  200. Hamburg is a city-state → it renders as the **state page**, its fountains under district city
  pages (`/de/hamburg/altona`, `/de/hamburg/hamburg-nord`, …). This behavior was **confirmed desired**
  by the user (keep state page + district cities).
- **Indexed countries so far (8):** `ad al at au de lu mc us` — **~53,500 fountains**.
- **Fan-out IN PROGRESS:** ~54 countries remain to load (~15 min each ≈ ~14 h of serial CI). A driver
  is running (see §6); it is **resumable**, so a fresh conversation just relaunches it.

## 3. Merged PRs (all Codex-reviewed + CI-green + squash-merged)

| PR | What |
|---|---|
| **#226** | The feature: hub, state tier, nested city URLs + 308s, canonical uniqueness fix `(country_code, parent_id, slug)`, migration `0025` (schema + data backfill + fail-closed cell preflight), `/readyz` alembic schema-gate deploy fix, chunked sitemaps, 62-country boundary registry. |
| **#227** | Backend `progressDeadlineSeconds: 1800` — the schema-gate holds the pod NotReady through a long migration; the default 600s deadline tripped. |
| **#228** | Materialize `ST_PointOnSurface` once per city in `_CITY_PARENT_SQL` — a boundary load had stalled 35+ min on this. |
| **#229** | CI fix: npm retired the audit endpoint pnpm 10 used (repo-wide 410); bumped audit gate to pnpm 11 (Codex verified it still catches high/critical). |
| **#233** | `refresh_country_memberships()` — **scoped per-country refresh** so a boundary load reprocesses only its own country (~40 min → ~a few min). 5-round Codex spec review. |
| **#234** | Migration `0026` — `city_routes_ready=true` for all 62 countries; micro-states seeded `eligible_region_subtypes='{}'` (2-level). |
| **#235** | Backend memory limit 512Mi → **1.5Gi** — boundary loads OOMKilled the serving pod at 512Mi. |

## 4. Key files / where things live

- **Design/plan:** `docs/specs/2026-07-14-place-hierarchy-drilldown-design.md`,
  `docs/plans/2026-07-14-place-hierarchy-drilldown.md`,
  `docs/specs/2026-07-14-scoped-membership-refresh-design.md`.
- **Backend membership:** `backend/app/membership.py` —
  `refresh_all_memberships()` (full) and `refresh_country_memberships(session, cc)` (scoped, used by
  boundary loads). `backend/app/imports/boundary_cli.py` calls the scoped path (`--all` forces full).
- **Migrations:** `0025_place_hierarchy.py` (schema + frozen `sql/0025_backfill.sql`),
  `0026_index_all_countries.py` (indexing gate). Head = `0026`.
- **Places API:** `backend/app/routers/places.py` (regions/cities/resolve endpoints; the level-2
  `/resolve/{slug}` decision lives here). `FountainPlaceOut` carries the parent region.
- **Web:** `web/app/drinking-fountains/` (`page.tsx` hub; `[country]/`; `[country]/[place]/` = the
  308 resolver route; `[country]/[place]/[city]/`). Sitemaps in `web/app/sitemaps/` (+ `regions.xml`,
  `fountains/[chunk]/`). `web/app/fountains/[id]/page.tsx` + `drinking-fountains-near-me/` emit nested
  city URLs.
- **Registry:** `.github/boundary-source-regions.yml` (62 `overture:<cc>` scopes, pinned release
  `2026-06-17.0`). `.github/osm-import-regions.yml` = the fountain-import scopes it derives from.

## 5. Correctness facts verified in production

- **Defect-3 fixed:** 12 canonical Portlands across US states (old flat model allowed exactly one).
- **§3.2 slug collisions** (`/us/washington`→DC, `/us/delaware`→OH, `/us/wyoming`→MI) resolve to the
  **state** page; the city is reachable at its nested URL. `new-york` is NOT a collision (Overture
  splits NYC into boroughs).
- **Scoped refresh proven:** loading Monaco left US/DE/LU canonical counts byte-for-byte unchanged.

## 6. RESUME THE FAN-OUT (the main remaining work)

A driver is loading the remaining countries serially. **To check / resume in a fresh conversation:**

1. **See what's already indexed** (source of truth):
   `curl -s "https://api.fountainrank.com/api/v1/places?limit=200" | python -c "import json,sys; print(sorted(p['country_code'] for p in json.load(sys.stdin)))"`
2. **Remaining to load** (54 as of this handoff), verified-first then the 6 uncertain codes last:
   `ba be bg bn by bz ch cl cy cz dk ee es fi fr gb ge gr hr hu ie is it ke kr li lt lv md me mk mt mu my nl no pl pt ro rs se sg si sk tr ua uy za` **then** `fo gg im je nc xk`.
3. **Dispatch one country** (the whole mechanism is just this, per country):
   `gh workflow run osm-boundary-load.yml --ref main -f scope_id=overture:<cc> -f overture_release_id=2026-06-17.0 -f dry_run=false`
   then poll `gh run view <id> --json status,conclusion`. Each load auto-indexes the country (the
   `city_routes_ready` gate is already true for all 62 from `0026`).

### 🚨 Fan-out operational rules (learned the hard way this session)

- **Drive it serially, one country at a time; wait for each to finish before the next.** The workflow
  serializes via `concurrency: boundary-load-production`.
- **NEVER cancel a run the driver is waiting on** — it makes the loop see "completed" and rapid-fire
  dispatch the whole list (a runaway that piles up queued/cancelled runs).
- **Detached background loops survive TaskStop on this Windows host.** If you drive it from a
  background Bash/Monitor, include a **sentinel stop-file** check (`[ -f fanout.stop ] && break`) and
  stop it with `touch <scratchpad>/fanout.stop`. To hard-kill: find PIDs via
  `Get-CimInstance Win32_Process | Where CommandLine -match 'fanout'` and `Stop-Process` — but NEVER
  kill the harness's own `-c "source .../shell-snapshots"` shells.
- Prefer **foreground** Bash for a handful of loads (killed cleanly on the 600s timeout; cannot
  detach). A resumable foreground loop, re-invoked, is the safest driver.
- The reusable driver script (sentinel + API-resume + no self-cancel) is at
  `<scratchpad>/fanout.sh` and the country list at `<scratchpad>/fanout_countries.txt` — but the
  scratchpad is session-specific, so in a fresh conversation just re-create them from step 2's list.

### The 6 uncertain country codes (spec §9)

`xk` (Kosovo), `fo` (Faroe), `gg` (Guernsey), `je` (Jersey), `im` (Isle of Man), `nc` (New Caledonia)
may not exist as a `country` division in Overture. A load that fetches **0 features fails closed**.
If one fails on zero features, **retire its row** in `.github/boundary-source-regions.yml`
(`status: retired`) rather than leave a country that can never resolve — a one-line PR.

## 7. Per-country tuning that may be needed after loading

- **Region tier is best-effort.** `0026` seeded `eligible_region_subtypes='{}'` (2-level) only for
  `mc mt sg li ad gg je im fo` + `lu`. If a loaded country turns out to have **no** `region`-subtype
  boundaries in Overture, its cities get a NULL region parent and **no** city URLs — fix with a
  reviewed migration setting that country's `eligible_region_subtypes='{}'` **and re-running its
  boundary load** (the config is read during the load's membership refresh). The SEO coverage report
  (`backend/app/seo_coverage.py`) surfaces such a country (cities with NULL parents).
- **City-tier eligibility** default is `{locality, localadmin}`. A country whose municipal tier is
  coarser (like LU's `county` communes) needs its `eligible_city_subtypes` tuned similarly.

## 8. Known follow-ups (not blocking)

- **Loader runs inside the serving pod.** `osm-boundary-load` execs the loader + PostGIS refresh in
  the backend pod; the cleaner long-term design is a **Job-isolated loader** (Codex noted this on
  #235). The 1.5Gi limit is the current mitigation — watch node memory during big-country loads.
- **Deploy timing vs. fan-out:** a `deploy.yml` run rolls the backend pod and would kill an in-flight
  boundary load's exec. Don't deploy while a load is running (or expect that load to fail and retry).
- Merging to `main` does **not** deploy — deploy is `gh workflow run deploy.yml --ref main`.

## 9. Process reminders for this repo

- Branch → PR → **CI green + Codex `VERDICT: APPROVED` + every PR comment addressed** → squash-merge.
  Codex is the gating reviewer (`claude_help/codex-review-process.md`), run in bypass mode with cwd
  `/mnt/d/repos/fountainrank`.
- Backend verifies locally via an isolated `UV_PROJECT_ENVIRONMENT` (`claude_help/local-dev.md`); web
  render/unit suites and mobile lint are **CI-only** on this Windows/WSL host — don't claim a local
  green you didn't get. pnpm store wedges: WSL deletes `node_modules`, Windows reinstalls.
- No AI attribution in commits/PRs; no time estimates.
