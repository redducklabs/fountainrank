# Handoff — Mobile Slice 6e-1 (release config & app identity) MERGED (2026-06-23)

## TL;DR

**Slice 6e-1** — the first slice of the **mobile store-testing epic** — is **designed (umbrella spec), Codex-approved (spec + plan), implemented (in-session TDD), Codex-approved on the PR (Loop B), CI-green, all PR comments addressed, and squash-merged to `main`.**

- `main` HEAD = **`9cc8afa`** — `feat(mobile): release config, app identity, eas.json + test runner (slice 6e-1) (#66)`.
- **No deploy applies to this slice.** It is mobile **config/code only** — there is no DOKS deploy and no backend/web/DB/OpenAPI change. **Merge-to-main IS the delivery for 6e-1.** Actual store binaries (EAS Build/Submit) are **owner-gated** and do not happen here. (Merge-to-main never auto-deploys anyway — deploy is manual `workflow_dispatch`.)
- Post-merge **CI on `main` is green** (run `28007527427`), plus Security audit + CodeQL green.

**▶ NEXT (fresh session): plan slice 6e-2 (app shell).** Per the umbrella spec's §18 slice table. Flow for every mobile slice: spec is already approved (umbrella) → write the slice **plan** (`docs/plans/`) → **Codex Loop A on the plan** → branch → implement (TDD) → CI green + **Codex Loop B on the PR** + all PR comments addressed → **squash-merge**. No deploy/EAS build until the owner-gated slices (6e-8…6e-10).

> This handoff supersedes the "NEXT" pointer in `handoffs/2026-06-22-slice-6b2-add-fountain-deployed-handoff.md` (the web track). The web slices (6c/6d/6g) are still open and unblocked — we chose the **6e mobile** track next.

---

## The epic this belongs to (read this first — it frames every future mobile slice)

**Umbrella spec:** `docs/specs/2026-06-23-mobile-store-testing-distribution-design.md` (**Codex APPROVED**, Loop A, 3 rounds). It is an **umbrella, not a single slice** — it covers the whole Expo/React Native mobile app **and** its store-distribution path, sliced into **10 independently mergeable units (6e-1 … 6e-10)**. The slice table is **spec §18**; native/store requirements are **§20**; auth-unavailable mode + per-slice proof levels are **§21**; the API contract inventory + bundle-id honesty are **§17**.

| Slice | Content | Kind |
|---|---|---|
| **6e-1** ✅ MERGED | Release config & app identity: kill `localhost` URL, validated runtime config, `app.config.ts` identity, **store versioning**, **static native config** (location strings + deep-link scheme), **mobile unit-test runner**, `eas.json`, diagnostic surface, README. | Claude → CI-green |
| **6e-2** ◀ NEXT | App shell: navigation + state pattern, screen scaffolding (map, detail, add, sign-in/account, diagnostics), shared **release-safe API-client wrapper** building `@fountainrank/api-client` (this is where the **`X-Dev-*` ban + its assertion test** land), loading/empty/offline/error states, pure-helper tests. | Claude → CI-green |
| **6e-3** | Map + public discovery: **MapLibre RN** map (installs `@maplibre/maplibre-react-native` **+ its Expo config plugin + CNG/prebuild** — the app stops running in Expo Go here), foreground-location permission (non-blocking when denied), Protomaps basemap, nearby/bbox pins, pin→detail nav, filters. | Code+tests → CI-green; **map render verified only on a native build** (owner-gated: no Mac → EAS) |
| **6e-4** | Fountain detail + public reads (rating summary, dimensions, status, attributes, placement, notes, last-verified — unknowns shown honestly). | Claude → CI-green |
| **6e-5** | Native auth (Logto): auth-code + PKCE custom-scheme callback, SDK secure-token storage, access tokens for `https://api.fountainrank.com` audience, `/me` sync, no token logging. Ships behind **auth-unavailable mode** (§21). | Code → CI-green; **e2e verify owner-gated** |
| **6e-6** | Existing-fountain contributions: rating, status verify/report, attribute observations, **note creation (create-only — no edit/delete in the API)**. | Code → CI-green; signed-in verify owner-gated |
| **6e-7** | Add-fountain capture: GPS + tap/select-on-map placement, required fields + initial rating/attributes, **409 duplicate-proximity** → existing fountain. | Code → CI-green; signed-in verify owner-gated |
| **6e-8** | Store metadata + **Expo/EAS account & credentials**: Apple App ID + ASC record, Play app record + Play App Signing, `eas init` + EAS creds, icon/splash/screenshots/descriptions/privacy + data-safety, **finalized icon/splash assets**, `appVersionSource: "remote"`. | **Owner-gated** |
| **6e-9** | Auth/OAuth store alignment: **Logto Native app + callback URI**, mobile public Logto values, Google iOS OAuth client (after bundle id final), Google **Android** OAuth client (after **Play SHA-1**), Apple Sign-in artifacts, callback smoke test. | **Owner-gated** (Claude sets the public config values once records exist) |
| **6e-10** | Functional device RC + first store-testing builds + on-device verification (EAS builds, EAS Submit to TestFlight + Play internal, add testers, physical-device checks). | **Owner-gated** |

**6e-1…6e-4 (public reads + config) have no auth/store dependency and ship first.** 6e-5…6e-7 add authenticated code (mergeable on CI-green) but their *runtime* verification waits on the owner-gated auth records in 6e-9.

---

## What shipped in 6e-1 (every file, what it does)

All logic is in **pure, unit-tested modules**; `App.tsx` is the thin shell (no unit test — same pure-helper testing pattern the web slices use).

**New mobile source:**
- `mobile/lib/config.ts` + `mobile/lib/config.test.ts` (**11 tests**) — `parseMobileConfig(extra)` validates the runtime config from `app.config.ts`'s `extra`. **HTTPS-only**, React-Native-safe (no `URL` polyfill): rejects non-string/empty fields, whitespace/control chars (`/[\s\p{Cc}]/u`), and any non-`https://` or **hostless** URL. Final host regex (hardened over 2 Codex rounds): `^https:\/\/[a-zA-Z0-9][a-zA-Z0-9.-]*(:\d+)?(\/.*)?$` — host must start with an alphanumeric (rejects `https://`, `https://?x`, `https://#frag`, `https://:`, `https://-x.com`); hyphenated hosts like `api-staging.example.com` are allowed. Returns `{ apiBaseUrl, logtoEndpoint, logtoAudience, authCallbackScheme }`.
- `mobile/lib/build-info.ts` + `mobile/lib/build-info.test.ts` (**3 tests**) — `formatBuildInfo(version, build) → "vX.Y.Z (build N)"`; ASCII-only fallbacks (`0.0.0` / `unknown`).
- `mobile/vitest.config.ts` — Vitest, `environment: "node"`, `include: ["**/*.test.ts"]`.

**Changed mobile files:**
- `mobile/app.config.ts` — **replaces the deleted `mobile/app.json`**. Dynamic Expo config: `name: "FountainRank"`, `slug: "fountainrank"`, `version: "0.1.0"`, `scheme: "com.redducklabs.fountainrank"`, `runtimeVersion: { policy: "appVersion" }`, `ios.buildNumber: "1"`, `android.versionCode: 1`, **location-permission usage strings** (iOS `NSLocationWhenInUseUsageDescription`, Android foreground-location), and **`extra`** carrying only **public** config (production `apiBaseUrl`/`logtoEndpoint`/`logtoAudience` + `authCallbackScheme`). `EXPO_PUBLIC_*` env vars may override to an **alternate HTTPS endpoint** (e.g. staging) — local cleartext is intentionally unsupported in this slice.
- `mobile/App.tsx` — **killed the hard-coded `http://localhost:3021`**. Resolves config via `parseMobileConfig(Constants.expoConfig?.extra)` (wrapped in try/catch → renders an **invalid-config** state naming only the bad field, no secrets), shows the diagnostics surface (app name, backend reachability from `GET /healthz`, version/build label, resolved public API base URL).
- `mobile/eas.json` — **credential-free** build profiles (`development`/`preview`/`production`) + a `production` **submit** profile (Android `internal` track only). `cli.appVersionSource: "local"` (self-contained — validates with no EAS account); production build `autoIncrement: true`; production Android → `.aab`, preview → `.apk`. **No** Apple API key / ASC app id / Play service-account path (owner supplies at submit time, 6e-8/6e-10).
- `mobile/package.json` — added `"test": "vitest run"` script; devDeps `vitest@4.1.9` + `@types/node@22.19.21` (both matching `web`/`api-client`); dep `expo-constants@~56.0.18` (SDK-56-bundled version); and the `expo.doctor.reactNativeDirectoryCheck.listUnknownPackages: false` block so expo-doctor doesn't fail on the non-RN dev deps.
- `mobile/eslint.config.js` — added `vitest.config.ts` to ignores.
- `mobile/README.md` — current commands + runtime-config + store-testing (EAS, owner-gated) notes.

**Repo wiring & docs:**
- `run.ps1` — `Invoke-MobileCheck` now runs **`test`** in the turbo filter (`lint typecheck test --filter=mobile`); banner updated to "eslint + typecheck + vitest + expo-doctor". (CI already runs `turbo run lint typecheck test` workspace-wide, so the `test` script auto-wired mobile into CI too.)
- `claude_help/testing-ci.md` — mobile row + workspace-js note now include vitest.
- `docs/style-guide.md` — brief mobile note documenting the temporary 6e-1 diagnostics surface (superseded by the 6e-2 app shell).
- `docs/specs/2026-06-23-mobile-store-testing-distribution-design.md` — the umbrella spec (Codex APPROVED).
- `docs/plans/2026-06-23-mobile-6e-1-release-config.md` — the 6e-1 plan (Codex APPROVED).

**Codex review artifacts** (gitignored `temp/codex-reviews/`): `...-spec-review-{1,2,3}.md`, `...-6e-1-release-config-plan-review-{1,2,3}.md`, `pr-66-review-{1,2}.md`.

**Commits on the merged branch (squashed into `9cc8afa`):** `dd62657` docs (spec+plan) · `5c6a2b7` config parser + vitest runner · `6a729a6` build-info · `4bfc029` app.config.ts (app.json deleted) · `612739e` App.tsx + style-guide · `1228982` eas.json · `d614957` run.ps1 + docs · `0ad61ce`/`2a7ecfa` plan-doc accuracy + prettier · `e895440` PR-review fixes (hardened host regex + tests + whitespace).

---

## Standing constraints carried forward — EVERY future mobile slice must respect these

These came out of the spec/plan Codex loops. They are non-negotiable for 6e-2…6e-10:

1. **Bundle/package/scheme id `com.redducklabs.fountainrank` is the PROPOSED working default — NOT owner-confirmed.** It matches the *example* in `docs/setup/04-apple-and-app-stores.md` ("e.g. … confirm the final bundle id with me"). 6e-1 only authored local config with it and created **no** external record. **Before any Apple App ID, Play app record, Logto Native app, or Google OAuth client is created, get an explicit owner thumbs-up** — changing native identity after those exist breaks sign-in. (Spec §17.)
2. **Auth-unavailable mode (6e-5…6e-7, before 6e-9).** The Logto Native app + mobile public auth config do **not** exist yet. Ship authenticated code **without faking availability**: **no placeholder/fake app IDs or callback values**; when the mobile Logto public config is absent the app stays in a **public-read state** (signed-in actions hidden/disabled); PR/handoff wording is limited to **"compiled + unit-tested only"** — never "auth works" / "contributions work". The first PR after the Logto Native app exists carries the **on-device callback round-trip + ≥1 authenticated write** acceptance gate. (Spec §21.)
3. **No dev-auth seam on mobile, ever.** The generated client exposes `X-Dev-User`/`X-Dev-Email`/`X-Dev-Name` (the dev-only auth shortcut, gated off in prod). Mobile authenticates **only** with `Authorization: Bearer <Logto access token>` and must **never** set any `X-Dev-*` header in any build profile. **6e-2 owns the API-client wrapper + a unit test asserting the mobile auth-header builder cannot emit `X-Dev-*`.** (Spec §14.)
4. **HTTPS-only.** Runtime config rejects any non-HTTPS URL; **no iOS ATS exception, no Android cleartext config**. Dev overrides may only point at an alternate **HTTPS** endpoint.
5. **No token/PII logging.** Never log access/ID/refresh tokens, auth codes, magic-link codes, or full profile payloads. The 6e-1 diagnostic surface shows only app name, backend reachability, version/build, public API base URL.
6. **MapLibre native dep lands in 6e-3, not earlier.** `@maplibre/maplibre-react-native` + its Expo config plugin (and the CNG/prebuild it forces — app stops running in Expo Go) belong with the map that uses them. Map rendering is verifiable **only on a dev-client/EAS build** (owner-gated: no Mac).
7. **API contract is method-accurate (verified against `packages/api-client/src/schema.d.ts`).** Reads (GET): `/fountains` (nearby `lat`/`lng`/`radius_m` + filters), `/fountains/bbox`, `/fountains/{id}`, `/fountains/{id}/notes` (list), `/rating-types`, `/attribute-types`, `/me`, `/me/contributions`, `/me/badges`, `/leaderboard/contributors`. Writes (POST): `/fountains` (add, 409 duplicate-proximity), `/fountains/{id}/ratings`, `/fountains/{id}/attributes`, `/fountains/{id}/conditions`, `/fountains/{id}/notes` (create), `/me/sync`. **ratings/conditions/attributes are POST-only — no GET collection**; read-side current status/attribute-consensus/rating-summary come from `GET /fountains/{id}` (detail) + pin responses. **Notes are list/create only — no PUT/PATCH/DELETE**, so note editing/deletion is out of beta scope. Don't invent endpoints.
8. **No Mac → EAS free tier for iOS.** Owner **has** Apple Developer Program ($99/yr) + Google Play Console ($25 one-time). Owner **does NOT have an Expo/EAS account yet** — it's **free to create**, and the EAS free tier (15 iOS + 15 Android builds/mo, *re-verify the current quota at 6e-10*) is expected to cover the beta; **no paid EAS plan assumed**. The Expo SDK/CLI are free/MIT — there is no "Expo license". (Spec §6/§9/§19.)
9. **Versioning:** `version 0.1.0`, `ios.buildNumber "1"`, `android.versionCode 1`, `runtimeVersion: appVersion`; `eas.json appVersionSource: "local"` for now (→ `"remote"` deferred to 6e-8 after `eas init`).

---

## Current state (verified 2026-06-23)

- `main` HEAD = **`9cc8afa`** (PR #66, mergeCommit `9cc8afabcf5e59fe9bdc6cfc16ba8e7992656a7a`, merged 2026-06-23T06:42Z). Local `main` == `origin/main`. Working tree clean except the untracked conversation-export `.txt` at repo root (safe to delete).
- **CI green on `main`** (push run `28007527427`, success), Security audit `28007527447` success, CodeQL `28007526602` success.
- Branch `feat/mobile-6e-1-release-config` **deleted** locally + on remote (pruned). PR #66 comments all addressed (the only commenter was the Codex bot under the owner account; both inline findings have "Resolved in e895440" replies — no Copilot/Dependabot/human threads open).
- **No deployment for this slice** (mobile config only; nothing to deploy to DOKS, no EAS build — those are owner-gated). This is expected and correct, not a missing step.
- **Non-blocking observation:** a scheduled **Dependabot Updates** job (`28007589988`, grouped npm bump for react / @maplibre/maplibre-gl-style-spec / @types/node / eslint / typescript / react-native) shows **failure**. That's Dependabot's own update-PR creation job (background housekeeping), **not** a gate on `main` and **not** caused by the 6e-1 merge — main's CI is green. Worth a glance next session but does not block 6e-2.

---

## Gotchas (mobile-specific — read before any local work)

- **pnpm store goes dirty after EVERY Codex (WSL) run.** A Codex review runs in WSL and corrupts the Windows pnpm store → the next Windows `pnpm`/`vitest`/`run.ps1` fails (`ERR_PNPM_ABORTED_REMOVE_MODULES_DIR_NO_TTY` / EACCES). **Recover with a clean reinstall** (it is NOT a timing issue): from Git Bash, `rm -rf node_modules web/node_modules mobile/node_modules packages/*/node_modules && CI=true pnpm install`. Do this **before any local check that follows a Codex run** (after each plan review AND each PR review).
- **`CI=true pnpm install` forces `--frozen-lockfile`.** When **adding/changing a mobile dep**, use `CI=true pnpm install --no-frozen-lockfile` (still `CI=true` to skip the interactive deps-purge prompt), then commit the updated `pnpm-lock.yaml` in the same task. CI installs frozen, so a stale lockfile fails CI.
- **Scoped mobile checks run `generate` first.** `turbo.json` makes `typecheck`/`test` `dependsOn` `generate`/`^generate`, so `run.ps1 check -Mobile` (and CI's `turbo run lint typecheck test`) may run the `@fountainrank/api-client` OpenAPI export, which needs backend **`uv`** deps. If a scoped mobile check fails *inside `generate`*, run `uv sync` in `backend/` (or `./run.ps1 bootstrap`) — that's a backend-deps problem, not a Vitest failure. (`generate` is DB-free.)
- **The mobile check does NOT run Prettier.** `format:check` is a separate gate covering `{web,mobile,packages}/**` — but **NOT `docs/`**. So: (a) after hand-writing mobile `.ts`, run `pnpm exec prettier --write` on the touched files before the **full** `./run.ps1 check`, or format:check fails late; (b) format any touched `docs/**` / `claude_help/**` files **explicitly** (they're outside the format:check glob).
- **expo-doctor version-checks Expo deps.** Get an SDK-correct version from `node_modules/.pnpm/expo@*/node_modules/expo/bundledNativeModules.json` (e.g. `expo-constants` → `~56.0.18`) rather than `expo install` (which can hit frozen-lockfile/no-TTY edges in this workspace).
- **`@types/node` is required for `process.env` in `app.config.ts` to typecheck.** Expo's base tsconfig sets **no `types` array**, so all `@types/*` are auto-included globally — adding the devDep is enough (no tsconfig change).
- **Deploy is manual `workflow_dispatch`** (`.github/workflows/deploy.yml` triggers on a `v*.*.*` tag or dispatch) — but **N/A for mobile slices** (no DOKS artifact). Don't trigger a deploy for a mobile-only slice.
- **Windows file tools use backslash paths** (`D:\repos\fountainrank\...`); the **Bash tool is Git Bash** (forward slashes, `/d/repos/fountainrank/...`); run the task runner as `powershell.exe -NoProfile -ExecutionPolicy Bypass -File run.ps1 <args>`. Paths handed to **Codex** must be **repo-relative**; the Codex MCP `cwd` derives to `/mnt/d/repos/fountainrank`.
- **No AI attribution** in commits/PRs; **no time estimates** anywhere; Conventional Commits; **squash-merge** only.

---

## Resume commands (copy-paste)

```bash
# ground state — expect HEAD = 9cc8afa, clean tree
git -C /d/repos/fountainrank log --oneline -3 origin/main
git -C /d/repos/fountainrank status --short

# recover the pnpm store FIRST if a Codex run just ran (clean reinstall, not a wait):
rm -rf node_modules web/node_modules mobile/node_modules packages/*/node_modules && CI=true pnpm install

# local CI mirror (Windows, from Git Bash):
powershell.exe -NoProfile -ExecutionPolicy Bypass -File run.ps1 check            # full (backend + workspace-js + web build + mobile)
powershell.exe -NoProfile -ExecutionPolicy Bypass -File run.ps1 check -Mobile    # mobile only: lint + typecheck + vitest + expo-doctor
pnpm --filter mobile exec vitest run lib/config.test.ts                          # a single mobile test file

# adding a mobile dep (must update lockfile, then commit it):
CI=true pnpm install --no-frozen-lockfile
```

## Key artifacts

- **Umbrella spec (APPROVED):** `docs/specs/2026-06-23-mobile-store-testing-distribution-design.md` — §17 contract/bundle-id, §18 slice table, §20 native/store config, §21 auth-unavailable mode + proof levels.
- **6e-1 plan (APPROVED):** `docs/plans/2026-06-23-mobile-6e-1-release-config.md`.
- **Architecture mandate for the map stack:** `docs/specs/2026-06-16-architecture-and-foundation-design.md` (MapLibre RN).
- **Owner runbook for external accounts/credentials:** `docs/setup/README.md` + `docs/setup/04-apple-and-app-stores.md` + `docs/setup/03-*` (Google OAuth / Play SHA-1 dependency).
- **Process:** `claude_help/development-process.md`, `claude_help/testing-ci.md`, `claude_help/codex-review-process.md`.
- **Mobile workspace:** `mobile/` (App.tsx, app.config.ts, eas.json, lib/config.ts, lib/build-info.ts).
- **Prior track (web):** `handoffs/2026-06-22-slice-6b2-add-fountain-deployed-handoff.md` — the web add-fountain + auth-shell patterns 6e-5…6e-7 mirror.
