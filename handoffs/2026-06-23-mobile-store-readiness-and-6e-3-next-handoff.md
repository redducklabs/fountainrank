# Handoff — Mobile store-readiness + EAS linked; NEXT = slice 6e-3 (map) (2026-06-23)

> **This supersedes** `handoffs/2026-06-23-slice-6e-2-app-shell-merged-handoff.md` as the resume point. It folds in everything that happened after 6e-2 merged: bundle-id confirmation, EAS project linkage, the store-readiness runbook, the screenshots decision, and new gotchas.

## TL;DR — what to do next

1. **Immediate next action: build slice 6e-3 (map + public discovery).** This is the headline screenshot screen and the agreed unblocker for store screenshots (owner chose *"build real screens first, then capture"*). Flow: write `docs/plans/2026-06-23-mobile-6e-3-*.md` → **Codex Loop A** → branch → implement (TDD) → CI green + **Codex Loop B** + comments addressed → squash-merge.
2. **Two pending owner inputs before/at 6e-3 kickoff:**
   - **Owner "go"** to start 6e-3 (they've endorsed the strategy; just confirm).
   - **App icon source:** owner has been asked *"do you have a FountainRank logo (PNG/SVG), or should I generate a simple branded one (`#0A357E`/`#F2C200`)?"* — **awaiting their answer.** Fold the real icon into 6e-3 so screenshots don't show the default Expo icon.
3. **6e-3 ends Expo Go.** It installs `@maplibre/maplibre-react-native` + its Expo config plugin and forces **CNG/prebuild**. The map **render is verifiable only on a dev-client/EAS build (owner-gated — no Mac → EAS)**; code + pure-helper tests are Claude-actionable to CI-green.
4. **Before any `expo prebuild` / `eas` command, do a CLEAN reinstall** (see Gotchas) — incremental Expo dep installs break config-plugin resolution under pnpm.

`main` HEAD = **`5bfed24`** — `build(mobile): link EAS project ... (#68)`.

---

## Current state (verified 2026-06-23)

**Merged to `main` this session:**
- **PR #67** (`393ed3b`) — **slice 6e-2 app shell** (Expo Router + TanStack Query + release-safe `MobileApiClient` API client + design system + diagnostics). 38 unit tests. Plan: `docs/plans/2026-06-23-mobile-6e-2-app-shell.md`.
- **PR #68** (`5bfed24`) — **EAS project linkage** in `mobile/app.config.ts` (`owner: "red-duck-labs"` + `extra.eas.projectId`). Slice 6e-8 prep.
- Handoff commit `7382827` (the 6e-2 handoff).

Local `main` == `origin/main` (HEAD `5bfed24`). Post-merge `main` CI + Security audit + CodeQL: green. Working tree clean except an untracked conversation-export `.txt` at repo root (safe to ignore) + stale local `feat/*` branches and a `worktree-landing-page` worktree from older slices (unrelated).

**Owner-side setup completed this session:**
- ✅ **Expo account + org** `red-duck-labs` created; **EAS project `fountainrank`** created + linked via `eas init`.
  - **EAS project ID:** `820564bf-5f29-44c7-8ec7-edde67b77360`
  - **Owner/org slug:** `red-duck-labs`
  - **Project URL:** https://expo.dev/accounts/red-duck-labs/projects/fountainrank
  - Both values are **public (non-secret)** and already committed in `app.config.ts` — do NOT re-add them.
- ✅ **Bundle id `com.redducklabs.fountainrank` is OWNER-CONFIRMED** (lifts the spec §17 "proposed, not confirmed" gate — external records may now be created with this identity). Memory: `fountainrank-bundle-id-confirmed`.

---

## The mobile stack (what 6e-2 established — build 6e-3 on top of this)

- **Navigation:** **Expo Router** (file-based `mobile/app/` tree, entry `expo-router/entry`). Root `app/_layout.tsx` = `SafeAreaProvider` + `QueryClientProvider` + `ApiProvider` + a module-scope **config guard** (invalid-config screen) wrapping a **bare `<Stack screenOptions={{ headerShown: false }} />`** (no enumerated screens — each pushed route sets its own header via a local `<Stack.Screen options>`). Tabs in `app/(tabs)/` (Map · Add · Account, Ionicons); pushed routes `app/fountains/[id].tsx`, `app/diagnostics.tsx`, `app/+not-found.tsx`.
- **Server state:** **TanStack Query** (`@tanstack/react-query@5.101.0`). The one functional screen today is `app/diagnostics.tsx` (`GET /healthz`).
- **API client:** `mobile/lib/api.ts` → **`createApiClient(baseUrl, options?) → MobileApiClient`** (a `Pick<ApiClient,"GET"|"POST"|"PUT"|"PATCH"|"DELETE">` facade). The **no-`X-Dev-*` dev-auth contract (spec §14) is ENFORCED + NON-BYPASSABLE** via (1) a sanitizing fetch that strips any `x-dev*` header at the network boundary and (2) the facade stripping per-request `fetch`/`middleware` (no `use`/`eject`). Use `createApiClient` for all requests; `buildAuthHeaders(token)` (only `Authorization: Bearer`) is the seam 6e-5 will wire to Logto. `unwrap(result)` → data or throws `ApiError(status)`.
- **View states:** pure `resolveViewState` (`lib/view-state.ts`) → `loading`/`offline`/`error`/`empty`/`ready` (offline = network error w/ no HTTP status; error = `ApiError`), rendered by `components/states/QueryStateView.tsx` + `LoadingState`/`EmptyState`/`ErrorState`/`OfflineState`.
- **Auth-unavailable seam (§21):** `MobileConfig.logtoAppId?` (absent — no placeholder) + `isAuthConfigured(config)` (false now). Account screen shows a public-read state. 6e-5 consumes it; 6e-9 populates the real id.
- **Design system:** `mobile/theme.ts` (brand `#0A357E`/`#F2C200`) + `ScreenContainer` (`includeTopInset` for headerless screens). Documented in `docs/style-guide.md` → *Mobile (React Native)*.
- **Testing:** pure helpers in `mobile/lib/*` (Vitest **node** env, **zero RN/Expo imports**); route files/components/providers are the untested shell (covered by `tsc` + ESLint + `expo-doctor`). Run: `./run.ps1 check -Mobile`.

---

## NEXT: slice 6e-3 — map + public discovery (the screenshot screen)

Per spec §15 Phase 3 + §18 + §20. Scope:
1. **MapLibre RN map** — install `@maplibre/maplibre-react-native` (pin the version; record Android min/compile/target SDK + iOS deployment target) **+ its Expo config plugin** → this forces **CNG/prebuild** (`npx expo prebuild` generates `ios/`/`android/`; **keep those out of git**). **The app stops running in Expo Go from here.** Render the same **Protomaps basemap** the web uses (go-pmtiles tile server).
2. **Foreground-only location** permission — non-blocking when denied (iOS `NSLocationWhenInUseUsageDescription` + Android `ACCESS_FINE/COARSE_LOCATION` are already in `app.config.ts` from 6e-1). No background location.
3. **Fountain pins** from production-compatible **bbox/nearby** API calls (`GET /api/v1/fountains` nearby `lat`/`lng`/`radius_m` + filters, `GET /api/v1/fountains/bbox`) via `createApiClient` + TanStack Query; pin states working/broken/degraded/rated where the API exposes them.
4. **Pin → detail nav** (to `app/fountains/[id]`), and **filters** backed by existing API params.
5. **Real app icon** (folded in here): `mobile/assets/` icon + splash referenced from `app.config.ts` (`icon`, `splash`/`expo-splash-screen`). **Awaiting owner: logo vs generate.**

**Proof level (spec §21):** Local CI (type-check + lint + `expo-doctor` + pure-helper tests). The **actual map render is owner-gated** — verified on a dev-client/EAS build, NOT in CI. PR/handoff wording must not claim the map "renders" until observed on a device. Keep pure logic (filter param builders, pin-state mappers, bbox math) in `mobile/lib/*` with tests; the map component is the untested shell.

**Architecture mandate:** MapLibre RN is settled (`docs/specs/2026-06-16-architecture-and-foundation-design.md` "Mobile" + Maps row; `docs/design/architecture.md`). Don't reopen it. Then **6e-4** (fountain detail public reads) is the second screenshot screen.

---

## Store-readiness runbook (owner track — runs in parallel to my slice work)

**None of this blocks screenshots; the real screens (6e-3/6e-4) do.** Status + what's left:

| Item | Status | Notes |
|---|---|---|
| Bundle id | ✅ confirmed | `com.redducklabs.fountainrank` everywhere (Expo, Apple, Play, Logto, Google OAuth). Don't change after records exist. |
| Expo org + EAS project | ✅ done | `red-duck-labs/fountainrank`, projectId committed. |
| `eas.json` build/submit profiles | ✅ exist (6e-1) | `appVersionSource: "local"` for now → flip to `"remote"` at actual-build time (6e-8/6e-10). |
| Apple App ID + App Store Connect record | ⬜ to-do | **EAS auto-creates both at the first iOS build** (owner logs into Apple) — manual creation optional. Apple Developer Program already held. |
| Apple Sign-in artifacts (Services ID, Key ID, Team ID, `.p8`) | ⬜ to-do (6e-9) | Secret; owner sets in **Logto**. Per `docs/setup/04-apple-and-app-stores.md`. |
| Google Play app + Play App Signing → **SHA-1** | ⬜ to-do | SHA-1 feeds the **Android** Google OAuth client (sign-in, 6e-9) — **NOT needed for screenshots**. New *personal* Play accounts need closed testing (~12–20 testers, 14 days) before production. |
| Google Play service-account JSON | ⬜ to-do | Secret; for EAS Submit. Owner provides at submit time. |
| Logto Native app + redirect `com.redducklabs.fountainrank://callback` | ⬜ to-do (6e-9) | Owner-gated; Claude sets the public mobile Logto values once it exists. |
| Store listing (icon, feature graphic, ≥2 screenshots, descriptions, privacy/data-safety) | ⬜ blocked on screens | The screenshot gate; see below. |

**What stays secret (never in repo):** Apple `.p8` keys, App Store Connect API key, Google Play service-account JSON, EAS access tokens. **What you hand me (non-secret):** bundle id (done), EAS owner/projectId (done), the Play SHA-1 when it exists, the Logto Native app id once created.

---

## Screenshots — the decision and the path

**Owner decision (this session): "Build real screens first, then capture."** Blocking: **both Google Play AND Apple App Store** listings.

- **You can't screenshot today's build** — it's a scaffold (placeholder screens + default Expo icon). Real screenshots need the screens (6e-3 map, 6e-4 detail) + the real icon.
- **Where screenshots are actually required:** Play **Main store listing** (icon + 1024×500 feature graphic + ≥2 phone screenshots); App Store **at submission** (per device class). **Not** for account/app-record creation, and **not** for TestFlight internal.
- **Capture paths once 6e-3/6e-4 exist:**
  - **Android:** run on a **local Windows emulator** (Android Studio, free) — **no EAS, no accounts needed**. Easiest; satisfies Play's phone screenshots.
  - **iOS (no Mac):** **EAS build → TestFlight → owner's iPhone**, screenshot on-device (needs the Expo + Apple accounts; Expo is done). Or framed mockups at Apple's resolutions as a fallback.

---

## Standing constraints — every future mobile slice must respect these

1. **Bundle id `com.redducklabs.fountainrank` is owner-confirmed** — external records (Apple/Play/Logto/Google) may now be created with it; never change it after they exist (breaks sign-in). (§7/§17.)
2. **Auth-unavailable mode (§21):** `logtoAppId?` stays absent (no placeholder); `isAuthConfigured` gates signed-in UI. 6e-5…6e-7 wording limited to "compiled + unit-tested only" until the on-device callback round-trip.
3. **No dev-auth seam, ever (§14):** mobile authenticates only with `Authorization: Bearer`; `createApiClient` enforces the no-`X-Dev-*` invariant — keep using it. 6e-5's Logto token middleware uses `buildAuthHeaders`.
4. **HTTPS-only** (no ATS exception / no Android cleartext). **No token/PII logging.**
5. **MapLibre + Expo Go end in 6e-3.** Native folders (`ios/`/`android/`) stay out of git unless an explicitly reviewed slice commits a prebuilt project. Map render verified only on dev-client/EAS (owner-gated).
6. **API contract is method-accurate** vs `packages/api-client/src/schema.d.ts` — paths under `/api/v1/...`; reads GET, writes POST; notes list/create only. Don't invent endpoints. Reads: `/api/v1/fountains` (nearby), `/fountains/bbox`, `/fountains/{id}`, `/fountains/{id}/notes`, `/rating-types`, `/attribute-types`, `/me`, `/me/contributions`, `/me/badges`, `/leaderboard/contributors`. Writes: `/fountains` (409 dup), `/fountains/{id}/ratings|attributes|conditions|notes`, `/me/sync`.
7. **No Mac → EAS** (free tier; re-verify quota at 6e-10). EAS project now linked.
8. **Versioning:** `version 0.1.0`, `ios.buildNumber "1"`, `android.versionCode 1`, `runtimeVersion appVersion`; `eas.json appVersionSource: "local"` (→ `"remote"` at 6e-8).
9. **Process:** branch → PR → CI green + Codex `VERDICT: APPROVED` + every PR comment addressed → **squash-merge**. **Codex Loop A** on every plan, **Loop B** on every PR (bypass mode; cwd `/mnt/d/repos/fountainrank`; repo-relative paths). No AI attribution; no time estimates; Conventional Commits. Handoff docs commit **directly to main** (not via PR).

---

## Gotchas (read before local mobile work)

- **🔑 CLEAN reinstall before `expo prebuild` / `eas` commands.** Incremental Expo dep installs (`pnpm install --no-frozen-lockfile`, used when adding mobile deps) leave the expo-router config plugin's `@expo/*` symlinks inconsistent under pnpm → `eas init`/`expo prebuild`/`expo config` fail with *"Unable to resolve a valid config plugin for expo-router → Cannot find module '@expo/schema-utils'"*, even though `expo-doctor`/typecheck pass and Expo Go works. **Fix:** `rm -rf node_modules web/node_modules mobile/node_modules packages/*/node_modules && CI=true pnpm install`. Verify with `pnpm --filter mobile exec expo config --type prebuild` (exit 0; resolved `plugins` == `["expo-router"]`). CI/EAS do clean installs so they're unaffected. **This WILL bite at 6e-3** (adding MapLibre + prebuild). Memory: `fountainrank-mobile-clean-reinstall-before-eas-prebuild`.
- **🔑 Trivy false-positive on large mobile PRs.** A big `pnpm-lock.yaml` diff trips the GitHub **`Trivy`** code-scanning *diff* check ("N new alerts" + "2 configurations not found: trivy-image-backend/web") because `image-scan` is `if: github.event_name != 'pull_request'` (skips on PRs), breaking the baseline. The flagged alerts are **pre-existing** (verify: `git show origin/main:pnpm-lock.yaml | grep -c "<pkg>@<ver>"` matches). Resolved for #67 by adding `CVE-2026-41907` (uuid) + `CVE-2026-41305` (postcss) to `.trivyignore` with justification + revisit (the sanctioned mechanism); the check then goes `fail`→`skipping`. Memory: `fountainrank-trivy-false-positive-large-mobile-prs`.
- **pnpm store goes dirty after every Codex (WSL) run** → same clean-reinstall remedy before the next local check.
- **Adding a mobile dep:** `CI=true pnpm install --no-frozen-lockfile`, commit `pnpm-lock.yaml` same task. **expo-doctor enforces peer deps** (e.g. `@expo/vector-icons` needed `expo-font`). Use SDK-correct versions from `node_modules/.pnpm/expo@*/node_modules/expo/bundledNativeModules.json`.
- **The mobile check does NOT run Prettier.** Format touched `mobile/**` before the full `./run.ps1 check`; format `docs/**`/`handoffs/**` explicitly (outside the `{web,mobile,packages}/**` format:check glob). **Prettier reads a wrapped line starting with `+ ` as a markdown bullet** — keep such phrases on one line.
- **`git add` is atomic:** a non-matching pathspec (e.g. an already-`git rm`'d file) aborts the whole `git add`, silently leaving an incomplete commit. Stage only existing paths; verify with `git show --stat HEAD`.
- **Scoped mobile checks run `generate` first** (needs backend `uv`); if a scoped check fails *inside generate*, `uv sync` in `backend/`.
- **Windows backslash file-tool paths; Git Bash forward slashes; run.ps1 via `powershell.exe -NoProfile -ExecutionPolicy Bypass -File run.ps1 <args>`.** Commands run **from the repo root** (repo-relative, no hardcoded absolute root). Codex MCP `cwd` = `/mnt/d/repos/fountainrank` (derived).

---

## Resume commands

```bash
# ground state — expect HEAD = 5bfed24, clean tree
git -C /d/repos/fountainrank log --oneline -4 origin/main
git -C /d/repos/fountainrank status --short

# CLEAN reinstall (do this before any prebuild/eas command, and after any Codex run):
rm -rf node_modules web/node_modules mobile/node_modules packages/*/node_modules && CI=true pnpm install

# local CI mirror:
powershell.exe -NoProfile -ExecutionPolicy Bypass -File run.ps1 check            # full (backend + workspace-js + web build + mobile)
powershell.exe -NoProfile -ExecutionPolicy Bypass -File run.ps1 check -Mobile     # mobile only
pnpm --filter mobile exec expo config --type prebuild                            # verify config plugins resolve (exit 0)

# owner's EAS (their account, red-duck-labs): from mobile/, `eas build` / `eas submit` now resolve the linked project.
```

## Key artifacts & pointers

- **Umbrella spec (APPROVED):** `docs/specs/2026-06-23-mobile-store-testing-distribution-design.md` — §8 runtime config, §10/§11 Apple/Play, §12 OAuth/Logto, §13 store-listing minimums (screenshots), §14 no-`X-Dev-*`, §17 contract/bundle-id, §18 slice table, §20 native config, §21 auth-unavailable + proof levels.
- **6e-2 plan (APPROVED):** `docs/plans/2026-06-23-mobile-6e-2-app-shell.md`. **Architecture (map stack):** `docs/specs/2026-06-16-architecture-and-foundation-design.md` + `docs/design/architecture.md`.
- **Owner setup runbook:** `docs/setup/README.md` + `04-apple-and-app-stores.md` + `03-google-cloud.md` (Play SHA-1 → Android OAuth) + `06-logto.md`.
- **Process:** `claude_help/development-process.md`, `testing-ci.md`, `codex-review-process.md`, `github-cli.md`.
- **Prior handoffs:** `handoffs/2026-06-23-slice-6e-2-app-shell-merged-handoff.md` (6e-2 file-by-file detail), `2026-06-23-slice-6e-1-mobile-release-config-merged-handoff.md`.
- **Memories (auto-load):** `fountainrank-bundle-id-confirmed`, `fountainrank-mobile-clean-reinstall-before-eas-prebuild`, `fountainrank-trivy-false-positive-large-mobile-prs`, `fountainrank-deploy-is-manual-dispatch`.
- **Slice table (epic):** 6e-1 ✅(#66) · 6e-2 ✅(#67) · **6e-3 ◀ NEXT** · 6e-4 · 6e-5 auth · 6e-6 contribs · 6e-7 add-fountain · 6e-8 store meta+EAS creds (EAS project ✅ done) · 6e-9 auth/OAuth records · 6e-10 device RC + store builds.
