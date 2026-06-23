# Handoff — Mobile Slice 6e-2 (app shell) MERGED (2026-06-23)

## TL;DR

**Slice 6e-2** — the **app shell** — is **planned (Codex Loop A APPROVED, 4 rounds), implemented (in-session TDD), CI-green, Codex Loop B APPROVED on the PR, all PR comments addressed, and squash-merged to `main`.**

- `main` HEAD = **`393ed3b`** — `feat(mobile): app shell — Expo Router + TanStack Query + release-safe API client (slice 6e-2) (#67)`.
- **No deploy applies.** Mobile **config/code only** — no DOKS deploy, no backend/web/DB/OpenAPI change, no EAS build (owner-gated). Per the umbrella spec §21 the proof level is **Local CI** and **merge-to-main IS the delivery for 6e-2.** (Deploy is manual `workflow_dispatch` anyway; N/A for mobile slices.)
- Post-merge **CI on `main`** + Security audit + CodeQL: green (push run `28040770883` and siblings).

**▶ NEXT (fresh session): plan slice 6e-3 (map + public discovery).** Per the umbrella spec §18 slice table. Same flow: write the slice **plan** (`docs/plans/`) → **Codex Loop A** → branch → implement (TDD) → CI green + **Codex Loop B** + all PR comments addressed → **squash-merge**. **6e-3 is the slice where the app stops running in Expo Go** — it installs `@maplibre/maplibre-react-native` + its Expo config plugin (CNG/prebuild), so the **actual map render is verifiable only on a dev-client / EAS build (owner-gated — no Mac → EAS).** Code + pure-helper tests are Claude-actionable to CI-green; the map-renders proof is owner-gated.

---

## The epic this belongs to (unchanged framing)

**Umbrella spec:** `docs/specs/2026-06-23-mobile-store-testing-distribution-design.md` (Codex APPROVED). 10 independently mergeable slices (6e-1 … 6e-10). Slice table = spec §18; native/store = §20; auth-unavailable mode + per-slice proof levels = §21; API contract + bundle-id honesty = §17; the no-`X-Dev-*` mandate = §14.

| Slice | Status |
|---|---|
| **6e-1** ✅ MERGED (#66) | Release config & app identity, eas.json, test runner. |
| **6e-2** ✅ MERGED (#67) | **App shell** (this handoff). |
| **6e-3** ◀ NEXT | Map + public discovery: **MapLibre RN** (config plugin + CNG/prebuild — Expo Go ends here), foreground-location (non-blocking when denied), Protomaps basemap, nearby/bbox pins, pin→detail nav, filters. Code+tests → CI-green; **map render owner-gated** (dev-client/EAS). |
| 6e-4 | Fountain detail + public reads. Claude → CI-green. |
| 6e-5 | Native auth (Logto) — ships behind auth-unavailable mode; e2e verify owner-gated. |
| 6e-6 | Existing-fountain contributions — code → CI-green; signed-in verify owner-gated. |
| 6e-7 | Add-fountain capture — code → CI-green; signed-in verify owner-gated. |
| 6e-8 | Store metadata + Expo/EAS account & credentials. **Owner-gated.** |
| 6e-9 | Auth/OAuth store alignment (Logto Native app, Google/Apple clients). **Owner-gated.** |
| 6e-10 | Functional device RC + first store-testing builds + on-device verification. **Owner-gated.** |

---

## What shipped in 6e-2 (every file)

All logic is in **pure, unit-tested modules** (`mobile/lib/*`, zero RN/Expo imports → run under Vitest `node` env). Route files / components / providers are the thin untested shell (covered by `tsc` + ESLint + `expo-doctor`). **38 unit tests** total.

**Navigation (Expo Router):**
- `mobile/package.json` — `main` → `expo-router/entry`; added deps `expo-router@~56.2.11`, `react-native-screens@4.25.2`, `react-native-safe-area-context@~5.7.0`, `expo-linking@~56.0.14`, `expo-status-bar@~56.0.4`, `@expo/vector-icons@^15.0.2`, **`expo-font@~56.0.7`** (required peer of vector-icons — found by expo-doctor), `@tanstack/react-query@5.101.0`.
- `mobile/app.config.ts` — added `plugins: ["expo-router"]`.
- `mobile/App.tsx` + `mobile/index.ts` **deleted** (replaced by `app/` tree + `expo-router/entry`).
- `mobile/app/_layout.tsx` — root: `SafeAreaProvider` + `QueryClientProvider` + `ApiProvider` + module-scope config guard (renders an invalid-config screen, `includeTopInset`) wrapping a **bare `<Stack screenOptions={{ headerShown: false }} />`** (no enumerated screens — Expo Router auto-registers; each pushed route sets its own header locally). `QueryClient` defaults: `retry: 1`, `refetchOnWindowFocus: false`.
- `mobile/app/(tabs)/_layout.tsx` — Tabs (Map · Add · Account) with Ionicons (`@expo/vector-icons`).
- `mobile/app/(tabs)/index.tsx` (Map scaffold → 6e-3), `add.tsx` (scaffold → 6e-7), `account.tsx` (public-read scaffold, reads `isAuthConfigured` → 6e-5).
- `mobile/app/fountains/[id].tsx` (Detail scaffold → 6e-4; local `<Stack.Screen options>` for its header), `mobile/app/+not-found.tsx`.
- `mobile/app/diagnostics.tsx` — the **one functional screen**: `GET /healthz` via TanStack Query + `QueryStateView` + version/build label. Proves config → client → query → view-state end-to-end.

**Pure helpers + tests:**
- `mobile/lib/config.ts` (+test) — added optional **`logtoAppId?`** (absent — no placeholder id) + **`isAuthConfigured(config)`** (auth-unavailable seam, §21). 16 tests.
- `mobile/lib/api.ts` (+test) — `buildAuthHeaders` (only `Authorization: Bearer`, never `X-Dev-*`); `ApiError`; `unwrap`; **`createApiClient` → `MobileApiClient` facade**. **The no-`X-Dev-*` contract (§14) is ENFORCED + NON-BYPASSABLE** via (1) a **sanitizing fetch** wrapping the configured fetch that strips any `x-dev*` header at the network boundary (after all middleware), and (2) a **narrowed facade** exposing only GET/POST/PUT/PATCH/DELETE and stripping the per-request `fetch`/`middleware` escape hatches (no `use`/`eject`). 13 tests, incl. boundary tests defeating generated-`params.header`, per-request-`middleware`, and per-request-`fetch`-override bypasses. 
- `mobile/lib/view-state.ts` (+test) — `resolveViewState` → `loading`/`offline`/`error`/`empty`/`ready` (offline = network failure with no HTTP status; error = `ApiError`). 6 tests.
- `mobile/lib/build-info.ts` — unchanged (reused by Diagnostics). 3 tests.

**Design system + components:**
- `mobile/theme.ts` — color/spacing/typography tokens (web brand palette).
- `mobile/components/ScreenContainer.tsx` (`includeTopInset` prop for headerless screens) + `mobile/components/states/{LoadingState,EmptyState,ErrorState,OfflineState,QueryStateView}.tsx`.
- `mobile/providers/api-provider.tsx` — `ApiProvider` + `useApi(): { config, client: MobileApiClient }`.

**Docs + security:**
- `mobile/README.md` — app-shell structure + commands. `docs/style-guide.md` — mobile component system (replaced the temporary 6e-1 diagnostics note).
- `.trivyignore` — **2 new justified suppressions** (see gotcha below).
- `docs/plans/2026-06-23-mobile-6e-2-app-shell.md` — the plan (Codex APPROVED).

**Codex review artifacts** (gitignored `temp/codex-reviews/`): `...-6e-2-app-shell-plan-review-{1..4}.md`, `pr-67-review-{1,2}.md`.

---

## 🔑 NEW GOTCHA — Trivy code-scanning false-positive on large mobile PRs (READ before the next mobile PR)

**Symptom:** the GitHub **`Trivy`** check (the code-scanning *diff* check, distinct from the `trivy-fs` job) fails on a mobile PR citing "**N new alerts in code changed by this pull request**" + "**2 configurations not found** (`trivy-image-backend`, `trivy-image-web`)", even though the changed code is mobile-only.

**Cause (structural, not your code):** `image-scan` in `.github/workflows/security-audit.yml` is `if: github.event_name != 'pull_request'` — it **deliberately skips on PRs** (image builds are heavy). So the `trivy-image-*` SARIF categories present on `main` are missing on the PR → GitHub code-scanning can't compute a clean baseline → combined with a **large `pnpm-lock.yaml` diff** it over-reports **pre-existing** transitive-dep / infra alerts as "new" (its own summary admits "code changes were too large").

**How to diagnose:** `gh api repos/redducklabs/fountainrank/check-runs/<id>/annotations` lists the exact flagged alerts. Then prove pre-existing: `git show origin/main:pnpm-lock.yaml | grep -c "<pkg>@<ver>"` equals the branch count. The repo's **gating** scanners (`pnpm-audit` gates high/critical, `trivy-fs` secret gate, CodeQL) still pass; `main` has **no branch protection**, so `Trivy` doesn't hard-block — but CLAUDE.md forbids merging red.

**Resolution used here (owner-approved):** added `CVE-2026-41907` (uuid@7.0.3 — build-time only via `expo → @expo/config-plugins → xcode@3.0.1`; uuid 11+ fix breaks xcode, can't force) and `CVE-2026-41305` (postcss@8.4.31 — build-time web tooling) to `.trivyignore` with justification + revisit condition (the sanctioned mechanism). On the next push the `Trivy` check went **`fail` → `skipping`/neutral** (no new alerts). **If a future mobile PR hits this: confirm the flagged alerts are pre-existing + build-time-only, then either suppress in `.trivyignore` (justified) or, better long-term, fix the `image-scan`-skips-on-PR baseline gap in the workflow.**

---

## Standing constraints carried forward — every future mobile slice must respect these

1. **Bundle/scheme `com.redducklabs.fountainrank` is the PROPOSED default, NOT owner-confirmed.** 6e-2 created **no** external record. Get explicit owner thumbs-up before any Apple/Play/Logto/Google record (§17).
2. **Auth-unavailable mode (§21).** `logtoAppId?` stays **absent** (no placeholder); `isAuthConfigured` is the seam (returns false). Signed-in actions hidden/disabled; PR/handoff wording for 6e-5…6e-7 limited to "compiled + unit-tested only" until the on-device callback round-trip.
3. **No dev-auth seam on mobile, ever (§14).** 6e-2's `createApiClient` now **enforces** this (sanitizing fetch + facade). 6e-5's Logto token middleware must use `buildAuthHeaders` and never emit `X-Dev-*`.
4. **HTTPS-only** (no ATS exception / no Android cleartext). **No token/PII logging.**
5. **MapLibre native dep + Expo Go end in 6e-3** (not earlier). Map render verified only on a dev-client/EAS build (owner-gated).
6. **API contract is method-accurate** vs `packages/api-client/src/schema.d.ts` — paths are under `/api/v1/...` (e.g. `GET /api/v1/me`, `POST /api/v1/fountains`); reads GET, writes POST; notes list/create only. Don't invent endpoints.
7. **No Mac → EAS free tier for iOS;** owner has Apple Developer + Google Play but **no Expo/EAS account yet** (free; re-verify quota at 6e-10).
8. **Versioning:** `version 0.1.0`, `ios.buildNumber "1"`, `android.versionCode 1`, `runtimeVersion appVersion`; `eas.json appVersionSource: "local"` (→ `"remote"` at 6e-8).
9. **Mobile stack is now fixed:** **Expo Router** (file-based `app/`) + **TanStack Query** + the `MobileApiClient` facade. Pure helpers in `mobile/lib/` (Vitest node env, zero RN imports); screens/components/providers are the untested shell.

---

## Current state (verified 2026-06-23)

- `main` HEAD = **`393ed3b`** (PR #67, mergeCommit `393ed3b2c9956af4efd18bc9ecac4668a93b37c0`, merged 2026-06-23T16:28Z). Local `main` == `origin/main`. Branch `feat/mobile-6e-2-app-shell` deleted local + remote.
- PR #67 CI **green** (all checks pass or neutral/skipping; `Trivy` neutral after the suppression). Codex Loop B `VERDICT: APPROVED` (round 2). Only PR comment was Codex's (updated to approval) — no Copilot/Dependabot/human threads.
- Post-merge `main` CI + Security audit + CodeQL running/green (push `28040770883`).
- **No deployment** (mobile config/code only) — expected, not a missing step.
- Working tree: clean except the untracked conversation-export `.txt` at repo root (safe to delete) + a stale `worktree-landing-page` worktree and old `feat/*` local branches from prior slices (not related to 6e-2).

---

## Gotchas (mobile-specific — also see the NEW Trivy gotcha above)

- **pnpm store goes dirty after EVERY Codex (WSL) run.** Recover with a clean reinstall (NOT a wait): `rm -rf node_modules web/node_modules mobile/node_modules packages/*/node_modules && CI=true pnpm install`. Do this before any local check that follows a Codex run.
- **Adding a mobile dep:** `CI=true pnpm install --no-frozen-lockfile`, commit the updated `pnpm-lock.yaml` same task. **expo-doctor enforces peer deps** — e.g. `@expo/vector-icons` requires `expo-font` (6e-2 had to add it). Use SDK-correct versions from `node_modules/.pnpm/expo@*/node_modules/expo/bundledNativeModules.json`.
- **Scoped mobile checks run `generate` first** (needs backend `uv`). If a scoped check fails *inside generate*, run `uv sync` in `backend/`.
- **The mobile check does NOT run Prettier.** Format touched `mobile/**` before the full `./run.ps1 check`; format `docs/**` explicitly (outside the format:check glob). **Prettier mangles wrapped lines starting with `+ ` in markdown** (reads them as list bullets) — keep such phrases on one line.
- **git add is atomic:** a non-matching pathspec (e.g. an already-`git rm`'d file) aborts the whole `git add`, silently leaving other files unstaged → an incomplete commit. Stage only existing paths.
- **Windows backslash file-tool paths; Git Bash forward slashes; run.ps1 via `powershell.exe -NoProfile -ExecutionPolicy Bypass -File run.ps1`.** Codex paths repo-relative; MCP `cwd` derived `/mnt/d/repos/fountainrank`.
- **No AI attribution; no time estimates; Conventional Commits; squash-merge only.**

---

## Resume commands (copy-paste)

```bash
# ground state — expect HEAD = 393ed3b, clean tree
git -C /d/repos/fountainrank log --oneline -3 origin/main
git -C /d/repos/fountainrank status --short

# recover the pnpm store FIRST if a Codex run just ran:
rm -rf node_modules web/node_modules mobile/node_modules packages/*/node_modules && CI=true pnpm install

# local CI mirror:
powershell.exe -NoProfile -ExecutionPolicy Bypass -File run.ps1 check            # full
powershell.exe -NoProfile -ExecutionPolicy Bypass -File run.ps1 check -Mobile     # mobile only (lint+typecheck+vitest+expo-doctor)
pnpm --filter mobile exec vitest run lib/api.test.ts                              # a single mobile test file
```

## Key artifacts

- **Umbrella spec (APPROVED):** `docs/specs/2026-06-23-mobile-store-testing-distribution-design.md` — §14 no-X-Dev, §17 contract/bundle-id, §18 slice table, §20 native config, §21 auth-unavailable + proof levels.
- **6e-2 plan (APPROVED):** `docs/plans/2026-06-23-mobile-6e-2-app-shell.md`.
- **Architecture mandate for the map stack (6e-3):** `docs/specs/2026-06-16-architecture-and-foundation-design.md` (MapLibre RN) + `docs/design/architecture.md`.
- **Mobile workspace:** `mobile/` (Expo Router `app/`, `lib/` pure helpers, `components/`, `providers/`, `theme.ts`).
- **Process:** `claude_help/development-process.md`, `claude_help/testing-ci.md`, `claude_help/codex-review-process.md`.
- **Prior handoff:** `handoffs/2026-06-23-slice-6e-1-mobile-release-config-merged-handoff.md`.
