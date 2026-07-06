# Handoff — #18 dark mode: Plan 2 (web) SHIPPED + DEPLOYED; next = Plan 3 (mobile)

**Date:** 2026-07-05
**Branch:** `main` @ `ae13303` (clean, pushed). PR **#192** squash-merged; **deployed to production and verified live.**
**Purpose:** Continue #18 dark mode from Plan 3 (mobile). Web is done and live.

---

## What shipped this session

**Plan 2 (web dark mode) — written, Codex-approved, implemented, merged, deployed.**

- **Plan:** `docs/plans/2026-07-05-dark-mode-2-web.md` (Codex plan-review APPROVED, 3 rounds). Spec `docs/specs/2026-07-05-dark-mode-design.md` (already approved).
- **PR #192** (`feat(web): app-wide dark mode (#18) (#192)` = `ae13303`): CI green (`workspace-js` incl. web render tests on Linux, backend, mobile-doctor, CodeQL, audits, trivy-fs), Codex PR-review APPROVED (2 rounds), the one `[MINOR]` (deploy.yml env dup) fixed + replied.
- **Deployed:** `gh workflow run deploy.yml --ref main` → run `28765875626` **success**. Verified live: `fountainrank.com` 200, API `/readyz` PostGIS ok, `style.dark.json?v=2` 200.

**What's in it (13 tasks, subagent-driven with per-task + final whole-branch review):**
1. Semantic **token layer** — `web/lib/theme/palette.ts` (canonical hex) → `web/app/globals.css` (Tailwind v4 `@custom-variant dark (&:where(.dark, .dark *))` + `:root`/`.dark` + `@theme inline`), locked by `web/lib/theme/palette.test.ts` (mirror + WCAG-AA contrast).
2. **Provider + toggle** — `next-themes@0.4.6` (`web/app/providers.tsx`, `layout.tsx` `suppressHydrationWarning`); `web/components/ThemeToggle.tsx` = 3-state System/Light/Dark, **native `<input type=radio>`** in a `<fieldset>` with a **per-instance `useId()`** group name, hydration-safe via **`useSyncExternalStore`** (NOT `useEffect`+`setState` — the repo's `react-hooks/set-state-in-effect` rule forbids that). In `SiteHeader` + account body.
3. **Full re-tone** (~56 files) — brand hex + named neutrals + status `dark:` chips → tokens; enforced by two hard grep gates (brand-hex + solid neutrals; `bg-white/…` translucent-on-gradient intentionally excluded).
4. **Dark pins** — `scripts/gen-pin-assets.py` + `scripts/assets/gen_unrated_pin.py` emit `pin-*-dark.png` + `pill-bg-dark.png` (web only; **mobile dark pins = Plan 3**).
5–10. **Runtime dark basemap swap** — `web/lib/map/colors.ts` (theme paint), `styleUrlFor`/themed asset helpers (`style.ts`), theme-aware `layers.ts` factories, theme-suffixed feature icons (`pins.ts`), themed `placement-map.ts` (+ `reinstall`), and the `MapBrowser.tsx` rewrite: split one-time listener wiring vs per-`style.load` `installOverlay`, `styleGenRef` generation guard, `styleThemeRef` (basemap-target theme) so rapid toggles / in-flight bbox can't strand a mismatch; `map.setStyle` (camera preserved, never rebuilt).
11. `deploy.yml` **dark-basemap availability gate** (curl `style.dark.json?v=2` → 200 before web build; `BASEMAP_CDN`/`BASEMAP_STYLE_VER` job-level env).
12. **A11y** — WCAG-AA contrast test (12/12); a **`brand-ink`** token split (see below).
13. Docs — `docs/style-guide.md` token table + ThemeToggle entry.

### Key design decisions worth knowing
- **`brand-ink` token split (Task 12):** `--brand` (navy) serves BOTH brand-band backgrounds (need navy for white text) AND heading/link text on content (need light on dark). One value can't do both — navy `text-brand` on `--surface` was ~1.2–1.5:1 (invisible). Fix: added `--brand-ink` (light `#0A357E`, dark `#8AB4F8`) for brand TEXT on content; re-toned `text-brand`/`text-brand-mid`/`text-brand-royal` → `text-brand-ink` **except** the ~14 navy-`text-brand`-on-`bg-accent-gold` CTAs (gold is theme-invariant, 6.85:1 — kept). Bands/fills (`bg-/from-/via-/to-/ring-/border-brand*`) keep navy.
- **Reviews caught real bugs (all fixed):** invisible dark headings (→ brand-ink); a rapid light→dark→light **basemap/overlay race** (guarded on last *installed overlay* not last *basemap-target* theme → added `styleThemeRef`); `ThemeToggle.test.tsx` missing `// @vitest-environment jsdom` (fails CI too); byte-identical `pin-standard-dark`/`pin-selected-dark` (gave selected a wider white ring).

---

## Next: Plan 3 (mobile dark mode) — per spec §6

Not started. Scope (spec §6): split `mobile/theme.ts` into `lightColors`/`darkColors`; a `ThemeProvider` (merges `useColorScheme()` + AsyncStorage `theme` key, isolated from web localStorage) as the **outermost** provider in `mobile/app/_layout.tsx:43-50`; rewire ~37 `useTheme()` importers; theme-aware `StatusBar`; toggle on the account/profile tab; **both** map surfaces themed — `mobile/components/map/FountainMap.tsx` **and** `mobile/components/add-fountain/AddFountainMap.tsx`. Mobile dark pins = `pin-*-dark.png` (no `pin-selected`/`pill-bg` — mobile pill is text+halo); have `gen_unrated_pin.py` dual-write the dark set; the other three mobile pins are hand-copied from web today. Flow: spec §6 → write `docs/plans/2026-07-05-dark-mode-3-mobile.md` → Codex plan-review loop → implement → PR (CI + Codex + comments) → squash-merge → mobile store release is a separate `mobile-store-release.yml` dispatch.

## Deferred / follow-ups (web, non-blocking)
- **Dark-mode VISUAL pass** — needs a WebGL2 browser (owner's device; this dev host has none). Toggle behavior, no-flash on dark-preference cold load, the dark basemap + dark pins, dark-surface contrast. Static analysis says all good; an eyeball is the last confirmation.
- `MAP_COLORS` dark paint (cluster/halo/pill) was left at spec values (not visually tuned — the a11y contrast test doesn't cover map paint on the basemap land). Tune vs screenshots if anything reads low-contrast.
- Minor: add a palette "no EXTRA token" mirror assertion; a couple of test-hardening nits (style/layers by-value light assertions); some **older illustrative code snippets in `docs/style-guide.md` still show pre-re-tone hex** (`bg-[#F2C200]`) — doc-debt, no task covered them.

## Process + environment reminders
- **Deploy is a manual dispatch** — merge to main does NOT deploy. `gh workflow run deploy.yml --ref main` (behind the new `style.dark.json` gate). [[fountainrank-deploy-is-manual-dispatch]]
- **Local checks on this Windows host:** the JS toolchain was wedged (Codex's WSL `node_modules` drift → pnpm purge/EPERM). **Repair that worked:** `wsl.exe -e bash -c "... rm -rf node_modules web/node_modules mobile/node_modules packages/*/node_modules"` then Windows `pnpm install --frozen-lockfile`. After repair: `pnpm --filter web exec vitest run <file>` (pure-logic), `tsc`, `lint`, `prettier`, `next build` run locally via `powershell.exe -NoProfile -Command "…"`. **Component-RENDER vitest still fails locally** (hoisted-linker duplicate React) → CI `workspace-js` (Linux) is the truth. NEVER bare `pnpm run`/`CI=true`. [[fountainrank-windows-wsl-local-check-workarounds]]
- Spec/plan AND PR each need a Codex review loop to `VERDICT: APPROVED` (gating, on top of CI). Codex via MCP bypass mode, `cwd` `/mnt/d/repos/fountainrank`, repo-relative paths. `claude_help/codex-review-process.md`.
- Branch → PR → CI green + Codex APPROVED + every comment addressed → `gh pr merge --squash`. No AI attribution; no time estimates; Conventional Commits.

## Open backlog (unchanged, minus what shipped)
#18: Plans 1 (basemap) + 2 (web) DONE; **Plan 3 (mobile) pending.** Others still open: #167 (photos — likely verify+close), #43 (web filter chips), #11/#12/#10/#13 (moderation), #184 (trivyignore transitive), #182 (TS 6.0 — hold), #181 (Expo 57 — hold). See the prior handoff for the full table.
