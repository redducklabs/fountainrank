# SEO crawlable pages (#127) — NEXT TASKS handoff (2026-07-03)

Forward-looking handoff to start a fresh session. The **data layer is done and populated in prod**;
what remains is the coverage gate + the public routes that consume it (Slices 1e → 5) plus one
unrelated CI blocker. Plan of record: `docs/plans/2026-07-02-crawlable-seo-pages.md`; spec:
`docs/specs/2026-07-02-crawlable-seo-pages-design.md`.

---

## Where we are (verified 2026-07-03)

- **Slices 0, 1a, 1b, 1c, 1d = DONE.** `place_boundaries` loaded in prod (LU 114 + US 35,016);
  `place_boundary_cells` (250,534) built; **membership populated for all 49,891 fountains**
  (24,630 country / 18,694 city). Fast cells-based PIP shipped this session — see
  `2026-07-03-membership-backfill-perf-fix-shipped-handoff.md`.
- Precomputed and ready to read: `fountains.country_place_id`/`city_place_id`,
  `place_boundaries.fountain_count`/`is_canonical`/`parent_id`, `place_scope_config` (us/lu eligible
  subtypes). **The public path must NEVER run a live `ST_Covers`** — read these columns (spec §5).
- **NOT built yet:** Slice 1e (coverage gate), Slice 2 (country pages), Slice 3 (city pages — the
  primary SEO payoff), Slice 4 (attribute pages), Slice 5 (fountain-detail metadata).
- `web/app/sitemap.ts` + `web/app/sitemap.test.ts` already exist (from robots/sitemap work, issue
  #125) — Slice 2/3 ADD place chunks to it; check its current shape before extending. Note the plan's
  **sitemap-topology fix**: serve an explicit sitemap **index** at `/sitemap.xml` referencing chunk
  files (Next `generateSitemaps` produces `/sitemap/[id].xml`, not an index).
- Open issues: **#127** (the umbrella — Slices 2-5), **#125** (robots+sitemap, partially scaffolded),
  **#128** (GA4, owner-local). Non-SEO/out-of-scope here: #44 (restroom ratings), #19 (place search).

## The next tasks (recommended order)

**⚠️ FIRST: confirm the starting point with the owner.** Reasonable options: (a) go straight to
**Slice 2 (country pages)** since US+LU membership is populated and good enough to ship country
pages; (b) do **Slice 1e (coverage gate)** first if we want the ready/≥K threshold + owner-signoff
machinery in place before exposing any route; (c) knock out the **mobile-doctor blocker** first so CI
is fully green. Recommendation: fix mobile-doctor (tiny, unblocks all PRs), then Slice 2, then
Slice 3 (the real payoff), treating 1e's ≥K/coverage checks as part of each route's indexability
controls rather than a separate up-front slice — but the owner decides.

1. **mobile-doctor red on `main` (unrelated, blocks every PR's checks).** Expo SDK 56 patch drift:
   `expo 56.0.13`→`~56.0.14`, plus `expo-constants`/`expo-linking`/`expo-router`/`expo-splash-screen`.
   Fix in its OWN small PR: `expo install --fix` (or `--check`) in `mobile/` — Expo SDK patches are a
   **coordinated set** (see memory `[[fountainrank-hoisted-linker-masks-expo-doctor-duplicates]]`),
   don't cherry-pick. CI's `mobile-doctor` + `workspace-js` validate it (local mobile checks are
   unreliable on this host). Not caused by any backend work.

2. **Slice 1e — coverage report/gate** (spec §4.2/§7). Per-scope stats: boundary count,
   matched/unmatched fountains, top unmatched clusters, invalid-ring skips, **city-assignment % by
   subtype**. A scope's city routes are "ready" only above a threshold OR with explicit owner signoff
   (which also sets the scope's eligible-city subtype set in `place_scope_config`). Gate for Slice 3.

3. **Slice 2 — country pages** (vertical: API + route + sitemap + noindex + tests).
   - API `GET /api/v1/places` (countries, `fountain_count ≥ K`; pagination cap + cache headers +
     hidden-row filter in the contract).
   - Web `/drinking-fountains/[country]` (ISO-2 segment): SSR content, `generateMetadata`
     (title/description/canonical), links to top cities + top fountains. **Add a `docs/style-guide.md`
     entry** (mandatory before any new UI element).
   - Sitemap: country chunk, only ready/≥K countries, `noindex` others; tests fetch the real route.

4. **Slice 3 — city pages (PRIMARY SEO PAYOFF).**
   - API `GET /api/v1/places/{country}/{city}/fountains` (hierarchical identity §4.3; ranked,
     paginated, caps + cache + hidden filter).
   - Web `/drinking-fountains/[country]/[city]`: SSR list/map, `generateMetadata`, canonical from the
     **sticky slug**; **301 for renamed slugs**. Style-guide entry.
   - Sitemap: city chunk(s) (< 50k each) for ready scopes; `noindex` below K / below the coverage gate.

5. **Slice 4 — attribute pages** (`bottle-fillers`, `wheelchair-accessible`, static
   `drinking-fountains-near-me`), and **Slice 5 — fountain-detail metadata** (`generateMetadata` on
   `web/app/fountains/[id]/page.tsx`, public indexing predicate, `noindex` when it fails). See plan.

6. **#128 GA4** — owner-local (no repo code): add GA4 property id to the SEO agent registry, confirm
   `seo_health_check` GA4 ok. Key events excluded (spec §8.3).

**Per-slice ship gate (unchanged):** full local CI mirror green (`./run.ps1 check`) → PR → CI green +
Codex `VERDICT: APPROVED` + every comment addressed → squash-merge. After SEO slices land, **deploy
web (manual)**, `curl` representative pages for real HTML, validate the sitemap index + chunks, then
resubmit the sitemap in GSC + Bing.

## Context to start fresh (don't relearn the hard way)

- **Process (mandatory reads before the matching work):** `claude_help/development-process.md`,
  `claude_help/testing-ci.md`, `claude_help/codex-review-process.md` (Codex is the GATING reviewer —
  bypass mode, WSL `cwd` = `/mnt/d/repos/fountainrank`, loop to APPROVED),
  `claude_help/github-cli.md`, `claude_help/kubernetes-infra.md`. New UI → `docs/style-guide.md` FIRST.
- **Where the SEO data lives:** `backend/app/membership.py` (assignment ladder + cell rebuild),
  `backend/app/models.py` (`PlaceBoundary`, `PlaceBoundaryCell`, `PlaceScopeConfig`, `Fountain`
  membership FKs), `backend/app/imports/boundary_cli.py` + `boundary_load.py` +
  `.github/workflows/osm-boundary-load.yml` (loader), `backend/app/imports/membership_cli.py`
  (backfill). Public routes will live in `backend/app/routers/` + `web/app/`.
- **The one hard rule for Slice 2+:** the public place path reads precomputed columns; **never a live
  `ST_Covers`** (spec §5, plan Risks). Filter hidden fountains; enforce the ≥K indexability gate in
  the API contract.
- **Operational:** deploy is manual (`gh workflow run deploy.yml --ref main`, memory
  `[[fountainrank-deploy-is-manual-dispatch]]`). Boundary loads / membership backfills go through
  `osm-boundary-load.yml` (CI-only prod write). Loading more countries rebuilds ALL cells each time;
  for a multi-country load use `--skip-membership-refresh` then one final refresh.
- **Local-check gotchas on this host (memory):**
  `[[fountainrank-windows-wsl-local-check-workarounds]]` (backend `.venv` is WSL-broken — use an
  isolated `UV_PROJECT_ENVIRONMENT` + `uv sync` once, then `uv run …`);
  `[[fountainrank-docker-desktop-wedge-recovery]]` (if Docker hangs: `wsl --terminate docker-desktop`
  + kill/relaunch the manager); JS unit/visual checks verify via CI, not locally.
