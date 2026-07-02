# Rankings + SEO bug-fixes, mobile store deploy, SEO-pages spec — handoff (2026-07-02)

**Source:** the session that pulled a batch of filed issues off the backlog, shipped
them as three PRs, **deployed both mobile apps** to internal testing, and wrote a
design spec for the larger SEO-pages work so a fresh session can pick it up.

---

## ✅ Shipped this session (all squash-merged to `main`, each CI-green + Codex `VERDICT: APPROVED`)

| PR | Issues | Commit | What |
|----|--------|--------|------|
| **#152** | #149 | `135b0bf` | **Mobile rankings refresh** — `leaderboard.tsx` refetches on tab focus (`useFocusEffect`) + pull-to-refresh (`RefreshControl`); it was stale because the app-wide `refetchOnWindowFocus` is off. |
| **#153** | #125, #126 | `142fff3` | **Web SEO discovery** — `app/robots.ts` (`/robots.txt`), `app/sitemap.ts` (`/sitemap.xml`, static pages only), `middleware.ts` 308 `www→apex`, self-referential `alternates.canonical` on public pages, `lib/seo/site.ts`. |
| **#154** | #146, #147 | `d51fea7` | **Rankings polish** — crown on the rank-1 (category-leader) row; sticky "You" overlay when the caller's row is off-screen. Web (IntersectionObserver) + mobile (FlatList viewability). |

Docs commit `de42051`: the SEO-pages spec (see §4).

## 📱 Mobile store deploy — DONE this session

Triggered `mobile-store-release.yml` via **workflow_dispatch** (platform=all) from `main`
HEAD `d51fea7`. **Run [28625885958](https://github.com/redducklabs/fountainrank/actions/runs/28625885958) — all jobs SUCCESS:**
- **iOS** → built + submitted to **App Store Connect / TestFlight**.
- **Android** → built + submitted to **Google Play internal testing** (`releaseStatus: completed`).
- Release notes auto-generated from `v0.11.0..HEAD`.

This build carries #149 / #146 / #147 (and everything merged since v0.11.0). It is the
build to use for the **on-device verification** below. (Deploy was untagged
workflow_dispatch, matching the owner's recent ad-hoc pattern; no `v0.12.0` tag was pushed.)
TestFlight "What to Test" / Play "What's new" notes are printed in the run summary for
optional manual paste (EAS hosted submit can't set them on this plan).

## 🔎 Issue status (do NOT re-implement without checking — the memory rule)

**Code-complete on `main`, open only for on-device verification** (needs the owner's hardware;
now in the fresh TestFlight/Play build above):
- **#149** rankings refresh — verify: rank a fountain on web, open mobile Rankings → it updates; pull-to-refresh works.
- **#146** crown — verify the rank-1 row shows the crown in each sort. (Web half is unit-tested.)
- **#147** sticky "You" overlay — verify scrolling away from your row shows the overlay, scrolling back hides it. (Web half is unit-tested.)
- **#102 / #103 / #104 / #105** — from the prior session's device-test list; still pending device confirm.
- **#120** iOS app icon — `mobile/assets/icon.png` is already opaque RGB (white) in the repo (fixed back in #92); just needs an on-device eyeball + close.

**Already done (owner said so this session):** **#98 / #99** (add-fountain starter/draft pin).

## 🟢 #127 + #128 — spec + plan **Codex-APPROVED**, ready to implement (this is the "rest of the stuff")

**Design decided this session with the owner + reviewed to green:**
- **Spec:** `docs/specs/2026-07-02-crawlable-seo-pages-design.md`
- **Plan:** `docs/plans/2026-07-02-crawlable-seo-pages.md`
- **Codex plan-review looped to `VERDICT: APPROVED`** (round 3) — artifacts in
  `temp/codex-reviews/2026-07-02-crawlable-seo-pages-plan-review-{1,2,3}.md`. **Start at Slice 0.**

**The approach (owner-decided): real SEO value via offline OSM admin boundaries, ZERO LocationIQ.**
Fountains have no name/address/city (only a lat/lng point; the detail page hardcodes
`<h1>Public drinking fountain</h1>`), so mass per-fountain pages would be thin duplicate content.
Instead: load a **prebuilt, OSM-derived global admin-boundary dataset** (independent of the
per-state fountain-import registry) once into a `place_boundaries` PostGIS table, and derive
**country + city** landing pages by point-in-polygon (`ST_Covers`) — the boundary's `name` supplies
the place name. Key design points Codex hardened: mandatory **precomputed** place membership (never
live `ST_Covers` on the request path), a canonical `(country_code, slug)` URL identity, a corrected
Next `generateSitemaps` **index** topology, a single public **indexing predicate** (public data
only), and **vertical release slices** (Slice 0 spike → 1 data-only → 2 country → 3 city → 4
attributes → 5 detail).

**Owner decisions — RESOLVED in the spec (§8):** (1) city derivation = offline OSM admin
boundaries; (2) index fountains = yes, selectively (under the §7 predicate); (3) GA4 key events =
**excluded** from this plan.

**Two Slice-0 things to settle before Slice 1 code** (called out in the plan): pick the concrete
boundary **dataset/source** (prebuilt vs osmium-from-planet) on a small area, and confirm the CI
retains/re-fetches whatever input the boundary load needs.

**#128 specifically:** GA4 is **already installed** (`web/lib/analytics.ts`, `G-BG3PYM6T43`,
consent-gated, path-only). Organic landing-page/source data is already collected. The remainder is
**owner-local, not repo code**: add the GA4 property id to the SEO agent's local registry (no
secrets committed) and run `seo_health_check` until GA4 = `ok`.

## 🔵 Web deploy — PENDING (owner, next)

The owner said they'll deploy web after this. `main` currently has the merged **#125/#126** SEO
work but it is **NOT live** (web deploy is manual — see [[fountainrank-deploy-is-manual-dispatch]]).
Deploying now ships robots.txt + sitemap.xml + the www→apex redirect + canonical tags. Nothing
new from #127/#128 (spec only). After deploy:
- Verify `curl -I https://fountainrank.com/robots.txt` and `/sitemap.xml` return `200`, and
  `curl -I https://www.fountainrank.com/` returns `308` → apex.
- **Submit** `https://fountainrank.com/sitemap.xml` to Google Search Console + Bing Webmaster Tools (#125).
- Unrelated but pending: set `NEXT_PUBLIC_APP_STORE_URL` / `NEXT_PUBLIC_GOOGLE_PLAY_URL` on the web
  deploy once the store listings have public URLs (footer badges hide until present) (#135).

## 📋 Outstanding owner actions (checklist)
- [ ] On-device verify #149, #146, #147 (this build) → close them; also #102–105, #120.
- [ ] Deploy web (manual) → verify robots/sitemap/redirect live → submit sitemap to GSC + Bing.
- [ ] Add GA4 property id to the SEO agent registry; `seo_health_check` → GA4 `ok` (#128).
- [ ] Implement #127 from the **Codex-approved** plan (`docs/plans/2026-07-02-crawlable-seo-pages.md`), starting at **Slice 0** (pick the boundary dataset/source). Spec §8 decisions are already resolved.

## 🔁 Process gate (unchanged — per `CLAUDE.md`)
branch → PR → **CI green AND Codex `VERDICT: APPROVED` AND every PR comment addressed** →
**squash-merge**. Codex PR review in bypass mode (`sandbox:"danger-full-access"`,
`approval-policy:"never"`), WSL `cwd` `/mnt/d/repos/fountainrank`, repo-relative paths, loop until
APPROVED. New UI → `docs/style-guide.md`. Handoff/docs/spec commits go direct to `main`. Mobile
deploy + web deploy are manual dispatch and owner-gated. **No AI attribution, no time estimates.**

## ⚠️ Gotchas confirmed this session (see memory)
- **Mobile eslint (Expo React-Compiler) is stricter than web and only fails in CI** —
  no `useRef(...).current` read during render, no unconditional `setState` in `useEffect`.
  `tsc`/`prettier` pass without catching these; local mobile eslint can't run (WSL EACCES). Cost 2 CI
  rounds on #154. New memory: [[fountainrank-mobile-react-compiler-eslint-stricter]].
- **Local checks that DO run on Windows** despite the WSL `node_modules`: `tsc` via
  `node node_modules/typescript/bin/tsc --noEmit` (per workspace) and **prettier via
  `npx prettier@3.8.4 --check`**. `eslint` / `vitest` / `next build` / `expo-doctor` are CI-only
  (`workspace-js` / `mobile-doctor` are the source of truth). See
  [[fountainrank-windows-wsl-local-check-workarounds]].
- **Web HAS a jsdom component-test harness** (`web/components/**/*.test.tsx` with
  `// @vitest-environment jsdom` + `@testing-library/react`) — not just pure-helper tests. The
  `LeaderboardRows.test.tsx` in #154 mocks `IntersectionObserver` for the sticky-overlay tests.
