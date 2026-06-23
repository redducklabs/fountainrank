# Handoff — Mobile slice 6e-4 (fountain detail + public reads) merged; NEXT = 6e-5 (native auth) (2026-06-23)

> **This supersedes** `handoffs/2026-06-23-slice-6e-3-map-merged-handoff.md` as the resume point. 6e-4 (the read-only fountain detail screen + public reads) is merged. The next slice is **6e-5 (native auth — Logto RN/Expo)**.

## TL;DR — what to do next

1. **Immediate next action: build slice 6e-5 (native auth).** Flow: write `docs/plans/2026-06-23-mobile-6e-5-*.md` → **Codex Loop A** → branch → implement (TDD) → CI green + **Codex Loop B** + comments addressed → squash-merge. 6e-5 adds **Logto React Native / Expo auth** (native browser auth-code + **PKCE**, the configured custom-scheme callback), SDK-native secure token storage, access tokens for audience `https://api.fountainrank.com`, sign-in/callback/sign-out/account-state, and verifies `GET /api/v1/me` against production auth/backend. **🔑 The Logto Native App registration ALREADY EXISTS** (owner-confirmed 2026-06-23: a "Native App" of type Native sits alongside the M2M and Traditional-Web apps in the Logto console; its public-client App ID is held by the owner / in local agent memory `fountainrank-logto-native-app`, **not** committed to this public repo — see that memory + the §"Facts for 6e-5" bullet below). So 6e-5 is **not** blocked on creating the registration. What 6e-5 still needs: (a) confirm the redirect URI `com.redducklabs.fountainrank://callback` is set on that Native App; (b) the App ID supplied at build via env (e.g. `EXPO_PUBLIC_LOGTO_APP_ID`, per the `docs/setup/06-logto.md` "app IDs are GitHub Env **variables**" convention — or the owner may opt to hardcode it as an `app.config.ts` default like `basemapStyleUrl`); (c) **on-device proof** — Claude takes the _code_ to Local CI, but "functional auth" needs a device round-trip. Read `claude_help/oauth-sso.md` (external-registrations checklist) + `docs/setup/06-logto.md` BEFORE starting.
2. **6e-4 is Claude-actionable to CI-green and is DONE there** (no auth, no native-only deps → topped out at **Local CI**, as planned). The detail screen's on-device _render_ is **not** claimed — like the 6e-3 map, the first owner-gated dev-client/EAS build is the visual proof. Do not claim the detail screen "renders/works on device" until observed.
3. **The app still does not run in Expo Go** (6e-3's MapLibre native dep ended Expo Go). 6e-4 added **no** native deps, so the dev-client/EAS situation is unchanged. Generated `mobile/ios/` + `mobile/android/` remain git-ignored.

**Latest `main`:** this handoff doc sits on top of `b474e02` — `feat(mobile): fountain detail + public reads (slice 6e-4) (#70)`. So `git log` shows the handoff commit first, then `b474e02`.

---

## Current state (verified 2026-06-23)

**Merged to `main` this session:**

- **PR #70** (`b474e02`) — **slice 6e-4 fountain detail + public reads**. Plan: `docs/plans/2026-06-23-mobile-6e-4-fountain-detail-and-public-reads.md` (Codex-approved, Loop A round 2). **121 mobile unit tests across 11 `mobile/lib` test files** (was 67/7 in 6e-3; +54: `format.test.ts` 41, `detail/attributes.test.ts` 2, `detail/notes.test.ts` 3, `detail/id.test.ts` 6, `api.test.ts` +2). CI green; Codex PR review `VERDICT: APPROVED` (round 2, after fixing one [MAJOR]). Squash-merged.

Local `main` == `origin/main`, tree clean (top commits: this handoff doc, then `b474e02` #70).

**What 6e-4 shipped (build 6e-5 on top of this):**

- **Pure, unit-tested helpers** (zero RN/Expo imports, Vitest node), mirroring the merged web detail:
  - `mobile/lib/map/format.ts` — extended from the 6e-3 `formatPill`-only file with the full web `format.ts` detail formatters: `formatAverage`, `formatVotes`, `formatDimension`, `formatDate`, `statusDisplay`/`StatusTone`/`StatusDisplay`, `formatDateFull`, `formatRelativeTime`, `attributeValueLabel`, `attributeDisplay`/`AttrTone`/`AttributeDisplay`, `formatCategory`. (`conditionStatusLabel` intentionally NOT ported — it's write-side, → 6e-6.)
  - `mobile/lib/detail/attributes.ts` — `groupAttributes(attrs)` (first-seen category order; extracted from web's inline grouping so it's testable).
  - `mobile/lib/detail/notes.ts` — `isNoteEdited(note)` (`updated_at > created_at`; clock-skew = not-edited).
  - `mobile/lib/detail/id.ts` — `normalizeFountainId(value)` → returns a canonical-UUID string or `null` (rejects absent/array/empty/**malformed non-UUID**). **Added in the Loop B fix** (see below).
  - `mobile/lib/api.ts` — `apiErrorStatus(error): number | null` (precise `instanceof ApiError` status reader; complements the structural `resolveViewState`).
- **Thin RN shell** (untested — `tsc`/ESLint/`expo-doctor` only):
  - `components/fountain/StatusBlock.tsx` — toned status chip (ok/warn/bad) + advisory + last-verified line (full date in an `accessibilityLabel`, since RN has no hover title).
  - `components/fountain/AttributeList.tsx` — grouped consensus rows.
  - `components/fountain/NotesList.tsx` — community-note cards.
  - `components/fountain/FountainDetail.tsx` — the composed read-only body (rating summary, dimensions, placement, adder comments, notes-or-error-row, footer, brand-yellow **Directions** via `Linking` + `Alert` on failure).
  - `app/fountains/[id].tsx` — replaced the placeholder: two **public** `useQuery` reads (`/api/v1/fountains/{fountain_id}` + `/notes`), detail gated by `QueryStateView`, invalid-id/404 → non-retryable "Fountain not found", notes best-effort but **not silent** (a notes failure shows a retry row), pull-to-refresh, map context preserved via the stack push.
- **Style guide:** `docs/style-guide.md` `## Mobile (React Native)` gained a "Fountain detail (slice 6e-4)" subsection.
- **No new dependency, no config plugin, no CNG change.** Pure TypeScript/React on the 6e-3 stack.

**Codex Loop B fix (the one [MAJOR]):** the first detail-screen draft rejected only absent/empty/array ids, so a malformed non-UUID deep link (`/fountains/not-a-uuid`) ran the queries → backend `uuid.UUID` route param 422 → generic _retryable_ error instead of the honest non-retryable not-found state. Fixed by `normalizeFountainId` (UUID validation client-side) so malformed ids take the same not-found path as missing ones — no wasted reads. Tested in `lib/detail/id.test.ts`.

---

## 🔑 Facts for 6e-5 (native auth) — saves the next agent a research loop

- **The mobile API client is auth-ready by design.** `mobile/lib/api.ts` `createApiClient(baseUrl, options?)` already: (1) wraps fetch with a **sanitizer that deletes any `x-dev*` header** before the network call (dev-auth seam structurally impossible — §14), and (2) exposes a **narrowed facade** (GET/POST/PUT/PATCH/DELETE only; no `use`/`eject`). `buildAuthHeaders(token)` returns `{ Authorization: "Bearer <token>" }` (or `{}`) and **cannot** emit `X-Dev-*`. 6e-5 extends this factory with a **Logto token-provider path** using `buildAuthHeaders`, keeping the sanitizer. Wire the token via openapi-fetch middleware (the facade hides `use`/`eject` from callers, but the factory itself can add middleware internally) OR a per-request header — **do not** expose a raw `makeClient`.
- **`isAuthConfigured`/`logtoAppId?`** already exist in `mobile/lib/config.ts` (optional, auth-unavailable mode, spec §21). 6e-5 flips the app from auth-unavailable to auth-available; gate signed-in UI on `isAuthConfigured`.
- **Audience** is `https://api.fountainrank.com`; backend validates Logto-issued JWTs via JWKS (verify `iss`/`aud`) — never self-mint symmetric tokens. **Never log tokens/full JWTs** (§20).
- **Logto Native App registration EXISTS (owner-confirmed 2026-06-23).** Type **Native**, a **public client (no secret)**; its App ID is held by the owner and stored in local agent memory `fountainrank-logto-native-app` (a public client id, but kept out of this **public** repo per the `docs/setup/06-logto.md` convention that Logto app IDs are GitHub Env **variables**, not committed source). Redirect URI must be `com.redducklabs.fountainrank://callback` (bundle id owner-confirmed — memory `fountainrank-bundle-id-confirmed`). **Remaining owner items for 6e-5:** (1) confirm that redirect URI is registered on the Native App; (2) hand the App ID to the build via env (`EXPO_PUBLIC_LOGTO_APP_ID`) or a committed `app.config.ts` default (owner's choice — non-secret); (3) the on-device round-trip. **Not a blocker on registration.** Track via `docs/setup/06-logto.md` + the `claude_help/oauth-sso.md` external-registrations checklist (spec §21: 6e-5 = Local CI as code → Owner-gated records + on-device for the auth/write claim). Note: the M2M App ID + secret and the Web App ID/secret are separate — the **M2M secret is a real secret** (backend config) and must never be committed.

---

## Standing constraints — every future mobile slice must respect these

1. **No dev-auth seam, ever (§14):** all API reads/writes go through `createApiClient` (`mobile/lib/api.ts`); never a raw `makeClient`; never an `X-Dev-*` header. 6e-4's reads are public (no `Authorization`). 6e-5 adds the Logto Bearer path.
2. **Proof-level honesty (§21):** PR/handoff wording bounded by the strongest proof reached. 6e-4 = **Local CI** (done). 6e-3's map render = **Native build** (owner-gated, still unverified). 6e-5 = **Local CI** as code, then **Owner-gated records + on-device** for the auth claim. Never claim a device behavior CI didn't prove.
3. **API contract is method-accurate** vs `packages/api-client/src/schema.d.ts`. 6e-4 used `GET /api/v1/fountains/{fountain_id}` (path key **`fountain_id`**, not `id`) → `FountainDetail`, and `/notes` → `NoteOut[]`. Detail display names come straight from the payload (`dimensions[].name`, `attributes[].name`/`.category`) — no `/rating-types`/`/attribute-types` calls needed.
4. **Mirror the web** where it exists, extracting non-trivial logic into pure unit-tested helpers and keeping the RN components a thin shell. 6e-5 mirrors `web/components/SignInButton.tsx`/`SignOutButton.tsx`/`AuthControl.tsx` + `web/app/account/page.tsx` patterns where applicable (web uses server-side Logto; mobile uses the native SDK — adapt, don't copy).
5. **MapLibre + Expo Go ended (6e-3).** Native folders stay out of git. Map/detail render verified only on dev-client/EAS (owner-gated). **No Mac → EAS** (free tier; re-verify quota at 6e-10). EAS project linked (`red-duck-labs/fountainrank`, projectId committed).
6. **Process:** branch → PR → CI green + Codex `VERDICT: APPROVED` + every PR comment addressed → **squash-merge**. Codex Loop A on every plan, Loop B on every PR (bypass mode: `sandbox: "danger-full-access"`, `approval-policy: "never"`; cwd `/mnt/d/repos/fountainrank` derived; repo-relative paths). No AI attribution; no time estimates; Conventional Commits. Handoffs commit **directly to main** (this repo's convention — see prior handoffs in `git log`).

---

## Gotchas (read before local mobile work)

- **🔑 Verify-the-exact-tree-you-commit (Codex Loop A finding this slice).** The mobile check does NOT run Prettier, so a check run before formatting verifies a tree you won't commit. Order every task: write code → `pnpm exec prettier --write` touched files → run the check → **commit with no edits in between**. Format `docs/**`/`handoffs/**` explicitly (outside the `{web,mobile,packages}/**` format:check glob).
- **`react/no-unescaped-entities` rejects a literal `'` in JSX text.** Put apostrophe strings in a JS expression container (`{"Community notes couldn't load."}`) rather than raw JSX text — satisfies lint without `&apos;`. (Bit this slice on the notes-error row.)
- **`generate` runs before scoped mobile checks** (needs backend `uv`); the regenerated `packages/api-client/src/schema.d.ts` is a **no-op diff** — confirmed again this slice (do NOT stage it).
- **`pnpm-audit` CI job is slow on the self-hosted runner** — took **~10m12s** this slice (not stuck; logs only appear on completion). Don't mistake it for a hang; everything else settles in ~3 min. Poll patiently before assuming failure.
- **🔑 CLEAN reinstall before any `expo prebuild`/`eas`/`expo config` command AND after every Codex (WSL) run.** `rm -rf node_modules web/node_modules mobile/node_modules packages/*/node_modules && CI=true pnpm install`. (Not needed for 6e-4 since it added no deps, but 6e-5 will add the Logto SDK → expect it.) Memory: `fountainrank-mobile-clean-reinstall-before-eas-prebuild`.
- **Adding a mobile dep (6e-5 will):** add to `mobile/package.json` with the SDK-correct version from `node_modules/.pnpm/expo@*/node_modules/expo/bundledNativeModules.json`, `CI=true pnpm install --no-frozen-lockfile`, commit `pnpm-lock.yaml` in the **same** task. Land a new `@types/*` dep in the same commit as the first code that references it.
- **Windows backslash file-tool paths; Git Bash forward slashes; run.ps1 via `powershell.exe -NoProfile -ExecutionPolicy Bypass -File run.ps1 <args>`.** Commands run from the repo root. Codex MCP `cwd` = `/mnt/d/repos/fountainrank` (derived).

---

## Resume commands

```bash
# ground state — expect the top commits to be this handoff doc + `... (#70)` (b474e02); clean tree
git -C /d/repos/fountainrank log --oneline -4 origin/main
git -C /d/repos/fountainrank status --short

# local CI mirror:
powershell.exe -NoProfile -ExecutionPolicy Bypass -File run.ps1 check            # full
powershell.exe -NoProfile -ExecutionPolicy Bypass -File run.ps1 check -Mobile     # mobile only (lint+typecheck+vitest+expo-doctor)
pnpm --filter mobile exec vitest run                                              # 121 tests across 11 files
```

## Key artifacts & pointers

- **6e-4 plan (APPROVED):** `docs/plans/2026-06-23-mobile-6e-4-fountain-detail-and-public-reads.md`. **Umbrella spec (APPROVED):** `docs/specs/2026-06-23-mobile-store-testing-distribution-design.md` (§15 Phase 5 = 6e-5 native auth; §18 slice table; §21 proof levels).
- **Web auth to mirror for 6e-5:** `web/components/SignInButton.tsx`, `SignOutButton.tsx`, `AuthControl.tsx`, `web/app/account/page.tsx`, `web/app/callback/`, and the backend auth (`backend/app/auth*`, JWKS validation). Mobile uses the Logto **native** SDK (auth-code + PKCE + custom scheme), not the web server flow — adapt.
- **Process:** `claude_help/development-process.md`, `testing-ci.md`, `codex-review-process.md`, `oauth-sso.md` (REQUIRED before 6e-5), `github-cli.md`. **Owner runbook:** `docs/setup/README.md` (Logto/OAuth records).
- **Prior handoffs:** `handoffs/2026-06-23-slice-6e-3-map-merged-handoff.md`, `2026-06-23-slice-6e-2-app-shell-merged-handoff.md`.
- **Memories (auto-load):** `fountainrank-bundle-id-confirmed`, `fountainrank-mobile-clean-reinstall-before-eas-prebuild`, `fountainrank-trivy-false-positive-large-mobile-prs`, `fountainrank-deploy-is-manual-dispatch`.
- **Slice table (epic):** 6e-1 ✅(#66) · 6e-2 ✅(#67) · 6e-3 ✅(#69) · 6e-4 ✅(#70) · **6e-5 ◀ NEXT** (native auth) · 6e-6 contribs · 6e-7 add-fountain · 6e-8 store meta+icon/splash (EAS project ✅) · 6e-9 auth/OAuth records · 6e-10 device RC + store builds.
  </content>
