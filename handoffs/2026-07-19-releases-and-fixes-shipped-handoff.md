# Handoff — v1.0 releases shipped, SEO P1/P3 live, DB resized (2026-07-19)

Pick-up doc for a fresh session. The previous session (`handoffs/2026-07-18-…`) queued the SEO
program + France; this session **shipped most of it to production** and cut the **v1.0 mobile
release**. The main remaining work is **SEO Priority 2 (#53: ItemList + internal links)** plus a few
tracked follow-ups. Supersedes the 2026-07-18 handoff.

`main` is at `90bd19e`. Live prod verified at handoff (~17:37Z). **RE-VERIFY, don't trust.**

---

## 1. What shipped this session (all merged, deployed, prod-verified)

| PR | What | Verified |
|---|---|---|
| **#255** | Cities-sitemap chunking: flat backend feed `GET /api/v1/places/cities/sitemap` + web `/sitemaps/cities/{n}.xml` chunks (fixes the 50k-URL/file limit, the 1000-per-region truncation, and the N+1 fan-out). | `/sitemaps/cities/0.xml` → 200 |
| **#256** | Managed Postgres `db-s-1vcpu-1gb` → **`db-s-2vcpu-4gb`** (DO low-resources alert; the 1 GB was the never-tuned initial default). | `doctl databases get f0d18645-…` → `db-s-2vcpu-4gb online` |
| **#258** | Owner-approved SEO positioning copy (homepage h1 + live-count meta description) + `GET /api/v1/stats` (`total_fountains`, `total_countries`). | `/api/v1/stats` → `{285108, 48}`; homepage h1 "The largest community-rated guide…"; France title "Public drinking fountains in France — 26,622 mapped" |
| **#259** | `terraform.yml` optional `-target` input for **scoped** plan/apply (validated argv, no shell injection). | used it to resize the DB in isolation |
| **#260** | Mobile `defaultAppVersion` `1.0.0` → **`1.0.1`** (unblock iOS store submit). | on main |
| **#261** | `LoadableImage` sizing footgun root-fix (place-page photo-row thumbnails were overflowing; also fixed account/admin/AuthControl avatars). | California page wrappers now `h-12 w-12 shrink-0` (no `h-full w-full`) |

**Releases (v1.0.0 tag pushed; iOS re-released at 1.0.1):**
- **Android `1.0.0` → LIVE on Google Play production** (releaseStatus: completed).
- **iOS `1.0.1` → submitted to App Store Connect / TestFlight** (run `29675794623` success). The first
  iOS attempt at `1.0.0` failed on a **stuck version** (see §3); the `1.0.1` bump fixed it.
- **France boundary load**: verified committed — 37,026 city boundaries, 13 regions, 1 country,
  **26,622 fountains assigned**, 8,734 canonical cities with fountains. (Task #49 done.)

---

## 2. Next items (prioritized)

### 2a. [PRIORITY 1 — the main next job] SEO #53: ItemList schema + sideways internal links

The **last owner-approved SEO recommendation** (handoff-2026-07-18 §3b). Two parts:

1. **`ItemList` structured data** on the country/region/city place templates. **CORRECTION to the prior
   handoff:** the directory root (`web/app/drinking-fountains/page.tsx`) emits a **`BreadcrumbList`,
   NOT an `ItemList`** — so this is net-new. Per-template shape:
   - **City / region pages** (they list fountains): `ItemList` of the listed fountains, each `ListItem`
     → `/fountains/{id}` (consider `Place` per item). Data already fetched (`FountainList`).
   - **Country page** (lists child places, not fountains): `ItemList` of the child cities/regions.
   Emit alongside the existing `BreadcrumbList` via `web/lib/seo/jsonld.ts` `jsonLdScript`, gated on
   `indexable` like the breadcrumb.
2. **Sibling / nearby internal links** (pages currently link only UP + DOWN, no lateral).
   - City page → **"Other cities in {region}"** via `getRegionCitiesServer` (existing endpoint,
     exclude current). Region page → **"Other regions in {country}"** via `getCountryRegionsServer`.
   - **Geo-"nearby by distance" needs a NEW backend affordance** (no such endpoint exists) — treat as
     optional/later; the same-region/country siblings above use existing endpoints and are the main win.

Files: `web/app/drinking-fountains/[country]/page.tsx`, `.../[country]/[place]/page.tsx`,
`.../[country]/[place]/[city]/page.tsx`; `web/lib/seo/jsonld.ts`; `web/lib/places.ts`. Web-only (unless
geo-nearby); full CI + Codex gate. Adds fetches to place pages — the 4 GB DB has headroom now.

### 2b. Owner manual action — iOS App Store promotion
Once iOS `1.0.1` finishes processing in TestFlight, the **owner** promotes it **TestFlight → App Store**
review in App Store Connect (CI cannot do this step). Task #58 covers the CI side (done).

### 2c. Tracked follow-ups (surfaced by the DB-resize plan; NOT yet done)
- **Photos-Spaces count-gate is a silent-destroy trap.** A *full* `terraform apply` plans
  `digitalocean_spaces_bucket.photos[0]` **to DESTROY** (`manage_photos_spaces` default false). This
  session dodged it with `-target`; it should be reconciled permanently (make unconditional like the
  basemap gate via `moved`, or remove from state) once the photos bucket's fate + a bucket-create-capable
  Spaces key are decided. **Until then, only ever run scoped `-target` applies, or set
  `manage_photos_spaces=true`.**
- **DOKS version auto-drift.** `kubernetes_version_prefix = "1.34."` auto-selects the latest patch, so a
  full apply plans a node roll (`1.34.8-do.2 → do.3`). Consider pinning the exact version.
- **Mobile version-scheme fragility.** `defaultAppVersion` (config) vs `v*.*.*` tags have diverged; a
  plain dispatch resolves to the config value, so **you MUST bump `defaultAppVersion` for every store
  release** (now documented in `mobile/README.md` + `docs/setup/07`). Consider reconciling to a single
  scheme (tag-only, or auto-bump the config).

### 2d. [OPTIONAL / LATER] SEO 3d levers (from the 2026-07-18 handoff)
`force-dynamic` on every place page + sitemap = no caching → heavy backend load at crawl scale
(consider ISR/careful caching — the homepage stats already use `unstable_cache` 1h as a model);
OpenGraph images; hreflang. Track the place-page cohort impressions→clicks via the `seo` skill as
countries index (GSC site `fountainrank`, GA4 property `543842314`) — read `claude_help/seo.md` first.

---

## 3. Durable facts learned this session (non-obvious; save/trust these)

- **`LoadableImage` sizing contract** (`web/components/ui/LoadableImage.tsx`): the wrapper's size comes
  from `wrapperClassName` (defaults to `h-full w-full` to fill a sized parent). Callers either (a) pass
  explicit sizing via `wrapperClassName` (e.g. `h-12 w-12 shrink-0`), or (b) wrap it in a sized parent
  and pass `className="h-full w-full"` (PhotoHero/PhotoCarousel). **Do NOT re-add `h-full w-full` to the
  wrapper base** — that was the #257 footgun that stretched fixed-size thumbnails to full row width.
- **Mobile iOS store submit — "already submitted this version" is a VERSION problem, not credentials.**
  The `Failed to authenticate with the App Store Connect API key … Apple Team ID:` line in EAS iOS logs
  is **BENIGN** (it appears verbatim in *successful* runs and recovers with "✔ App Store Connect API Key
  already set up"). The real blocker is App Store Connect rejecting a duplicate `CFBundleShortVersionString`
  (`expo.version`). Fix = bump `defaultAppVersion`. Android is immune (auto-incremented `versionCode`).
- **Release triggers:** a `v*.*.*` **tag** triggers BOTH `deploy.yml` (web) AND `mobile-store-release.yml`
  (both platforms). For platform-specific / non-coupled, **dispatch** `mobile-store-release.yml -f
  platform=ios|android` (computes version from `defaultAppVersion` when no ≥ tag exists). Android
  auto-publishes to **Play production**; iOS → TestFlight (manual App Store step).
- **`terraform apply` DB resize is in-place** (`Databases.Resize`, provider 2.90.0) — **not ForceNew, no
  data loss** (confirmed). But a resize causes a brief **failover/connection drop** — never apply while a
  boundary load is in flight. `terraform.yml` now supports `-target` for surgical applies.
- Deploy is still a **manual CI dispatch** (`gh workflow run deploy.yml --ref main`); merging to `main`
  does NOT deploy. `/api/v1/stats` is cached 1h in the web via `unstable_cache` (don't make the homepage
  run a full `count()` per request).

---

## 4. Key files

- SEO/web: `web/app/drinking-fountains/**` (place templates), `web/lib/seo/jsonld.ts`, `web/lib/places.ts`
  (path helpers, `placeTitle`, `roundedCountPlus`, server fetchers incl. `getSiteStatsServer`,
  `getSitemapCitiesServer`), `web/app/sitemaps/**`, `web/app/page.tsx` (homepage `generateMetadata`),
  `web/components/SiteHeader.tsx` (hero h1), `web/components/ui/LoadableImage.tsx`,
  `web/components/fountain/FountainListRow.tsx`.
- Backend: `backend/app/routers/places.py` (`cities_sitemap`), `backend/app/routers/stats.py`,
  `backend/app/schemas.py`.
- Mobile release: `.github/workflows/mobile-store-release.yml`, `mobile/eas.json`, `mobile/app.config.ts`
  (`defaultAppVersion`).
- Infra: `infra/terraform/main.tf` (`db_size` now 4gb; photos count-gate; node version prefix),
  `.github/workflows/terraform.yml` (`-target` input).

## 5. Process / guardrails (unchanged)

- All work: branch → PR → **CI green + Codex `VERDICT: APPROVED` + every PR comment addressed** →
  **squash-merge**. Codex via the MCP server in bypass mode (`sandbox: danger-full-access`,
  `approval-policy: never`), cwd `/mnt/d/repos/fountainrank`; read `claude_help/codex-review-process.md`.
  (This session: automated security review also flagged a real workflow-injection issue on #259 — heed it.)
- Backend verifies locally via isolated `UV_PROJECT_ENVIRONMENT` + `./run.ps1 check -Backend` (DB on
  `localhost:5436`); web `tsc`/ESLint/Prettier/`next build` + **pure-logic** vitest run locally;
  component-render + full JS suites and mobile `expo-doctor`/React-Compiler lint are **CI-only**.
  (Note: render suites like `FountainListRow.test.tsx` / `LoadableImage.test.tsx` *did* run locally this
  session — try them, but CI `workspace-js` is the source of truth.)
- **No AI attribution** in commits/PRs; **no time estimates**. **IaC applies are CI-only, plan-first,
  read the WHOLE blast radius** (the photos-gate trap in §2c is why). DB inspection is read-only via the
  backend pod's `get_engine()` with `SET statement_timeout` (heavy joins over `place_boundary_cells` can
  time out on the loaded DB — use single-table `place_boundaries` filters instead).

## 6. Open tasks (TaskCreate IDs this session)

- **#53 (pending)** — SEO 3b: ItemList schema + sideways internal links. **The main next job (§2a).**
- #49/#52/#54/#55/#56/#57/#58 ✅ done. #50/#51 ✅ (prior). 
- Consider filing tasks for the §2c follow-ups (photos-gate reconcile, DOKS version pin, mobile
  version-scheme) and §2d optional levers.

## 7. Reference index

- Codex reviews (gitignored, this session): `temp/codex-reviews/pr-{255,256,258,259,260,261}-review-*.md`.
- Prior handoffs: `handoffs/2026-07-18-france-loaded-and-seo-programmatic-plan-handoff.md` (SEO plan +
  France, now shipped), `handoffs/2026-07-17-…`, `handoffs/2026-07-15-…`.
- SEO ops: `claude_help/seo.md`; product SEO playbook `docs/runbooks/seo.md`.
- Infra: `claude_help/kubernetes-infra.md`; mobile: `mobile/README.md`, `docs/setup/07-mobile-store-readiness.md`.
- Commit THIS handoff with the first PR of the next session (established uncommitted-handoff pattern).
