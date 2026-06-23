# Mobile slice 6e-2 — app shell Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the 6e-1 diagnostics skeleton into the real mobile **app shell**: Expo Router navigation (tabs + stack) with scaffolded screens (map, detail, add, account, diagnostics), a release-safe API-client wrapper that locks the **no-`X-Dev-*` auth contract** before any auth code exists, a TanStack Query server-state layer, reusable loading/empty/offline/error states, an auth-unavailable seam, and the mobile design system — all green on the local CI mirror.

**Architecture:** The split established in 6e-1 holds: **pure, unit-tested modules** in `mobile/lib/` with **zero Expo/React-Native imports** (so they run under Vitest in a plain `node` env), and a **thin, untested shell** (Expo Router route files, React components, providers) covered by `tsc` + ESLint + `expo-doctor`. Navigation is **Expo Router** (file-based `app/` tree, entry `expo-router/entry`), mirroring the web's Next.js App Router convention and giving first-class deep-linking for the future auth callback. Server state is **TanStack Query** over the existing `openapi-fetch` `@fountainrank/api-client`. The only screen that performs a real request in this slice is **Diagnostics** (`GET /healthz`), which proves the whole stack (config → client → query → view-state) end-to-end without needing auth or the map; every other screen is an honest scaffold for its later slice.

**Tech Stack:** Expo SDK 56, React Native 0.85, React 19, TypeScript 6 (strict), Expo Router `~56.2.11`, `react-native-screens@4.25.2`, `react-native-safe-area-context@~5.7.0`, `expo-linking@~56.0.14`, `expo-status-bar@~56.0.4`, `@expo/vector-icons@^15.0.2`, `@tanstack/react-query@5.101.0`, `@fountainrank/api-client` (openapi-fetch `0.17.0`), `expo-constants` (already present), Vitest 4.1.9 (node env), Turbo, pnpm workspace.

**Spec:** `docs/specs/2026-06-23-mobile-store-testing-distribution-design.md` (Codex-approved umbrella). This plan implements **slice 6e-2** from spec §18, realizing **§15 Phase 2** (navigation + state pattern, screen scaffolding, shared release-safe API config, loading/empty/offline/error states, pure-helper tests) and honoring **§14** (no dev-auth seam from mobile + its assertion test), **§20** (HTTPS-only, no ATS/cleartext; MapLibre still deferred to 6e-3), and **§21** (auth-unavailable mode, "Local CI" proof level). Read those sections before starting.

## Global Constraints

- **No AI attribution** in commits/PRs; **no time estimates** anywhere. Conventional Commits; frequent commits; one task at a time; **squash-merge** only.
- **All shell commands below run from the repo root** (the harness's working directory) and use **repo-relative paths** — no absolute repo root is hard-coded (per the repo's "never hardcode an absolute repo path" rule). If a shell's cwd has drifted, `cd` back to the repo root first.
- **Claude Code runs on Windows:** file tools use backslash paths (`...\mobile\...`); the Bash tool is Git Bash (forward slashes). Run the task runner as `powershell.exe -NoProfile -ExecutionPolicy Bypass -File run.ps1 <args>` (no `pwsh`). Any path handed to **Codex** in a review prompt must be **repo-relative**; the Codex MCP `cwd` is **derived** from the current repo root (`D:\repos\fountainrank` → `/mnt/d/repos/fountainrank`), never hard-coded.
- **pnpm store goes dirty after every Codex (WSL) run.** Before the FIRST local `pnpm`/`vitest`/`run.ps1` of the implementation (a Codex plan review runs just before), and after each later Codex run, recover with a clean reinstall — it is NOT a timing issue: from Git Bash, `rm -rf node_modules web/node_modules mobile/node_modules packages/*/node_modules && CI=true pnpm install`.
- **Lockfile discipline:** CI installs with `--frozen-lockfile`. After ANY `mobile/package.json` dependency change, run `CI=true pnpm install --no-frozen-lockfile` (still `CI=true` to skip the interactive deps-purge prompt), then commit the updated `pnpm-lock.yaml` in the same task. A stale lockfile fails CI.
- **Scoped mobile Turbo checks run `generate` first.** `turbo.json` makes `typecheck`/`test` `dependsOn` `generate`/`^generate`, so `run.ps1 check -Mobile` (and CI's `turbo run lint typecheck test`) may run the `@fountainrank/api-client` OpenAPI export, which needs backend **`uv`** deps. If a scoped mobile check fails *inside `generate`*, run `uv sync` in `backend/` (or `./run.ps1 bootstrap`) — that's a backend-deps problem, not a Vitest failure. (`generate` is DB-free.)
- **The mobile check does NOT run Prettier.** `format:check` is a separate gate covering `{web,mobile,packages}/**` — but **NOT `docs/`**. So: (a) after hand-writing mobile `.ts`/`.tsx`, run `pnpm exec prettier --write` on the touched files before the **full** `./run.ps1 check`; (b) format touched `docs/**` files **explicitly** (they are outside the format:check glob).
- **expo-doctor version-checks Expo deps.** Use the SDK-correct versions pinned in this plan (read from `node_modules/.pnpm/expo@*/node_modules/expo/bundledNativeModules.json`) rather than `expo install` (which can hit the frozen-lockfile/no-TTY edges in this workspace). `@tanstack/react-query` is not an Expo module — it is covered by the existing `expo.doctor.reactNativeDirectoryCheck.listUnknownPackages: false` block.
- **Local mirror gates the PR:** `./run.ps1 check` (backend + workspace-js + web build + mobile) must be green before the PR. Mid-loop, scope to mobile: `powershell.exe -NoProfile -ExecutionPolicy Bypass -File run.ps1 check -Mobile` (lint + typecheck + vitest + expo-doctor); add `-Fast` to skip expo-doctor for quick inner loops. Per-mobile-file test: `pnpm --filter mobile exec vitest run lib/<file>.test.ts`.

**Security / standards (spec §14, §20, §21) — carried from 6e-1, still binding:**
- **No dev-auth seam on mobile, ever (§14).** `buildAuthHeaders` (Task 4) emits **only** `Authorization: Bearer <token>` and is structurally incapable of emitting `X-Dev-User`/`X-Dev-Email`/`X-Dev-Name`. A unit test asserts no returned key matches `/^x-dev/i`. **6e-2 owns this assertion test.** Never introduce an `X-Dev-*` header in any module or build profile.
- **Auth-unavailable mode (§21).** No Logto Native app exists yet. Do **not** commit a placeholder/fake Logto app id. `MobileConfig` gains an **optional** `logtoAppId?` that is **absent** in this slice; `isAuthConfigured(config)` returns `false`, and the Account screen renders an honest **public-read** state (no faked sign-in). 6e-5 consumes the seam; 6e-9 populates the real value.
- **HTTPS-only (§20).** The existing `requireHttpsUrl` validation is unchanged; no iOS ATS exception, no Android cleartext. No new URL is introduced.
- **No token/PII logging.** The shell logs nothing sensitive. The Diagnostics screen shows only app name, backend reachability, version/build label, and the public API base URL.
- **No external records / no native-identity change (§17).** 6e-2 creates **no** Apple/Play/Logto/Google records and does not change the bundle id/scheme — the owner-confirmation gate is not triggered.
- **MapLibre native dep is still 6e-3.** Do not add `@maplibre/maplibre-react-native` here. The Expo Router deps added in this slice (`react-native-screens`, `react-native-safe-area-context`, `expo-linking`, `expo-status-bar`) are **bundled in Expo Go**, so the app **still runs in Expo Go** after 6e-2; Expo Go support ends in 6e-3 with MapLibre's config plugin + CNG/prebuild.
- **Proof level = Local CI (§21).** This slice's gate is type-check + lint + `expo-doctor` + unit tests. CI does **not** run Metro or a device, so it does not prove the app *renders*; PR/handoff wording stays "compiles, lints, type-checks, unit-tested" — not "the app works on a device." (The owner *can* smoke-test it in Expo Go since 6e-2 doesn't break Expo Go, but that is not part of the CI gate.)

**Scope boundaries (deferred, consistent with spec §18 — not deviations):** real MapLibre map + foreground location → **6e-3**; real fountain-detail reads → **6e-4**; Logto SDK + sign-in/account UI → **6e-5**; existing-fountain contributions → **6e-6**; add-fountain capture → **6e-7**. Global online/offline via `@react-native-community/netinfo` + TanStack Query `onlineManager` is **deferred** — 6e-2 detects offline at the request level (a network failure has no HTTP status; see `resolveViewState`), which satisfies the §15-Phase-2 "offline state" requirement without a native NetInfo dependency. **Expo Router typed routes** (`experiments.typedRoutes`) are **not** enabled (route types are generated by `expo start`/prebuild, which CI does not run — enabling them would make `tsc` depend on generated artifacts); `href` values are plain strings in this slice.

---

## File Structure

**Pure, unit-tested modules (`mobile/lib/`, zero RN/Expo imports — run under Vitest `node` env):**
- `mobile/lib/config.ts` (**modify**) — add optional `logtoAppId?` to `MobileConfig` + `isAuthConfigured(config)` predicate. (Task 3)
- `mobile/lib/config.test.ts` (**modify**) — add `logtoAppId` parse cases + `isAuthConfigured` cases. (Task 3)
- `mobile/lib/api.ts` (**create**) — `buildAuthHeaders`, `ApiError`, `unwrap`, `createApiClient`. (Task 4)
- `mobile/lib/api.test.ts` (**create**) — the no-`X-Dev-*` enforcement (helper + sanitizing-fetch/facade boundary, incl. the per-request-middleware bypass) + unwrap/createApiClient cases. (Task 4)
- `mobile/lib/view-state.ts` (**create**) — `resolveViewState` (loading/offline/error/empty/ready). (Task 5)
- `mobile/lib/view-state.test.ts` (**create**). (Task 5)
- `mobile/lib/build-info.ts` (**unchanged**) — reused by the Diagnostics screen.

**Design system + presentational components (untested shell — `tsc`/ESLint/doctor covered):**
- `mobile/theme.ts` (**create**) — color/spacing/typography tokens. (Task 6)
- `mobile/components/ScreenContainer.tsx` (**create**). (Task 6)
- `mobile/components/states/LoadingState.tsx`, `EmptyState.tsx`, `ErrorState.tsx`, `OfflineState.tsx`, `QueryStateView.tsx` (**create**). (Task 6)
- `mobile/providers/api-provider.tsx` (**create**) — `ApiProvider` context + `useApi()` hook. (Task 7)

**Expo Router app tree (`mobile/app/`, untested shell):**
- `mobile/app/_layout.tsx` (**create** Task 2 minimal → **replace** Task 7 with providers + config guard).
- `mobile/app/(tabs)/_layout.tsx` (**create**) — Tabs (Map · Add · Account). (Task 8)
- `mobile/app/(tabs)/index.tsx` (**create** as `app/index.tsx` Task 2 → **move** into `(tabs)/` Task 8) — Map scaffold.
- `mobile/app/(tabs)/add.tsx`, `mobile/app/(tabs)/account.tsx` (**create**). (Task 8)
- `mobile/app/fountains/[id].tsx` (**create**) — Detail scaffold. (Task 8)
- `mobile/app/+not-found.tsx` (**create**). (Task 8)
- `mobile/app/diagnostics.tsx` (**create**) — functional `GET /healthz` via TanStack Query. (Task 9)

**Config / wiring / docs:**
- `mobile/package.json` (**modify**) — `main` → `expo-router/entry`; add deps (Tasks 2, 7); `pnpm-lock.yaml` updated by install.
- `mobile/app.config.ts` (**modify**) — add `plugins: ["expo-router"]`. (Task 2)
- `mobile/App.tsx`, `mobile/index.ts` (**delete**) — replaced by the Expo Router entry + `app/` tree. (Task 2)
- `mobile/README.md` (**modify**) — app-shell navigation + commands. (Task 10)
- `docs/style-guide.md` (**modify**) — replace the temporary-diagnostics note with the real mobile component system. (Task 10)
- `docs/plans/2026-06-23-mobile-6e-2-app-shell.md` — this plan (committed in Task 1).

No backend, no `api-client`, no web changes. No CI workflow change: CI's `workspace-js` job already runs `turbo run lint typecheck test`, and `run.ps1 check -Mobile` already runs `test` (wired in 6e-1).

---

### Task 1: Branch + land this plan

**Files:**
- Add (already on disk, untracked): `docs/plans/2026-06-23-mobile-6e-2-app-shell.md`

- [ ] **Step 1: Create the branch** off up-to-date `main`:

```bash
git fetch origin
git switch -c feat/mobile-6e-2-app-shell origin/main
```

- [ ] **Step 2: Commit the plan** (it rides this PR):

```bash
git add docs/plans/2026-06-23-mobile-6e-2-app-shell.md
git commit -m "docs: mobile 6e-2 app-shell implementation plan"
```

---

### Task 2: Migrate to Expo Router (entry + minimal boot)

Get Expo Router booting with the simplest possible route before layering providers/screens, so the migration is independently verifiable.

**Files:**
- Modify: `mobile/package.json` (`main` + deps), `mobile/app.config.ts` (plugin), `pnpm-lock.yaml`
- Create: `mobile/app/_layout.tsx`, `mobile/app/index.tsx`
- Delete: `mobile/App.tsx`, `mobile/index.ts`

**Interfaces:**
- Produces: an Expo Router app whose entry is `expo-router/entry`; root `_layout.tsx` renders a `<Stack />`; `app/index.tsx` is the home route. Replaced/extended by Tasks 7–9.

- [ ] **Step 1: Recover the pnpm store** (a Codex plan review just ran in WSL), from Git Bash:

```bash
rm -rf node_modules web/node_modules mobile/node_modules packages/*/node_modules && CI=true pnpm install
```

- [ ] **Step 2: Add the Expo Router deps** to `mobile/package.json` `dependencies` at the SDK-56-correct versions (from `expo/bundledNativeModules.json`). Add these keys alongside the existing `expo-constants`. `@expo/vector-icons` (Expo-bundled icon set, no native config) is included now for the tab icons in Task 8:

```jsonc
"dependencies": {
  "@expo/vector-icons": "^15.0.2",
  "@fountainrank/api-client": "workspace:*",
  "expo": "56.0.12",
  "expo-constants": "~56.0.18",
  "expo-linking": "~56.0.14",
  "expo-router": "~56.2.11",
  "expo-status-bar": "~56.0.4",
  "react": "19.2.3",
  "react-native": "0.85.3",
  "react-native-safe-area-context": "~5.7.0",
  "react-native-screens": "4.25.2"
}
```

- [ ] **Step 3: Set the Expo Router entry point** in `mobile/package.json` — change `"main"` from `"index.ts"` to `"expo-router/entry"`:

```jsonc
{
  "name": "mobile",
  "version": "0.0.0",
  "private": true,
  "main": "expo-router/entry",
  // ...scripts unchanged...
}
```

- [ ] **Step 4: Install** to materialize the new deps + refresh the lockfile (adding deps changes the lockfile, so `--no-frozen-lockfile`), from Git Bash:

```bash
CI=true pnpm install --no-frozen-lockfile
```
Expected: `expo-router`, `react-native-screens`, `react-native-safe-area-context`, `expo-linking`, `expo-status-bar` resolve under `mobile/node_modules`; `pnpm-lock.yaml` updated.

- [ ] **Step 5: Register the Expo Router plugin** in `mobile/app.config.ts` — add a `plugins` array (the rest of the config is unchanged from 6e-1):

```ts
const config: ExpoConfig = {
  name: "FountainRank",
  slug: "fountainrank",
  version: "0.1.0",
  scheme: "com.redducklabs.fountainrank",
  platforms: ["ios", "android"],
  plugins: ["expo-router"],
  runtimeVersion: { policy: "appVersion" },
  // ...ios / android / extra unchanged...
};
```
(`babel-preset-expo` already handles Expo Router in SDK 56 — no `babel.config.js` change. No `metro.config.js` is needed; the default Expo Metro config supports Expo Router in SDK 50+.)

- [ ] **Step 6: Create the minimal root layout** — `mobile/app/_layout.tsx`:

```tsx
import { Stack } from "expo-router";

export default function RootLayout() {
  return <Stack />;
}
```

- [ ] **Step 7: Create the home route** — `mobile/app/index.tsx`:

```tsx
import { StyleSheet, Text, View } from "react-native";

export default function Index() {
  return (
    <View style={styles.container}>
      <Text style={styles.title}>FountainRank</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, alignItems: "center", justifyContent: "center" },
  title: { fontSize: 24, fontWeight: "bold" },
});
```

- [ ] **Step 8: Delete the old single-screen entry** (replaced by the `app/` tree + `expo-router/entry`):

```bash
git rm mobile/App.tsx mobile/index.ts
```

- [ ] **Step 9: Lint + typecheck + expo-doctor** (full mobile check — verifies the Expo Router migration is structurally valid):

```bash
powershell.exe -NoProfile -ExecutionPolicy Bypass -File run.ps1 check -Mobile
```
Expected: ESLint + `tsc --noEmit` + vitest (the two 6e-1 suites still pass) + `expo-doctor` all green. If `expo-doctor` flags a version mismatch on any added module, correct that key to the `bundledNativeModules.json` value and re-run.

- [ ] **Step 10: Format the touched files + commit:**

```bash
pnpm exec prettier --write mobile/app.config.ts mobile/app/_layout.tsx mobile/app/index.tsx
git add mobile/package.json mobile/app.config.ts mobile/app/_layout.tsx mobile/app/index.tsx pnpm-lock.yaml
git commit -m "feat(mobile): migrate to Expo Router entry + minimal app shell (slice 6e-2)"
```

---

### Task 3: Auth-availability seam in the runtime config

**Files:**
- Modify: `mobile/lib/config.ts`
- Test: `mobile/lib/config.test.ts`

**Interfaces:**
- Produces: `MobileConfig` gains optional `logtoAppId?: string`; new `isAuthConfigured(config: MobileConfig): boolean` (= `logtoAppId` is a present non-empty string). Consumed by the Account screen (Task 8) and 6e-5.

- [ ] **Step 1: Add the failing tests** to `mobile/lib/config.test.ts`. First widen the import to bring in the new predicate — change the existing import line to:

```ts
import { isAuthConfigured, parseMobileConfig } from "./config";
```

**(a)** Inside the existing `describe("parseMobileConfig", () => { ... })`, add these four `it` cases just before that describe's closing `});` (they sit alongside the 6e-1 cases — do not add or remove any braces):

```ts
  it("omits logtoAppId when it is absent (auth-unavailable mode)", () => {
    expect("logtoAppId" in parseMobileConfig(VALID)).toBe(false);
  });

  it("parses a present non-empty logtoAppId", () => {
    const withId = { ...VALID, logtoAppId: "abc123" };
    expect(parseMobileConfig(withId).logtoAppId).toBe("abc123");
  });

  it("rejects a present-but-empty logtoAppId", () => {
    expect(() => parseMobileConfig({ ...VALID, logtoAppId: "" })).toThrow(/logtoAppId/);
  });

  it("rejects a non-string logtoAppId", () => {
    expect(() => parseMobileConfig({ ...VALID, logtoAppId: 5 })).toThrow(/logtoAppId/);
  });
```

**(b)** Then append this complete, self-contained `describe` block at the **end** of the file (after the `parseMobileConfig` describe's closing `});`):

```ts
describe("isAuthConfigured", () => {
  it("is false when logtoAppId is absent (auth-unavailable)", () => {
    expect(isAuthConfigured(parseMobileConfig(VALID))).toBe(false);
  });

  it("is true when a logtoAppId is present", () => {
    expect(isAuthConfigured(parseMobileConfig({ ...VALID, logtoAppId: "abc123" }))).toBe(true);
  });
});
```

- [ ] **Step 2: Run it; verify it fails** (`isAuthConfigured` undefined; `logtoAppId` not parsed):

```bash
pnpm --filter mobile exec vitest run lib/config.test.ts
```
Expected: FAIL.

- [ ] **Step 3: Implement** — modify `mobile/lib/config.ts`: extend the type, parse `logtoAppId` conditionally (so the key is omitted when absent — keeping the existing `toEqual(VALID)` test green), and add the predicate:

```ts
export type MobileConfig = {
  apiBaseUrl: string;
  logtoEndpoint: string;
  logtoAudience: string;
  authCallbackScheme: string;
  logtoAppId?: string;
};

// ...requireNonEmpty / requireHttpsUrl unchanged...

export function parseMobileConfig(extra: unknown): MobileConfig {
  if (typeof extra !== "object" || extra === null) {
    throw new Error("Mobile config: expoConfig.extra is missing");
  }
  const e = extra as Record<string, unknown>;
  const config: MobileConfig = {
    apiBaseUrl: requireHttpsUrl(e.apiBaseUrl, "apiBaseUrl"),
    logtoEndpoint: requireHttpsUrl(e.logtoEndpoint, "logtoEndpoint"),
    logtoAudience: requireHttpsUrl(e.logtoAudience, "logtoAudience"),
    authCallbackScheme: requireNonEmpty(e.authCallbackScheme, "authCallbackScheme"),
  };
  // logtoAppId is optional in this beta: absent until the owner-gated Logto
  // Native app exists (spec section 21, auth-unavailable mode). Present: a
  // non-empty string; absent: omitted entirely (no placeholder/fake id).
  if (e.logtoAppId !== undefined) {
    config.logtoAppId = requireNonEmpty(e.logtoAppId, "logtoAppId");
  }
  return config;
}

/** True only when a real Logto Native app id is configured. False in this beta
 * (auth-unavailable mode), so the app stays in a public-read state. */
export function isAuthConfigured(config: MobileConfig): boolean {
  return typeof config.logtoAppId === "string" && config.logtoAppId.length > 0;
}
```

- [ ] **Step 4: Run it; verify it passes:**

```bash
pnpm --filter mobile exec vitest run lib/config.test.ts
```
Expected: PASS (the original 11 cases + the 6 new ones).

- [ ] **Step 5: Commit:**

```bash
git add mobile/lib/config.ts mobile/lib/config.test.ts
git commit -m "feat(mobile): optional logtoAppId + isAuthConfigured auth-unavailable seam (slice 6e-2)"
```

---

### Task 4: Release-safe API-client wrapper + the no-`X-Dev-*` contract

**Files:**
- Create: `mobile/lib/api.ts`
- Test: `mobile/lib/api.test.ts`

**Interfaces:**
- Produces:
  - `buildAuthHeaders(token: string | null | undefined): Record<string, string>` — `{}` or `{ Authorization: "Bearer <token>" }`; never `X-Dev-*`.
  - `class ApiError extends Error { readonly status: number }`.
  - `unwrap<T>(result: { data?: T; error?: unknown; response: Response }): T` — returns data, throws `ApiError(status)` on an HTTP error.
  - `type MobileApiClient = Pick<ApiClient, "GET" | "POST" | "PUT" | "PATCH" | "DELETE">` — the narrowed mobile surface (no `use`/`eject`).
  - `createApiClient(baseUrl: string, options?: Parameters<typeof makeClient>[1]): MobileApiClient` — the mobile-safe client. The optional `options` pass-through (e.g. an injected `fetch`) lets tests exercise the boundary. (It is **not** a middleware attachment point — the facade hides `use`/`eject`; 6e-5 will **extend this factory** with a dedicated Logto token-provider path that uses `buildAuthHeaders`, preserving the sanitizing fetch.)
- Consumed by: `api-provider.tsx` (Task 7, holds a `MobileApiClient`), `view-state.test.ts` (Task 5, imports `ApiError`), the Diagnostics screen (Task 9).
- **Security intent (spec §14) — ENFORCED and NON-BYPASSABLE:** the no-`X-Dev-*` contract is locked by **two layers** before any auth code exists: (1) a **sanitizing `fetch`** wrapping the configured fetch that deletes any `x-dev*` header immediately before the network call — and since openapi-fetch invokes the configured fetch *after* every middleware (global and per-request), this catches x-dev from generated `params.header` OR from any middleware; (2) a **narrowed facade** that re-exposes only the HTTP verbs and strips the per-request `fetch`/`middleware` escape hatches, so a caller cannot swap in a fetch/middleware that bypasses layer 1 (and `use`/`eject` are not exposed). The tests below prove all of this at the *actual client boundary* (a mock `fetch`): default request clean; `X-Dev-*` on a generated op (`GET /api/v1/me`) stripped; `X-Dev-*` injected by per-request middleware stripped; no `use`/`eject` surface.

- [ ] **Step 1: Write the failing test** — `mobile/lib/api.test.ts`. The `createApiClient` block injects a mock `fetch` (the same idiom `packages/api-client/src/index.test.ts` already uses — global `Request`/`Response`/`Headers` are available in the node Vitest env) to exercise the **real wrapper boundary**: a default request carries no `X-Dev-*`; an `X-Dev-*` passed to a generated op (`GET /api/v1/me`) is stripped; an `X-Dev-*` injected by **per-request middleware** is stripped (the bypass path); `use`/`eject` are not exposed; a network failure rejects with a non-`ApiError` (the "offline" path); and a 5xx unwraps to `ApiError` (the "error" path):

```ts
import { describe, expect, it } from "vitest";

import { ApiError, buildAuthHeaders, createApiClient, unwrap } from "./api";

describe("buildAuthHeaders", () => {
  it("returns a Bearer Authorization header for a non-empty token", () => {
    expect(buildAuthHeaders("abc123")).toEqual({ Authorization: "Bearer abc123" });
  });

  it("returns no headers when the token is missing/empty", () => {
    expect(buildAuthHeaders(null)).toEqual({});
    expect(buildAuthHeaders(undefined)).toEqual({});
    expect(buildAuthHeaders("")).toEqual({});
  });

  it("NEVER emits any X-Dev-* dev-auth header (spec §14)", () => {
    for (const token of ["abc123", "", null, undefined] as const) {
      const headers = buildAuthHeaders(token);
      const keys = Object.keys(headers).map((k) => k.toLowerCase());
      expect(keys.some((k) => k.startsWith("x-dev"))).toBe(false);
    }
  });
});

describe("unwrap", () => {
  const ok = { ok: true, status: 200 } as unknown as Response;
  const notFound = { ok: false, status: 404 } as unknown as Response;

  it("returns data on a successful response", () => {
    expect(unwrap({ data: { status: "ok" }, response: ok })).toEqual({ status: "ok" });
  });

  it("throws ApiError carrying the status on an HTTP error", () => {
    try {
      unwrap({ error: { detail: "nope" }, response: notFound });
      throw new Error("expected unwrap to throw");
    } catch (e) {
      expect(e).toBeInstanceOf(ApiError);
      expect((e as ApiError).status).toBe(404);
    }
  });
});

describe("createApiClient", () => {
  it("builds a client exposing typed request methods", () => {
    const client = createApiClient("https://api.fountainrank.com");
    expect(typeof client.GET).toBe("function");
  });

  it("sends NO X-Dev-* header on a default request (spec section 14)", async () => {
    let sentKeys: string[] = [];
    const fetchMock: typeof fetch = async (input) => {
      const req = input instanceof Request ? input : new Request(String(input));
      sentKeys = [...req.headers.keys()].map((k) => k.toLowerCase());
      return new Response(JSON.stringify({ status: "ok" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    };
    const client = createApiClient("https://api.fountainrank.com", { fetch: fetchMock });
    await client.GET("/healthz");
    expect(sentKeys.some((k) => k.startsWith("x-dev"))).toBe(false);
  });

  it("STRIPS an X-Dev-* header a caller passes to a generated operation (spec section 14 enforcement)", async () => {
    let sentKeys: string[] = [];
    const fetchMock: typeof fetch = async (input) => {
      const req = input instanceof Request ? input : new Request(String(input));
      sentKeys = [...req.headers.keys()].map((k) => k.toLowerCase());
      return new Response(JSON.stringify({}), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    };
    const client = createApiClient("https://api.fountainrank.com", { fetch: fetchMock });
    // GET /api/v1/me IS a generated operation that exposes X-Dev-* header params.
    // Deliberately try to send them and prove the wrapper's middleware strips them
    // before the request leaves the client (Authorization, if any, is untouched).
    await client.GET("/api/v1/me", {
      params: {
        header: {
          "X-Dev-User": "evil",
          "X-Dev-Email": "evil@example.com",
          "X-Dev-Name": "Evil",
        },
      },
    });
    expect(sentKeys.some((k) => k.startsWith("x-dev"))).toBe(false);
  });

  it("STRIPS an X-Dev-* header added by per-request middleware (non-bypassable, spec section 14)", async () => {
    let sentKeys: string[] = [];
    const fetchMock: typeof fetch = async (input) => {
      const req = input instanceof Request ? input : new Request(String(input));
      sentKeys = [...req.headers.keys()].map((k) => k.toLowerCase());
      return new Response(JSON.stringify({ status: "ok" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    };
    const client = createApiClient("https://api.fountainrank.com", { fetch: fetchMock });
    // Attempt the bypass Codex flagged: inject middleware that re-adds X-Dev-*
    // AFTER any client-level handling. The sanitizing fetch (which runs last) and
    // the facade's stripping of the per-request `middleware` key both defeat it.
    await client.GET("/healthz", {
      middleware: [
        {
          onRequest({ request }) {
            request.headers.set("X-Dev-User", "evil");
            return request;
          },
        },
      ],
    });
    expect(sentKeys.some((k) => k.startsWith("x-dev"))).toBe(false);
  });

  it("ignores a per-request fetch override so it cannot bypass the sanitizer (spec section 14)", async () => {
    let safeFetchUsed = false;
    let unsafeFetchUsed = false;
    const ok = () =>
      new Response(JSON.stringify({ status: "ok" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    const safeFetch: typeof fetch = async () => {
      safeFetchUsed = true;
      return ok();
    };
    const unsafeFetch: typeof fetch = async () => {
      unsafeFetchUsed = true;
      return ok();
    };
    const client = createApiClient("https://api.fountainrank.com", { fetch: safeFetch });
    // The facade strips the per-request `fetch`, so the configured (sanitizing)
    // fetch is used and the caller's override is ignored.
    await client.GET("/healthz", { fetch: unsafeFetch });
    expect(safeFetchUsed).toBe(true);
    expect(unsafeFetchUsed).toBe(false);
  });

  it("does not expose openapi-fetch middleware hooks (no use/eject)", () => {
    const client = createApiClient("https://api.fountainrank.com");
    expect("use" in client).toBe(false);
    expect("eject" in client).toBe(false);
  });

  it("rejects with a non-ApiError (no HTTP status) when the network fails - the offline path", async () => {
    const fetchMock: typeof fetch = async () => {
      throw new TypeError("Network request failed");
    };
    const client = createApiClient("https://api.fountainrank.com", { fetch: fetchMock });
    // A thrown rejection with no numeric `.status` is what resolveViewState maps
    // to "offline" (vs an ApiError's "error"). Asserting "not ApiError" is robust
    // regardless of whether openapi-fetch rethrows or wraps the network error.
    await expect(client.GET("/healthz")).rejects.not.toBeInstanceOf(ApiError);
  });

  it("unwraps a 5xx from the real client as ApiError(status) - the error path", async () => {
    const fetchMock: typeof fetch = async () => new Response("boom", { status: 500 });
    const client = createApiClient("https://api.fountainrank.com", { fetch: fetchMock });
    const result = await client.GET("/healthz");
    try {
      unwrap(result);
      throw new Error("expected unwrap to throw");
    } catch (e) {
      expect(e).toBeInstanceOf(ApiError);
      expect((e as ApiError).status).toBe(500);
    }
  });
});
```

- [ ] **Step 2: Run it; verify it fails** (module not found):

```bash
pnpm --filter mobile exec vitest run lib/api.test.ts
```
Expected: FAIL.

- [ ] **Step 3: Implement** — `mobile/lib/api.ts` (no Expo/RN imports — `@fountainrank/api-client` is openapi-fetch, node-safe):

```ts
import { makeClient, type ApiClient } from "@fountainrank/api-client";

/**
 * Build the auth headers for an authenticated mobile request.
 *
 * SECURITY (spec section 14): the mobile app authenticates ONLY with a Logto
 * bearer token. This builder is structurally incapable of emitting the dev-auth
 * seam headers (X-Dev-User / X-Dev-Email / X-Dev-Name) in any build profile. The
 * 6e-5 Logto integration attaches the result via openapi-fetch middleware and
 * must never add an X-Dev-* header.
 */
export function buildAuthHeaders(token: string | null | undefined): Record<string, string> {
  if (typeof token !== "string" || token.length === 0) {
    return {};
  }
  return { Authorization: `Bearer ${token}` };
}

/**
 * An HTTP-level API error carrying the response status. Network failures are
 * NOT instances of this - they reject inside openapi-fetch as the underlying
 * fetch error (no status), so `resolveViewState` can distinguish "offline"
 * (no status) from "server error" (has status).
 */
export class ApiError extends Error {
  constructor(public readonly status: number, message?: string) {
    super(message ?? `Request failed with status ${status}`);
    this.name = "ApiError";
  }
}

type FetchResult<T> = { data?: T; error?: unknown; response: Response };

/**
 * Unwrap an openapi-fetch result: return `data` on success, or throw
 * `ApiError(status)` on an HTTP error. (A network-level failure rejects inside
 * openapi-fetch before this runs, surfacing as a non-ApiError to the caller.)
 */
export function unwrap<T>(result: FetchResult<T>): T {
  const { data, error, response } = result;
  if (!response.ok || error !== undefined) {
    throw new ApiError(response.status);
  }
  return data as T;
}

/**
 * The mobile-safe API surface: only the HTTP verbs the app uses, with NO access
 * to openapi-fetch's `use`/`eject` middleware hooks.
 */
export type MobileApiClient = Pick<ApiClient, "GET" | "POST" | "PUT" | "PATCH" | "DELETE">;

/**
 * Build the mobile API client from validated config. Auth-unavailable mode
 * (slice 6e-2): no token provider, so requests carry no auth header at all.
 *
 * SECURITY (spec section 14) - ENFORCED and NON-BYPASSABLE: the generated client
 * exposes X-Dev-User/Email/Name header params on write/auth operations (e.g.
 * GET /api/v1/me, POST /api/v1/fountains, POST /api/v1/me/sync). Two layers
 * guarantee the mobile app can never emit the dev-auth seam, in any build
 * profile:
 *   1. A sanitizing `fetch` wraps the configured fetch and deletes ANY x-dev*
 *      header immediately before the network call. Because openapi-fetch invokes
 *      the configured fetch AFTER every middleware (global and per-request), this
 *      catches x-dev headers from generated params OR from any middleware.
 *   2. A narrowed facade re-exposes only GET/POST/PUT/PATCH/DELETE and strips the
 *      per-request `fetch`/`middleware` escape hatches from each call's init, so a
 *      caller cannot swap in a fetch/middleware that bypasses layer 1. `use`/
 *      `eject` are not exposed at all.
 *
 * The optional `options` pass-through (typed off `makeClient`) lets tests inject
 * a `fetch`. It is NOT a middleware hook; slice 6e-5 extends this factory with a
 * Logto token-provider path using `buildAuthHeaders`, keeping the sanitizer.
 */
export function createApiClient(
  baseUrl: string,
  options?: Parameters<typeof makeClient>[1],
): MobileApiClient {
  const baseFetch = options?.fetch ?? ((input: Request) => globalThis.fetch(input));
  const sanitizingFetch = async (input: Request): Promise<Response> => {
    for (const key of [...input.headers.keys()]) {
      if (key.toLowerCase().startsWith("x-dev")) {
        input.headers.delete(key);
      }
    }
    return baseFetch(input);
  };

  const client = makeClient(baseUrl, { ...options, fetch: sanitizingFetch });

  const guard = <V extends "GET" | "POST" | "PUT" | "PATCH" | "DELETE">(verb: V): ApiClient[V] => {
    const method = client[verb] as unknown as (path: unknown, init?: unknown) => unknown;
    const wrapped = (path: unknown, init?: unknown) => {
      let safeInit = init;
      if (init && typeof init === "object") {
        safeInit = { ...(init as Record<string, unknown>) };
        // Strip the escape hatches so a caller cannot bypass `sanitizingFetch`.
        delete (safeInit as Record<string, unknown>).fetch;
        delete (safeInit as Record<string, unknown>).middleware;
      }
      return method(path, safeInit);
    };
    return wrapped as unknown as ApiClient[V];
  };

  return {
    GET: guard("GET"),
    POST: guard("POST"),
    PUT: guard("PUT"),
    PATCH: guard("PATCH"),
    DELETE: guard("DELETE"),
  };
}
```

- [ ] **Step 4: Run it; verify it passes:**

```bash
pnpm --filter mobile exec vitest run lib/api.test.ts
```
Expected: PASS.

- [ ] **Step 5: Lint + typecheck (fast):**

```bash
powershell.exe -NoProfile -ExecutionPolicy Bypass -File run.ps1 check -Mobile -Fast
```
Expected: PASS.

- [ ] **Step 6: Commit:**

```bash
git add mobile/lib/api.ts mobile/lib/api.test.ts
git commit -m "feat(mobile): release-safe api client + no-X-Dev auth-header contract (slice 6e-2)"
```

---

### Task 5: `resolveViewState` — server-state → UI state

**Files:**
- Create: `mobile/lib/view-state.ts`
- Test: `mobile/lib/view-state.test.ts`

**Interfaces:**
- Produces: `type ViewState = "loading" | "offline" | "error" | "empty" | "ready"`; `type ViewStateInput = { isLoading: boolean; isError: boolean; error?: unknown; isEmpty?: boolean }`; `resolveViewState(input: ViewStateInput): ViewState`. Consumed by `QueryStateView.tsx` (Task 6).

- [ ] **Step 1: Write the failing test** — `mobile/lib/view-state.test.ts` (imports `ApiError` from Task 4 to model an HTTP error):

```ts
import { describe, expect, it } from "vitest";

import { ApiError } from "./api";
import { resolveViewState } from "./view-state";

describe("resolveViewState", () => {
  it("is loading while the query is pending", () => {
    expect(resolveViewState({ isLoading: true, isError: false })).toBe("loading");
  });

  it("is offline for a network error with no HTTP status", () => {
    const err = new TypeError("Network request failed");
    expect(resolveViewState({ isLoading: false, isError: true, error: err })).toBe("offline");
  });

  it("is error for an HTTP error carrying a status (ApiError)", () => {
    expect(resolveViewState({ isLoading: false, isError: true, error: new ApiError(500) })).toBe(
      "error",
    );
  });

  it("is empty when the result set is empty", () => {
    expect(resolveViewState({ isLoading: false, isError: false, isEmpty: true })).toBe("empty");
  });

  it("is ready when data is present", () => {
    expect(resolveViewState({ isLoading: false, isError: false, isEmpty: false })).toBe("ready");
  });

  it("treats loading as taking precedence over a stale error", () => {
    expect(resolveViewState({ isLoading: true, isError: true, error: new ApiError(500) })).toBe(
      "loading",
    );
  });
});
```

- [ ] **Step 2: Run it; verify it fails:**

```bash
pnpm --filter mobile exec vitest run lib/view-state.test.ts
```
Expected: FAIL.

- [ ] **Step 3: Implement** — `mobile/lib/view-state.ts` (pure; duck-types the HTTP status so it does not need `instanceof`/imports):

```ts
export type ViewState = "loading" | "offline" | "error" | "empty" | "ready";

export type ViewStateInput = {
  isLoading: boolean;
  isError: boolean;
  error?: unknown;
  isEmpty?: boolean;
};

/**
 * Map a TanStack-Query-style result into a discrete UI state. An error that
 * carries a numeric HTTP `status` (an ApiError) is a server-side "error"; an
 * error without one is a network "offline" failure.
 */
export function resolveViewState(input: ViewStateInput): ViewState {
  if (input.isLoading) return "loading";
  if (input.isError) {
    const status = (input.error as { status?: unknown } | null | undefined)?.status;
    return typeof status === "number" ? "error" : "offline";
  }
  if (input.isEmpty) return "empty";
  return "ready";
}
```

- [ ] **Step 4: Run it; verify it passes:**

```bash
pnpm --filter mobile exec vitest run lib/view-state.test.ts
```
Expected: PASS (6 cases).

- [ ] **Step 5: Commit:**

```bash
git add mobile/lib/view-state.ts mobile/lib/view-state.test.ts
git commit -m "feat(mobile): resolveViewState server-state-to-UI mapper (slice 6e-2)"
```

---

### Task 6: Mobile design system + state components

Establishes the mobile component system the 6e-1 style-guide note promised. Presentational only (no unit tests — the testable logic lives in `resolveViewState`).

**Files:**
- Create: `mobile/theme.ts`
- Create: `mobile/components/ScreenContainer.tsx`
- Create: `mobile/components/states/LoadingState.tsx`, `EmptyState.tsx`, `ErrorState.tsx`, `OfflineState.tsx`, `QueryStateView.tsx`

**Interfaces:**
- Produces: `colors`/`spacing`/`typography` tokens; `<ScreenContainer>`; `<LoadingState>`, `<EmptyState>`, `<ErrorState>`, `<OfflineState>`; `<QueryStateView input onRetry emptyLabel>{ready}</QueryStateView>`. Consumed by every screen (Tasks 7–9).

- [ ] **Step 1: Create the theme tokens** — `mobile/theme.ts` (brand palette matches the web: `#0A357E` blue, `#F2C200` yellow):

```ts
export const colors = {
  brandBlue: "#0A357E",
  brandYellow: "#F2C200",
  brandYellowHover: "#FFCE1F",
  text: "#0F172A",
  textMuted: "#475569",
  background: "#FFFFFF",
  surface: "#F8FAFC",
  border: "#E2E8F0",
  danger: "#B91C1C",
  onBrand: "#FFFFFF",
} as const;

export const spacing = { xs: 4, sm: 8, md: 16, lg: 24, xl: 32 } as const;

export const typography = {
  title: { fontSize: 24, fontWeight: "700" as const },
  heading: { fontSize: 18, fontWeight: "600" as const },
  body: { fontSize: 15, fontWeight: "400" as const },
  meta: { fontSize: 12, fontWeight: "400" as const },
} as const;
```

- [ ] **Step 2: Create `mobile/components/ScreenContainer.tsx`** (safe-area-aware screen frame). Screens rendered under a navigator header omit the top inset (the header handles it); **headerless** screens — the root invalid-config branch — opt in via `includeTopInset` so content clears the status bar/notch:

```tsx
import type { ReactNode } from "react";
import { StyleSheet, View } from "react-native";
import { SafeAreaView, type Edge } from "react-native-safe-area-context";

import { colors, spacing } from "../theme";

export function ScreenContainer({
  children,
  includeTopInset = false,
}: {
  children: ReactNode;
  includeTopInset?: boolean;
}) {
  const edges: Edge[] = includeTopInset
    ? ["top", "left", "right", "bottom"]
    : ["left", "right", "bottom"];
  return (
    <SafeAreaView style={styles.safe} edges={edges}>
      <View style={styles.body}>{children}</View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.background },
  body: { flex: 1, padding: spacing.lg },
});
```

- [ ] **Step 3: Create `mobile/components/states/LoadingState.tsx`:**

```tsx
import { ActivityIndicator, StyleSheet, Text, View } from "react-native";

import { colors, spacing } from "../../theme";

export function LoadingState({ label = "Loading..." }: { label?: string }) {
  return (
    <View style={styles.center}>
      <ActivityIndicator color={colors.brandBlue} />
      <Text style={styles.label}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: "center", justifyContent: "center" },
  label: { marginTop: spacing.sm, color: colors.textMuted },
});
```

- [ ] **Step 4: Create `mobile/components/states/EmptyState.tsx`:**

```tsx
import { StyleSheet, Text, View } from "react-native";

import { colors } from "../../theme";

export function EmptyState({ label = "Nothing here yet." }: { label?: string }) {
  return (
    <View style={styles.center}>
      <Text style={styles.label}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: "center", justifyContent: "center" },
  label: { color: colors.textMuted, fontSize: 15, textAlign: "center" },
});
```

- [ ] **Step 5: Create `mobile/components/states/ErrorState.tsx`** (with optional retry):

```tsx
import { Pressable, StyleSheet, Text, View } from "react-native";

import { colors, spacing } from "../../theme";

export function ErrorState({
  label = "Something went wrong.",
  onRetry,
}: {
  label?: string;
  onRetry?: () => void;
}) {
  return (
    <View style={styles.center}>
      <Text style={styles.label}>{label}</Text>
      {onRetry ? (
        <Pressable style={styles.button} onPress={onRetry} accessibilityRole="button">
          <Text style={styles.buttonLabel}>Try again</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: "center", justifyContent: "center" },
  label: { color: colors.danger, fontSize: 15, textAlign: "center", marginBottom: spacing.md },
  button: {
    backgroundColor: colors.brandBlue,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.lg,
    borderRadius: 999,
  },
  buttonLabel: { color: colors.onBrand, fontWeight: "600" },
});
```

- [ ] **Step 6: Create `mobile/components/states/OfflineState.tsx`:**

```tsx
import { Pressable, StyleSheet, Text, View } from "react-native";

import { colors, spacing } from "../../theme";

export function OfflineState({ onRetry }: { onRetry?: () => void }) {
  return (
    <View style={styles.center}>
      <Text style={styles.label}>You appear to be offline.</Text>
      {onRetry ? (
        <Pressable style={styles.button} onPress={onRetry} accessibilityRole="button">
          <Text style={styles.buttonLabel}>Retry</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: "center", justifyContent: "center" },
  label: { color: colors.textMuted, fontSize: 15, textAlign: "center", marginBottom: spacing.md },
  button: {
    backgroundColor: colors.brandBlue,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.lg,
    borderRadius: 999,
  },
  buttonLabel: { color: colors.onBrand, fontWeight: "600" },
});
```

- [ ] **Step 7: Create `mobile/components/states/QueryStateView.tsx`** (the glue: `resolveViewState` drives the presentational switch):

```tsx
import type { ReactNode } from "react";

import { resolveViewState, type ViewStateInput } from "../../lib/view-state";
import { EmptyState } from "./EmptyState";
import { ErrorState } from "./ErrorState";
import { LoadingState } from "./LoadingState";
import { OfflineState } from "./OfflineState";

export function QueryStateView({
  input,
  onRetry,
  emptyLabel,
  children,
}: {
  input: ViewStateInput;
  onRetry?: () => void;
  emptyLabel?: string;
  children: ReactNode;
}) {
  switch (resolveViewState(input)) {
    case "loading":
      return <LoadingState />;
    case "offline":
      return <OfflineState onRetry={onRetry} />;
    case "error":
      return <ErrorState onRetry={onRetry} />;
    case "empty":
      return <EmptyState label={emptyLabel} />;
    case "ready":
      return <>{children}</>;
  }
}
```

- [ ] **Step 8: Lint + typecheck (fast):**

```bash
powershell.exe -NoProfile -ExecutionPolicy Bypass -File run.ps1 check -Mobile -Fast
```
Expected: PASS. (Vitest still runs the 4 pure suites; the components are typecheck/lint covered.)

- [ ] **Step 9: Format + commit:**

```bash
pnpm exec prettier --write mobile/theme.ts mobile/components/
git add mobile/theme.ts mobile/components/
git commit -m "feat(mobile): design tokens + loading/empty/error/offline state components (slice 6e-2)"
```

---

### Task 7: TanStack Query + ApiProvider + root layout (providers + config guard)

**Files:**
- Modify: `mobile/package.json` (add `@tanstack/react-query`), `pnpm-lock.yaml`
- Create: `mobile/providers/api-provider.tsx`
- Replace: `mobile/app/_layout.tsx` (minimal → providers + config guard)

**Interfaces:**
- Produces: `<ApiProvider config>` + `useApi(): { config: MobileConfig; client: MobileApiClient }`; a root layout wrapping the app in `SafeAreaProvider` + `QueryClientProvider` + `ApiProvider`, rendering an invalid-config screen when the runtime config fails to parse. Consumed by every screen (Tasks 8–9).

- [ ] **Step 1: Add `@tanstack/react-query@5.101.0`** to `mobile/package.json` `dependencies` (latest stable v5; React 19-compatible; covered by the existing `listUnknownPackages: false` doctor block). Then install (lockfile changes), from Git Bash:

```bash
# add "@tanstack/react-query": "5.101.0" to mobile/package.json dependencies, then:
CI=true pnpm install --no-frozen-lockfile
```
Expected: `@tanstack/react-query` resolves under `mobile/node_modules`; `pnpm-lock.yaml` updated.

- [ ] **Step 2: Create `mobile/providers/api-provider.tsx`** (single shared client built from validated config; ready for 6e-5 to add a token provider):

```tsx
import { createContext, useContext, useMemo, type ReactNode } from "react";

import { createApiClient, type MobileApiClient } from "../lib/api";
import type { MobileConfig } from "../lib/config";

type ApiContextValue = { config: MobileConfig; client: MobileApiClient };

const ApiContext = createContext<ApiContextValue | null>(null);

export function ApiProvider({ config, children }: { config: MobileConfig; children: ReactNode }) {
  const value = useMemo<ApiContextValue>(
    () => ({ config, client: createApiClient(config.apiBaseUrl) }),
    [config],
  );
  return <ApiContext.Provider value={value}>{children}</ApiContext.Provider>;
}

export function useApi(): ApiContextValue {
  const ctx = useContext(ApiContext);
  if (!ctx) {
    throw new Error("useApi must be used within an ApiProvider");
  }
  return ctx;
}
```

- [ ] **Step 3: Replace `mobile/app/_layout.tsx`** — parse config once at module scope (mirrors the 6e-1 guard), render an invalid-config screen on failure, otherwise wrap a **bare `<Stack>`** in the providers. **The root Stack does NOT enumerate `<Stack.Screen>` children** — Expo Router auto-registers routes from the file tree, so this layout is valid at this checkpoint (only `app/index.tsx` exists) and never names a route before its file exists. Default `headerShown: false`; each pushed route (detail, diagnostics, not-found, created in Tasks 8–9) opts its own header in locally via `<Stack.Screen options={...} />`. The headerless invalid-config branch passes `includeTopInset`:

```tsx
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import Constants from "expo-constants";
import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { StyleSheet, Text, View } from "react-native";
import { SafeAreaProvider } from "react-native-safe-area-context";

import { ScreenContainer } from "../components/ScreenContainer";
import { parseMobileConfig, type MobileConfig } from "../lib/config";
import { ApiProvider } from "../providers/api-provider";
import { colors, typography } from "../theme";

const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: 1, refetchOnWindowFocus: false } },
});

let mobileConfig: MobileConfig | null;
let configError: string | null;
try {
  mobileConfig = parseMobileConfig(Constants.expoConfig?.extra);
  configError = null;
} catch (err) {
  mobileConfig = null;
  configError = err instanceof Error ? err.message : "Invalid mobile configuration";
}

export default function RootLayout() {
  if (!mobileConfig) {
    return (
      <SafeAreaProvider>
        <ScreenContainer includeTopInset>
          <View style={styles.center}>
            <Text style={styles.title}>FountainRank</Text>
            <Text style={styles.error}>Configuration error: {configError}</Text>
          </View>
        </ScreenContainer>
        <StatusBar style="dark" />
      </SafeAreaProvider>
    );
  }

  return (
    <SafeAreaProvider>
      <QueryClientProvider client={queryClient}>
        <ApiProvider config={mobileConfig}>
          <Stack screenOptions={{ headerShown: false }} />
          <StatusBar style="dark" />
        </ApiProvider>
      </QueryClientProvider>
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: "center", justifyContent: "center" },
  title: { ...typography.title, color: colors.brandBlue, marginBottom: 8 },
  error: { color: colors.danger, textAlign: "center" },
});
```

- [ ] **Step 4: Lint + typecheck + expo-doctor** (full mobile check — adds the new dep to doctor's view):

```bash
powershell.exe -NoProfile -ExecutionPolicy Bypass -File run.ps1 check -Mobile
```
Expected: PASS. The root layout references no route by name, so this checkpoint matches the on-disk tree (`app/index.tsx` is still the minimal Task-2 placeholder). The `(tabs)`/`fountains`/`diagnostics` routes arrive in Tasks 8–9 and set their own header options locally.

- [ ] **Step 5: Format + commit:**

```bash
pnpm exec prettier --write mobile/providers/api-provider.tsx mobile/app/_layout.tsx
git add mobile/package.json pnpm-lock.yaml mobile/providers/api-provider.tsx mobile/app/_layout.tsx
git commit -m "feat(mobile): TanStack Query + ApiProvider + config-guarded root layout (slice 6e-2)"
```

---

### Task 8: Tab navigator + scaffolded screens (map, add, account, detail, not-found)

**Files:**
- Create: `mobile/app/(tabs)/_layout.tsx`
- Move/replace: `mobile/app/index.tsx` → `mobile/app/(tabs)/index.tsx` (Map scaffold)
- Create: `mobile/app/(tabs)/add.tsx`, `mobile/app/(tabs)/account.tsx`, `mobile/app/fountains/[id].tsx`, `mobile/app/+not-found.tsx`

**Interfaces:**
- Consumes: `ScreenContainer`, `EmptyState` (Task 6), `useApi` + `isAuthConfigured` (Tasks 7, 3).
- Produces: a bottom-tab shell (Map · Add · Account), a stack-pushed fountain detail, and a 404 route. Every screen is a scaffold for its later slice.

- [ ] **Step 1: Remove the placeholder home route** (it becomes a tab):

```bash
git rm mobile/app/index.tsx
```

- [ ] **Step 2: Create the tab navigator** — `mobile/app/(tabs)/_layout.tsx`. Tabs render their own headers (the root Stack hid its header for this group via the default `headerShown: false`), and each tab gets an Ionicon (`@expo/vector-icons`, added in Task 2):

```tsx
import { Ionicons } from "@expo/vector-icons";
import { Tabs } from "expo-router";

import { colors } from "../../theme";

export default function TabsLayout() {
  return (
    <Tabs screenOptions={{ tabBarActiveTintColor: colors.brandBlue, headerShown: true }}>
      <Tabs.Screen
        name="index"
        options={{
          title: "Map",
          tabBarIcon: ({ color, size }) => <Ionicons name="map" color={color} size={size} />,
        }}
      />
      <Tabs.Screen
        name="add"
        options={{
          title: "Add",
          tabBarIcon: ({ color, size }) => (
            <Ionicons name="add-circle" color={color} size={size} />
          ),
        }}
      />
      <Tabs.Screen
        name="account"
        options={{
          title: "Account",
          tabBarIcon: ({ color, size }) => (
            <Ionicons name="person-circle" color={color} size={size} />
          ),
        }}
      />
    </Tabs>
  );
}
```

- [ ] **Step 3: Create the Map scaffold** — `mobile/app/(tabs)/index.tsx` (links prove navigation to detail + diagnostics; real map is 6e-3):

```tsx
import { Link } from "expo-router";
import { StyleSheet, Text, View } from "react-native";

import { ScreenContainer } from "../../components/ScreenContainer";
import { colors, spacing, typography } from "../../theme";

export default function MapScreen() {
  return (
    <ScreenContainer>
      <View style={styles.body}>
        <Text style={styles.title}>Map</Text>
        <Text style={styles.note}>
          The interactive map and nearby fountains arrive in slice 6e-3.
        </Text>
        <Link href="/fountains/sample" style={styles.link}>
          Preview a fountain detail
        </Link>
        <Link href="/diagnostics" style={styles.link}>
          Diagnostics
        </Link>
      </View>
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  body: { flex: 1, gap: spacing.md },
  title: { ...typography.title, color: colors.brandBlue },
  note: { ...typography.body, color: colors.textMuted },
  link: { ...typography.body, color: colors.brandBlue, fontWeight: "600" },
});
```

- [ ] **Step 4: Create the Add scaffold** — `mobile/app/(tabs)/add.tsx`:

```tsx
import { ScreenContainer } from "../../components/ScreenContainer";
import { EmptyState } from "../../components/states/EmptyState";

export default function AddScreen() {
  return (
    <ScreenContainer>
      <EmptyState label="Adding a fountain becomes available once sign-in ships (slice 6e-7)." />
    </ScreenContainer>
  );
}
```

- [ ] **Step 5: Create the Account scaffold** — `mobile/app/(tabs)/account.tsx` (honest public-read state driven by `isAuthConfigured`):

```tsx
import { Link } from "expo-router";
import { StyleSheet, Text, View } from "react-native";

import { ScreenContainer } from "../../components/ScreenContainer";
import { isAuthConfigured } from "../../lib/config";
import { useApi } from "../../providers/api-provider";
import { colors, spacing, typography } from "../../theme";

export default function AccountScreen() {
  const { config } = useApi();
  const authReady = isAuthConfigured(config);

  return (
    <ScreenContainer>
      <View style={styles.body}>
        <Text style={styles.title}>Account</Text>
        {authReady ? (
          <Text style={styles.note}>Sign-in UI ships in slice 6e-5.</Text>
        ) : (
          <Text style={styles.note}>
            Browsing FountainRank in public mode. Sign-in is not yet available in this build; rating
            and adding fountains arrive in a later release.
          </Text>
        )}
        <Link href="/diagnostics" style={styles.link}>
          Diagnostics
        </Link>
      </View>
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  body: { flex: 1, gap: spacing.md },
  title: { ...typography.title, color: colors.brandBlue },
  note: { ...typography.body, color: colors.textMuted },
  link: { ...typography.body, color: colors.brandBlue, fontWeight: "600" },
});
```

- [ ] **Step 6: Create the Detail scaffold** — `mobile/app/fountains/[id].tsx`:

```tsx
import { Stack, useLocalSearchParams } from "expo-router";
import { StyleSheet, Text, View } from "react-native";

import { ScreenContainer } from "../../components/ScreenContainer";
import { colors, spacing, typography } from "../../theme";

export default function FountainDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();

  return (
    <ScreenContainer>
      <Stack.Screen options={{ headerShown: true, title: "Fountain" }} />
      <View style={styles.body}>
        <Text style={styles.title}>Fountain</Text>
        <Text style={styles.meta}>id: {id}</Text>
        <Text style={styles.note}>
          Fountain detail (rating, status, attributes, notes) arrives in slice 6e-4.
        </Text>
      </View>
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  body: { flex: 1, gap: spacing.sm },
  title: { ...typography.title, color: colors.brandBlue },
  meta: { ...typography.meta, color: colors.textMuted },
  note: { ...typography.body, color: colors.textMuted },
});
```

- [ ] **Step 7: Create the 404 route** — `mobile/app/+not-found.tsx`:

```tsx
import { Link, Stack } from "expo-router";
import { StyleSheet, Text } from "react-native";

import { ScreenContainer } from "../components/ScreenContainer";
import { colors, spacing, typography } from "../theme";

export default function NotFound() {
  return (
    <ScreenContainer>
      <Stack.Screen options={{ headerShown: true, title: "Not found" }} />
      <Text style={styles.title}>Not found</Text>
      <Link href="/" style={styles.link}>
        Go to the map
      </Link>
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  title: { ...typography.title, color: colors.brandBlue, marginBottom: spacing.md },
  link: { ...typography.body, color: colors.brandBlue, fontWeight: "600" },
});
```

- [ ] **Step 8: Lint + typecheck + expo-doctor:**

```bash
powershell.exe -NoProfile -ExecutionPolicy Bypass -File run.ps1 check -Mobile
```
Expected: PASS. If ESLint flags import order, order external (`@expo/vector-icons`, `expo-router`, `react-native`, `react-native-safe-area-context`) before internal (`../...`). All on-screen copy is ASCII with no apostrophes, so `react/no-unescaped-entities` has nothing to flag.

- [ ] **Step 9: Format + commit:**

```bash
pnpm exec prettier --write mobile/app/
git add mobile/app/
git commit -m "feat(mobile): tab navigator + map/add/account/detail/not-found scaffolds (slice 6e-2)"
```

---

### Task 9: Diagnostics screen (functional `GET /healthz` via TanStack Query)

The one functional screen — proves config → client → query → unwrap → view-state end-to-end. Carries forward the 6e-1 diagnostics info (app version/build + public API base URL).

**Files:**
- Create: `mobile/app/diagnostics.tsx`

**Interfaces:**
- Consumes: `useApi` (Task 7), `unwrap` (Task 4), `QueryStateView` (Task 6), `formatBuildInfo` (6e-1), `useQuery` (TanStack Query).

- [ ] **Step 1: Create `mobile/app/diagnostics.tsx`:**

```tsx
import { useQuery } from "@tanstack/react-query";
import Constants from "expo-constants";
import { Stack } from "expo-router";
import { Platform, StyleSheet, Text, View } from "react-native";

import { ScreenContainer } from "../components/ScreenContainer";
import { QueryStateView } from "../components/states/QueryStateView";
import { unwrap } from "../lib/api";
import { formatBuildInfo } from "../lib/build-info";
import { useApi } from "../providers/api-provider";
import { colors, spacing, typography } from "../theme";

export default function DiagnosticsScreen() {
  const { client, config } = useApi();
  const health = useQuery({
    queryKey: ["healthz"],
    queryFn: async () => unwrap(await client.GET("/healthz")),
  });

  const versionCode = Constants.expoConfig?.android?.versionCode;
  const buildLabel = formatBuildInfo(
    Constants.expoConfig?.version,
    Platform.OS === "ios"
      ? Constants.expoConfig?.ios?.buildNumber
      : versionCode != null
        ? String(versionCode)
        : null,
  );

  return (
    <ScreenContainer>
      <Stack.Screen options={{ headerShown: true, title: "Diagnostics" }} />
      <View style={styles.body}>
        <Text style={styles.title}>Diagnostics</Text>
        <Text style={styles.meta}>{buildLabel}</Text>
        <Text style={styles.meta}>{config.apiBaseUrl}</Text>
        <View style={styles.statusBox}>
          <QueryStateView
            input={{ isLoading: health.isLoading, isError: health.isError, error: health.error }}
            onRetry={() => {
              void health.refetch();
            }}
          >
            <Text style={styles.ok}>Backend reachable</Text>
          </QueryStateView>
        </View>
      </View>
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  body: { flex: 1, gap: spacing.sm },
  title: { ...typography.title, color: colors.brandBlue },
  meta: { ...typography.meta, color: colors.textMuted },
  statusBox: { height: 140, marginTop: spacing.md },
  ok: { ...typography.body, color: colors.brandBlue, textAlign: "center", marginTop: spacing.lg },
});
```

- [ ] **Step 2: Lint + typecheck + expo-doctor:**

```bash
powershell.exe -NoProfile -ExecutionPolicy Bypass -File run.ps1 check -Mobile
```
Expected: PASS. If `client.GET("/healthz")` mis-types, confirm `/healthz` exists in `packages/api-client/src/schema.d.ts` (it did in 6e-1's `App.tsx`); `unwrap` infers the data type from the result.

- [ ] **Step 3: Format + commit:**

```bash
pnpm exec prettier --write mobile/app/diagnostics.tsx
git add mobile/app/diagnostics.tsx
git commit -m "feat(mobile): diagnostics screen — healthz via TanStack Query (slice 6e-2)"
```

---

### Task 10: Docs — README + mobile design-system style guide

**Files:**
- Modify: `mobile/README.md`
- Modify: `docs/style-guide.md`

- [ ] **Step 1: Update `mobile/README.md`** — replace the 6e-1 "Common commands"/diagnostics framing with the app-shell structure (keep the runtime-config + store-testing sections; update the intro + add a navigation section):

````markdown
# FountainRank Mobile

Expo SDK 56 / React Native app. **Expo Router** (file-based `app/` tree) for
navigation, **TanStack Query** over `@fountainrank/api-client` for server state.
Release builds target the deployed production services
(`https://api.fountainrank.com`, `https://auth.fountainrank.com`).

## App structure

```
app/
  _layout.tsx          providers (SafeArea + QueryClient + ApiProvider) + config guard
  (tabs)/              bottom tabs: Map · Add · Account
  fountains/[id].tsx   fountain detail (stack-pushed)
  diagnostics.tsx      backend reachability + version/build
components/            ScreenContainer + loading/empty/error/offline states
lib/                   pure, unit-tested helpers (config, api, view-state, build-info)
providers/             ApiProvider (shared API client from validated config)
theme.ts               design tokens
```

Most screens are scaffolds for later slices (map → 6e-3, detail → 6e-4, auth →
6e-5, add → 6e-7). The app runs in **Expo Go** through 6e-2; the MapLibre native
map in 6e-3 ends Expo Go support (dev-client / EAS build required from there).

## Common commands (run from the repo root)

```bash
pnpm --filter @fountainrank/api-client run generate  # refresh API types from the backend
pnpm --filter mobile run start         # Expo dev server (Metro)
pnpm --filter mobile run lint
pnpm --filter mobile run typecheck
pnpm --filter mobile run test          # Vitest (pure helpers)
```

Local CI mirror for mobile: `./run.ps1 check -Mobile` (lint + typecheck + vitest
+ `expo-doctor`).

## Runtime configuration

Non-secret client config lives in `app.config.ts` under `extra` and is validated
at startup by `lib/config.ts`. Defaults point at production; override for an
alternate HTTPS endpoint with `EXPO_PUBLIC_API_BASE_URL` /
`EXPO_PUBLIC_LOGTO_ENDPOINT` / `EXPO_PUBLIC_LOGTO_AUDIENCE`. URLs must be
`https://` (local cleartext is not supported in this slice). Sign-in stays
disabled (public-read mode) until a Logto Native app id is configured
(`isAuthConfigured`), which arrives with the owner-gated auth records (6e-9).

## Store-testing builds (EAS)

`eas.json` defines `development` / `preview` / `production` build profiles and a
credential-free `production` submit profile (Android `internal` track). Producing
and submitting store binaries requires an Expo/EAS account and `eas init`
(owner-gated — see the umbrella spec
`docs/specs/2026-06-23-mobile-store-testing-distribution-design.md`, slice 6e-8).
No build/submit runs as part of this slice.
````

- [ ] **Step 2: Update `docs/style-guide.md`** — read the existing `## Mobile (React Native)` section first, then replace its body (the temporary-diagnostics note) with the real component system. New section content:

```markdown
## Mobile (React Native)

The mobile app (Expo / React Native) has its own component system (slice 6e-2).
It does **not** use the web Tailwind classes above; styling is React Native
`StyleSheet` with shared tokens in `mobile/theme.ts`.

### Design tokens (`mobile/theme.ts`)

- `colors` — brand `brandBlue` `#0A357E` / `brandYellow` `#F2C200`
  (`brandYellowHover` `#FFCE1F`), `text` / `textMuted`, `background` / `surface`
  / `border`, `danger`, `onBrand`. Matches the web brand palette.
- `spacing` — `xs 4 · sm 8 · md 16 · lg 24 · xl 32`.
- `typography` — `title` / `heading` / `body` / `meta`.

### Layout

- **`ScreenContainer`** — safe-area-aware screen frame (`react-native-safe-area-context`)
  with standard padding. Wrap every screen's content in it.

### State components (`mobile/components/states/`)

Reusable async states, usable on small screens:

- **`LoadingState`** — spinner + label (default "Loading…").
- **`EmptyState`** — muted centered label for an empty result set.
- **`ErrorState`** — error label + optional "Try again" retry button.
- **`OfflineState`** — offline message + optional "Retry" button.
- **`QueryStateView`** — picks the right state component from a query result via
  the pure `resolveViewState` helper (`lib/view-state.ts`), rendering its
  children only in the `ready` state. "Offline" is a network failure with no HTTP
  status; "error" is an HTTP error (`ApiError`).

### Navigation

Expo Router: a bottom-tab group (`(tabs)`: Map · Add · Account) with
stack-pushed detail (`fountains/[id]`) and `diagnostics`. Sign-in affordances
stay hidden/disabled until `isAuthConfigured` is true (auth-unavailable mode,
spec §21).
```

- [ ] **Step 3: Format the touched files** — `mobile/README.md` IS covered by the root `format:check`; `docs/style-guide.md` is **not** (only `{web,mobile,packages}/**`), so format it explicitly:

```bash
pnpm exec prettier --write mobile/README.md docs/style-guide.md
```

- [ ] **Step 4: Commit:**

```bash
git add mobile/README.md docs/style-guide.md
git commit -m "docs(mobile): app-shell README + mobile design-system style guide (slice 6e-2)"
```

---

### Task 11: Full local CI mirror green + push (PR gate)

**Files:** none (verification; commit only if a formatter/lint fixup is needed).

- [ ] **Step 1: Run the FULL mirror** (backend + workspace-js + web build + mobile) — a cross-workspace contract break must not slip through:

```bash
powershell.exe -NoProfile -ExecutionPolicy Bypass -File run.ps1 check
```
Expected: every section green, ending "All requested checks passed." This needs the `db` container (auto-started) and `uv` (backend `generate`/pytest). If the pnpm store went dirty from a Codex run, recover first (see Global Constraints).

- [ ] **Step 2: Confirm a clean tree** (no stray formatter rewrites):

```bash
git status --short
```
Expected: empty. If Prettier rewrote anything tracked, `git add` + commit `chore(mobile): formatting (slice 6e-2)` and re-run Step 1.

- [ ] **Step 3: Push the branch:**

```bash
git push -u origin feat/mobile-6e-2-app-shell
```

Then open the PR and run **Codex Loop B** + address every PR comment + squash-merge per `claude_help/codex-review-process.md` and `claude_help/testing-ci.md`. **No DOKS deploy and no EAS build apply** — 6e-2 is mobile config/code only; merge-to-main is the delivery (proof level: Local CI, spec §21).

---

## Self-Review

**Spec coverage (slice 6e-2 per §18 + §15-Phase-2 + §14/§20/§21):**
- Navigation structure (Expo Router) → Task 2 (entry/boot) + Task 7 (root layout) + Task 8 (tabs/stack). ✓
- State-management pattern (TanStack Query) → Task 7 (provider) + Task 9 (first query). ✓
- Screen scaffolding (map, detail, add, sign-in/account, diagnostics) → Task 8 (map/add/account/detail) + Task 9 (diagnostics). ✓
- Shared release-safe API config building `@fountainrank/api-client` → Task 4 (`createApiClient`) + Task 7 (`ApiProvider`). ✓
- **No-`X-Dev-*` contract ENFORCED + NON-BYPASSABLE (§14)** → Task 4: `createApiClient` returns a narrowed `MobileApiClient` facade backed by a **sanitizing fetch** (strips `x-dev*` at the network boundary, after all middleware) and **strips the per-request `fetch`/`middleware` escape hatches**. Tested: `buildAuthHeaders` unit test; default-request clean; `X-Dev-*` on generated op `GET /api/v1/me` stripped; `X-Dev-*` injected by per-request middleware stripped; no `use`/`eject` exposed. A caller cannot emit the dev-auth seam through the wrapper by any path. ✓
- Loading / empty / offline / error states → Task 5 (`resolveViewState`) + Task 6 (state components) + Task 9 (wired in Diagnostics); the offline-vs-error split is proven at the real client boundary in Task 4 (rejecting fetch → thrown non-ApiError; 5xx → `ApiError(status)`). ✓
- **Route-tree consistency (independently verifiable tasks)** → the root `_layout.tsx` is a bare `<Stack>` (Task 7) that never names a route before its file exists; each pushed route sets its own header options locally (Tasks 8–9). ✓
- Pure-helper tests → Tasks 3, 4, 5 (config, api, view-state). ✓
- Auth-unavailable mode / no placeholder app id (§21) → Task 3 (`logtoAppId?` optional + `isAuthConfigured`) + Task 8 (Account public-read). ✓
- HTTPS-only / no secrets / no token-PII logging (§14, §20) → config validation unchanged; Diagnostics shows only app name/reachability/version/API base URL. ✓
- No external records / native-identity unchanged (§17) → no Apple/Play/Logto/Google record; bundle id/scheme unchanged. ✓
- MapLibre deferred to 6e-3; app still runs in Expo Go (§20) → Global Constraints; only Expo-Go-bundled deps added. ✓
- Proof level = Local CI (§21) → Task 11; honest "compiles/lints/type-checks/unit-tested," not "works on device." ✓
- Style guide updated for the new component system → Task 10. ✓

**Placeholder scan:** every code/test step has complete content; the only "scaffold" screens are intentional, fully-written placeholders whose copy names the slice that fills them in. No "TODO"/"handle errors"/"similar to Task N." ✓

**Type consistency:** `MobileConfig` (Task 3, with optional `logtoAppId?`) is consumed by `isAuthConfigured` (Task 3), `ApiProvider` (Task 7), and the Account screen (Task 8). `buildAuthHeaders`/`ApiError`/`unwrap`/`createApiClient` (Task 4) are consumed with matching signatures by `view-state.test.ts` (`ApiError`), `api-provider.tsx` (`createApiClient`), and `diagnostics.tsx` (`unwrap`). `ViewStateInput`/`resolveViewState` (Task 5) are consumed by `QueryStateView` (Task 6) and Diagnostics (Task 9). `useApi()` returns `{ config, client }` (Task 7), consumed by Account (Task 8) and Diagnostics (Task 9). `formatBuildInfo(version, build)` (6e-1) consumed unchanged by Diagnostics (Task 9). ✓

**Test isolation:** every Vitest-imported module (`config.ts`, `api.ts`, `view-state.ts`, `build-info.ts`) has zero RN/Expo imports — `api.ts`'s only import is `@fountainrank/api-client` (openapi-fetch, node-safe). Route files, components, and providers (which import `react-native`/`expo-*`) are never imported by a `*.test.ts`, so the `node`-env Vitest run stays clean. ✓
