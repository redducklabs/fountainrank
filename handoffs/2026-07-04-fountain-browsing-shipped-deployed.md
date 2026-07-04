# Handoff — Fountain browsing (#169, #170, #168) shipped + deployed

**Date:** 2026-07-04
**PR:** #172 (squash-merged to `main` as `a517027`)
**Deploy:** production `workflow_dispatch` run `28702774155` — success (images built/pushed, DB
migrations ran [none new], DOKS rollouts completed).
**Codex:** spec/plan approved (review 3); PR approved (review 2, after one `[MINOR]` fix).

## What shipped

Three related fountain-browsing issues bundled into one PR (shared list-row + map deep-link):

- **#169 — City list stars + "See on Map" (web).** New shared presentational
  `web/components/fountain/FountainListRow.tsx` + `FountainList.tsx`: reuses the existing `Stars`
  component, renders "Not yet rated" when unrated, and adds a per-row **See on Map** link
  → `/?flyto=<lng>,<lat>&focus=<id>`. `MapBrowser` now derives the highlighted fountain from a new
  `?focus=` param via the pure `web/lib/map/active-id.ts` (`resolveActiveId`), so the link flies to
  **and** highlights the fountain. City page swapped to `<FountainList>`.
- **#170 — "My rated water fountains" (web).** New backend `GET /api/v1/me/fountains`
  (`backend/app/routers/users.py`, auth, caller-only): deduped fountains the user has any **awarded**
  contribution to (add/rate/note/condition), non-hidden, most-recent-contribution first
  (`MAX(created_at) DESC, fountain.id ASC`), serialized as `FountainPin`, with a defensive
  `LIMIT 500` + WARNING guardrail. New auth-gated page `web/app/account/fountains/page.tsx` reusing
  `FountainList`, plus a "My rated water fountains" link on the account page. Both account pages now
  share `web/lib/server/account-gate.ts` (`resolveAccountGate`) so the first-sign-in `needs_name`
  hard gate can't be bypassed on the subpage.
- **#168 — Share.** Web `ShareButton` now shows a transient **"Link copied!"** (or "Couldn't copy")
  state on the desktop clipboard path (it copied silently before → looked broken). Mobile gained a
  Share button on the fountain detail screen using `Share.share` with a **platform-aware** payload
  (iOS `{url}` / Android `{message}`) built from a new `webBaseUrl` config
  (`EXPO_PUBLIC_WEB_BASE_URL`, default `https://fountainrank.com`).

## Production verification (2026-07-04)

- `https://fountainrank.com/` → 200.
- City pages (e.g. `/drinking-fountains/us/manhattan`) render the "See on Map" deep-links with the
  correct `/?flyto=<lng>,<lat>&focus=<uuid>` href and the "Not yet rated" branch. **Note:** the
  sampled OSM cities have **no rated fountains**, so the star branch wasn't exercised live — it's
  unit-tested and uses the identical, already-in-prod `Stars` component.
- `GET https://api.fountainrank.com/api/v1/me/fountains` → 401 unauthenticated (deployed + gated).
- `https://fountainrank.com/account/fountains` → 200, renders the sign-in gate for anon users.

## Still pending / follow-ups

- **Mobile Share button reaches users only when the next mobile build is cut** (EAS build / store
  release) — it is not part of the web/backend DOKS deploy. The web share fix IS live.
- **Latent repo inconsistency (not blocking):** `packages/api-client/openapi.json` and
  `src/schema.d.ts` are **git-tracked** yet also listed in `.gitignore` (lines ~66–67). The ignore
  is ineffective for already-tracked files, so every endpoint PR commits the regenerated artifacts
  (this PR did too, matching SEO/leaderboard precedent). Worth a cleanup decision later: either
  `git rm --cached` them and rely on CI regen, or drop the stale `.gitignore` lines. Codex flagged
  the ambiguity; convention (commit them) was followed.
- **#170 is web-only this batch** (per product decision). A mobile "my rated fountains" list can
  reuse the same `/me/fountains` endpoint as a follow-up.

## Notes for the next session

- Implementation deviated from the plan in two intentional, Codex-reviewed ways: (1) mobile
  `shareContent(url, platformOS)` takes the platform as a **param** (component passes `Platform.OS`)
  so the node/vitest pure-helper suite needs no `react-native` mock; (2) the api-client generated
  files were committed (see above).
- Local `node_modules` was repaired mid-session (a Codex review shell's interrupted `pnpm install`
  left the tree missing binaries); a clean `pnpm install --frozen-lockfile` fixed it. Nothing in the
  repo was affected.
- Earlier this session: **~25 already-implemented-but-open issues were closed** (rankings #146/#147/#149,
  add-fountain #98/#99/#102, mobile bugs #103/#104/#105/#120, SEO #125/#126/#127/#128/#135, ratings
  #38/#39/#40/#41/#42/#44/#65, misc #19/#131/#95) after code verification. **Still open** after this
  batch: #167 (photo uploads/carousel — heaviest), #43 (web filter chips — backend/mobile done),
  #18 (dark mode), moderation #10/#11/#12/#13, and #124 (repeat-award cap — implemented as a
  per-UTC-day cap; left open pending a decision on rolling-24h vs calendar-day).
