# GA4 web analytics DEPLOYED + #129 deployed/submitted — handoff (2026-06-30)

**Source:** the session that (1) deployed the already-merged #129 ("kill Anonymous"), (2) submitted
the mobile store release for #129, and (3) built + shipped **GA4 web analytics (#130)** end-to-end
(spec → Codex → plan → Codex → implement → PR → CI → Codex PR → merge → deploy → live-verify).

---

## ✅ What shipped this session

### 1. #129 ("kill Anonymous") — DEPLOYED + mobile SUBMITTED
- **Web/backend deploy** `28475213231` (now superseded) ran the **`0012_users_nickname`** Alembic
  migration on production (confirmed in logs: `Running upgrade 0011… -> 0012_users_nickname`). The
  gate + `/me`/`PATCH /me` changes are live.
- **Mobile store release** `28475214799` succeeded — **both iOS (App Store Connect) and Android (Play
  internal) submitted**. Owner then device-verifies via the #129 checklist.
- **Live "Anonymous" leaderboard row** (subject `4zsznfwtd8cx`) clears the moment the owner
  re-signs-in on mobile and sets a name (no DB mutation needed). **Still owner-pending.**
- Two Dependabot PRs (#1 actions/checkout, #15 backend-python group) merged to main and rode along
  in the same deploy. Main advanced `0350c48 → 570951b (#1) → d8d2ea1 (#15)` before GA4.

### 2. GA4 web analytics (#130) — MERGED + DEPLOYED + LIVE-VERIFIED
- Squash-merged as **`54807f4`**; deployed via `28480855255` (success); **live-verified on
  fountainrank.com** with a real browser: the **consent banner renders** (Decline / Accept + /privacy
  link), and **before consent NOTHING GA loads** (no `gtag/js` script, no `_ga` cookie, no
  `dataLayer`, no stored consent). Privacy page's new **Analytics** section is live.
- **Spec** `docs/specs/2026-06-30-ga4-web-analytics-design.md` (Codex-APPROVED, 3 rounds); **plan**
  `docs/plans/2026-06-30-ga4-web-analytics.md` (Codex-APPROVED, 4 rounds); **PR #130** Codex PR review
  APPROVED (2 rounds). All review artifacts in `temp/codex-reviews/` (gitignored).

**GA4 design as built (note the deviations from the original handoff — both owner-confirmed):**
- **`next/script` + a typed `window.gtag` helper — NOT `@next/third-parties`.** Codex verified
  `@next/third-parties@16.2.9` cannot do consent-gated, query-string-free GA: its `<GoogleAnalytics>`
  sends the full landing URL at `gtag('config')` time (no flag to disable) and its `sendGAEvent` only
  works once that leaking component rendered. So we bootstrap gtag ourselves with
  `send_page_view:false` and a canonical `function gtag(){ dataLayer.push(arguments); }` wrapper.
- **Path-only:** `page_path`/`page_location`/`page_referrer` all have query strings + fragments
  stripped (`sanitizePagePath`/`sanitizeUrl`); the sender uses `usePathname()` only, never
  `useSearchParams()`. So the leaderboard `?lat/lng` (approximate location) never reaches Google.
- **Consent-gated, fail-closed:** GA loads only after Accept; consent persists in `localStorage`; a
  failed write stays fail-closed (no GA, banner remains). Read via `useSyncExternalStore` (SSR-safe;
  the repo's `react-hooks/set-state-in-effect` rule forbids a mount-effect `setState`).
- **Prod + canonical-host gated:** GA/banner only on `NODE_ENV==="production"` AND
  `fountainrank.com`/`www.fountainrank.com` — local dev, forks, previews never load GA.
- Files: `web/lib/analytics.ts`, `web/components/analytics/{gtag,GaScripts,GaPageView,ConsentBanner,AnalyticsConsent}.tsx`,
  `web/app/layout.tsx`, `web/app/privacy/page.tsx`, `docs/style-guide.md` (consent-banner element).

---

## ⚠️ GA4 Admin gotcha (read before any GA work)

The design requires GA4 Enhanced-Measurement **"Page views" OFF** so GA doesn't re-add unsanitized,
full-URL auto page-views. In the GA4 UI:
- You **cannot** uncheck the inner **"Page loads"** sub-checkbox — GA **locks it on** whenever the
  "Page views" feature is enabled. The only real off-switch is the **master "Page views" toggle**.
- The **owner unchecked "Page changes based on browser history events"** (the SPA one that would leak
  full URLs on in-app navigation) — that's the critical one and it's **off**.
- **We are safe either way** because our code sets `send_page_view:false` (suppresses the load
  page-view) AND browser-history-events is off. The "Page views" chip in the GA summary is just a
  stream-config indicator; no automatic page-views actually fire. Flipping the **master "Page views"
  toggle off** gives a clean chip-free state (optional) — our manual sanitized page-views still work.
- **Owner follow-up (optional):** decide whether to flip the master "Page views" toggle fully off.

---

## 🔵 Open follow-ups (not blockers)

- **Owner accept-flow verification (live):** on fountainrank.com, Accept → `gtag/js` loads + a
  path-only `page_view` is sent; navigate to `/leaderboard?lat=…&lng=…` and confirm
  `page_path`/`page_location`/`page_referrer` carry **no** query string; reload persists the choice;
  Decline loads nothing. (Not done in-session to avoid sending test hits to the production property.)
- **#129 device verification + close #103** after the owner device-verifies the mobile name gate.
- **`b0c49fc`** ("readme, security, and contributing files") was the **owner's own commit** that
  landed on the GA4 branch base; the owner chose to **keep it bundled** in #130, so README/
  CONTRIBUTING/SECURITY changes are now on main (squashed into `54807f4`).
- **GA4 follow-ups deferred (YAGNI):** GA events for key actions (sign-in/add/rate) — page_view only
  for v1; a footer "cookie settings" re-prompt for a declined choice; **mobile GA** (separate effort);
  a CSP (none exists today; if added, allow `googletagmanager.com`/`google-analytics.com`).

---

## ⚙️ Environment reality (unchanged — read before picking up)

Windows host with Codex's WSL-built `node_modules`
([[fountainrank-windows-wsl-local-check-workarounds]]):
- **Locally runnable:** `tsc`, prettier (via the pnpm-store binary
  `node_modules/.pnpm/prettier@*/…/prettier.cjs`), and **non-render vitest** (pure-logic +
  `window`/dataLayer tests like `gtag.test.ts`) — run vitest with `node ../node_modules/vitest/vitest.mjs run <file>` from `web/`.
- **CI-only on this machine:** **ESLint** (fails locally with `EACCES` on `web/node_modules/react`),
  **`next build`**, and **React render tests** (jsdom renders an empty body locally — e.g.
  `AnalyticsConsent`/`GaScripts`/`GaPageView`/`ConsentBanner` tests pass in CI but render nothing
  locally). Lesson this session: a `react-hooks/set-state-in-effect` error only surfaced in CI →
  fixed with `useSyncExternalStore` + dropping a `ready`-state gate.
- **GA4 needed no api-client regen** (no backend changes).

---

## 🔁 Process gate (unchanged — per `CLAUDE.md`)

branch → PR → **CI green AND Codex `VERDICT: APPROVED` AND every PR comment addressed** →
**squash-merge** → deploy (manual dispatch: `gh workflow run deploy.yml --ref main`). Codex spec/plan
review before code AND PR review before merge, both bypass mode
(`sandbox:"danger-full-access"`, `approval-policy:"never"`), WSL `cwd` `/mnt/d/repos/fountainrank`,
repo-relative paths, loop until APPROVED. No AI attribution, no time estimates. New UI →
`docs/style-guide.md`. Handoff/docs commits go direct to `main`.

**Backlog:** ~29 open issues (P1 mobile #102 inert draft pin; P2 add-fountain/map polish batch
#98–#101/#104/#105/#120/#99; web #121 points-badge overlap; verify-and-close #65/#85). Pull with
`gh issue list --repo redducklabs/fountainrank` / `gh issue view <N>`.
