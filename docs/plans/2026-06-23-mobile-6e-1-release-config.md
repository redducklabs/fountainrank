# Mobile slice 6e-1 — release config & app identity Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the mobile walking skeleton into a release-configurable app: kill the hard-coded `localhost` API URL behind a validated runtime config, establish the stable native identity + store versioning, add a mobile unit-test runner, an `eas.json`, and an app-version/build diagnostic surface — all green on the local CI mirror.

**Architecture:** All logic lives in **pure, unit-tested modules** with **zero Expo/native imports** (`mobile/lib/config.ts`, `mobile/lib/build-info.ts`) so they run under Vitest in a plain `node` environment. The Expo/native reads (`expo-constants`, `react-native` `Platform`) happen only in the thin, untested shell `App.tsx`, which delegates to the pure helpers. Non-secret client configuration is declared in a dynamic `app.config.ts` (`extra` block, overridable by `EXPO_PUBLIC_*` env for dev) and validated at startup. `eas.json` is authored credential-free (no secrets).

**Tech Stack:** Expo SDK 56, React Native 0.85, React 19, TypeScript 6 (strict), `@fountainrank/api-client` (openapi-fetch), `expo-constants`, Vitest 4.1.9 (node env), Turbo, pnpm workspace, EAS Build/Submit config.

**Spec:** `docs/specs/2026-06-23-mobile-store-testing-distribution-design.md` (Codex-approved). This plan implements **slice 6e-1** from spec §18, honoring §8 (runtime config), §17 (bundle-id confirmation gate), §20 (native config / versioning / permissions / deep-link), and §21 (auth-unavailable mode / per-slice proof levels). Read those sections before starting.

## Global Constraints

- **No AI attribution** in commits/PRs; **no time estimates** anywhere. Conventional Commits; frequent commits; one task at a time.
- **Claude Code runs on Windows:** file tools use backslash paths (`D:\repos\fountainrank\...`); the Bash tool is Git Bash (forward slashes). Run the task runner as `powershell.exe -NoProfile -ExecutionPolicy Bypass -File run.ps1 <args>` (no `pwsh`). Any path handed to **Codex** in a review prompt must be **repo-relative**.
- **pnpm store goes dirty after every Codex (WSL) run.** Before the FIRST local `pnpm`/`vitest`/`run.ps1` of the implementation (a Codex plan review runs just before), recover with a clean reinstall: from Git Bash, `rm -rf node_modules web/node_modules mobile/node_modules packages/*/node_modules && CI=true pnpm install`. Prefix one-off installs with `CI=true` to skip the interactive deps-purge prompt.
- **Scoped mobile Turbo checks run `generate` first.** `turbo.json` makes both `typecheck` and `test` `dependsOn` `generate`/`^generate`, so `run.ps1 check -Mobile` (and CI's `turbo run lint typecheck test`) may run the `@fountainrank/api-client` OpenAPI export, which needs backend **`uv`** deps available. If a scoped mobile check fails inside `generate`, run `uv sync` in `backend/` (or `./run.ps1 bootstrap`) — that is a backend-deps problem, not a Vitest failure. (`generate` is DB-free.)
- **Local mirror gates the PR:** `./run.ps1 check` (backend + workspace-js + web build + mobile) must be green before the PR. Mid-loop, scope to mobile: `powershell.exe -NoProfile -ExecutionPolicy Bypass -File run.ps1 check -Mobile`. Per-mobile-file test: `pnpm --filter mobile exec vitest run lib/config.test.ts`.
- **Lockfile discipline:** CI installs with `pnpm install --frozen-lockfile`. After ANY `mobile/package.json` dependency change, run `CI=true pnpm install` at the repo root to update `pnpm-lock.yaml`, and commit the lockfile in the same task. A stale lockfile fails CI.
- **Security / standards (spec §14, §20, §21):**
  - **No secrets, no `.env`.** `eas.json` is credential-free: no Apple API key, no App Store Connect app id, no Play service-account path. Owner supplies submit credentials at submit time (6e-8/6e-10).
  - **HTTPS-only.** Runtime config rejects any URL that is not a well-formed `https://` URL (scheme + non-empty host, no whitespace/control characters); no iOS ATS exception, no Android cleartext config. Dev overrides (`EXPO_PUBLIC_*`) may only point at an alternate **HTTPS** endpoint (e.g. a staging API) — local cleartext (`http://localhost`) is intentionally unsupported in this slice; a dev-only relaxation, if ever needed, is a later slice with its own review.
  - **No dev-auth seam on mobile.** Do not add or reference `X-Dev-User`/`X-Dev-Email`/`X-Dev-Name` anywhere (the wrapper + its assertion test land in 6e-2; just never introduce them here).
  - **Auth-unavailable mode.** Include only **public** Logto values (`logtoEndpoint`, `logtoAudience` — both public URLs). Do **not** add a Logto native app id or any placeholder app id; native auth UI is 6e-5. The app stays public-read.
  - **No token/PII logging.** The diagnostic surface shows only app name, backend reachability, version/build, and the (public) API base URL.
- **App identity (spec §7, §17):** bundle id / package / scheme = `com.redducklabs.fountainrank` (callback `com.redducklabs.fountainrank://callback`). This is the **proposed working default, not yet owner-confirmed.** 6e-1 only authors local config with it; it creates **no** Apple/Play/Logto/Google records, so the confirmation gate is not yet triggered. Do not create any external record in this slice.
- **Versioning (spec §20):** `version` `0.1.0`, `ios.buildNumber` `"1"`, `android.versionCode` `1`, `runtimeVersion` policy `appVersion`; `eas.json` `cli.appVersionSource: "local"` with `autoIncrement: true` on the production build profile.
- **Slice boundaries (per spec §18 + §20 — consistent, not a deviation):**
  - The **MapLibre config plugin + `@maplibre/maplibre-react-native` native dependency** land in **6e-3** (the map slice), where they are used — spec §18's 6e-1 row and §20 now place them there. Installing an unused native module here would force CNG/prebuild for nothing (YAGNI). 6e-1 lands only the *static* native config §20 needs that requires no native module: the **location-permission usage strings** and the **deep-link scheme**.
  - **Finalized icon/splash assets** land in **6e-8** (store metadata) when the owner provides them; 6e-1 does not reference asset files that do not exist (referencing missing files breaks the build/doctor). Expo's defaults apply meanwhile.
  - **`appVersionSource: "remote"`** (EAS-managed build numbers) is deferred to **6e-8**, after the owner-gated `eas init` links the project; `"local"` keeps 6e-1 self-contained and validatable with no EAS account.
- **Mobile design system / style-guide:** the web `docs/style-guide.md` is a Tailwind/web design system; the mobile (React Native) design system is established in **6e-2** (app shell). 6e-1 adds only a brief mobile note to the style guide documenting the temporary diagnostics surface (Task 5).

---

## File Structure

- **Commit existing (untracked) artifacts** on the branch first:
  - `docs/specs/2026-06-23-mobile-store-testing-distribution-design.md` — the Codex-approved umbrella spec (Task 1).
  - `docs/plans/2026-06-23-mobile-6e-1-release-config.md` — this plan (Task 1).
- **Create:**
  - `mobile/vitest.config.ts` — Vitest config (node env) (Task 2).
  - `mobile/lib/config.ts` (+ `mobile/lib/config.test.ts`) — pure `parseMobileConfig` + `MobileConfig` type (Task 2).
  - `mobile/lib/build-info.ts` (+ `mobile/lib/build-info.test.ts`) — pure `formatBuildInfo` (Task 3).
  - `mobile/app.config.ts` — dynamic Expo config: identity, versioning, permissions, scheme, `extra` (Task 4).
  - `mobile/eas.json` — build (development/preview/production) + submit profiles, credential-free (Task 6).
- **Modify:**
  - `mobile/package.json` — add `test` script, `vitest` + `@types/node` devDeps, `expo-constants` dep, `expo.doctor.reactNativeDirectoryCheck.listUnknownPackages: false` (Tasks 2, 4).
  - `mobile/eslint.config.js` — ignore `vitest.config.ts` (Task 2).
  - `mobile/App.tsx` — use validated runtime config + diagnostics surface (Task 5).
  - `mobile/README.md` — store-testing build + test instructions (Task 7).
  - `pnpm-lock.yaml` — updated by `pnpm install` after dep changes (Tasks 2, 4).
  - `run.ps1` — `Invoke-MobileCheck` also runs `test` (Task 7).
  - `claude_help/testing-ci.md` — mobile row includes `vitest run` (Task 7).
  - `docs/style-guide.md` — brief mobile diagnostics note (Task 5).
- **Delete:**
  - `mobile/app.json` — replaced by `mobile/app.config.ts` (Task 4).

No backend, no `api-client`, no web changes. No CI workflow change is required: CI's `workspace-js` job already runs `turbo run lint typecheck test`, so a `test` script in `mobile/package.json` is picked up automatically.

---

### Task 1: Branch + land the Codex-approved spec & this plan

**Files:**
- Add (already on disk, untracked): `docs/specs/2026-06-23-mobile-store-testing-distribution-design.md`, `docs/plans/2026-06-23-mobile-6e-1-release-config.md`

- [ ] **Step 1: Create the branch** off up-to-date `main`.

```bash
git -C /d/repos/fountainrank fetch origin
git -C /d/repos/fountainrank switch -c feat/mobile-6e-1-release-config origin/main
```

- [ ] **Step 2: Commit the spec + plan** (they ride this PR per the agreed landing decision).

```bash
git -C /d/repos/fountainrank add docs/specs/2026-06-23-mobile-store-testing-distribution-design.md docs/plans/2026-06-23-mobile-6e-1-release-config.md
git -C /d/repos/fountainrank commit -m "docs: mobile store-testing umbrella spec + 6e-1 release-config plan"
```

---

### Task 2: Mobile test runner + runtime config parser

**Files:**
- Create: `mobile/vitest.config.ts`
- Create: `mobile/lib/config.ts`
- Test: `mobile/lib/config.test.ts`
- Modify: `mobile/package.json`, `mobile/eslint.config.js`, `pnpm-lock.yaml`

**Interfaces:**
- Produces: `type MobileConfig = { apiBaseUrl: string; logtoEndpoint: string; logtoAudience: string; authCallbackScheme: string }` and `parseMobileConfig(extra: unknown): MobileConfig` (throws on missing/invalid). Consumed by `App.tsx` (Task 5).

- [ ] **Step 1: Recover the pnpm store** (a Codex plan review just ran in WSL), from Git Bash:

```bash
cd /d/repos/fountainrank && rm -rf node_modules web/node_modules mobile/node_modules packages/*/node_modules && CI=true pnpm install
```

- [ ] **Step 2: Add the Vitest config** — `mobile/vitest.config.ts`:

```ts
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["**/*.test.ts"],
  },
});
```

- [ ] **Step 3: Add the `test` script, `vitest` + `@types/node` devDeps, and expo-doctor config** to `mobile/package.json`. Add `"test": "vitest run"` after `"typecheck"`; add `"vitest": "4.1.9"` and `"@types/node": "22.19.21"` to `devDependencies` (both matching `web`/`api-client`). `@types/node` is needed so `process.env` in `app.config.ts` (Task 4) typechecks — Expo's base tsconfig sets **no `types` array**, so all `@types/*` are auto-included globally (no `tsconfig.json` change required). Also add the top-level `expo.doctor` block so the React Native Directory check does not fail on the non-RN dev dep:

```jsonc
{
  "scripts": {
    "start": "expo start",
    "android": "expo start --android",
    "ios": "expo start --ios",
    "lint": "eslint .",
    "typecheck": "tsc --noEmit",
    "test": "vitest run"
  },
  // ...dependencies unchanged in this task...
  "devDependencies": {
    "@types/node": "22.19.21",
    "@types/react": "19.2.17",
    "eslint": "9.39.4",
    "eslint-config-expo": "56.0.4",
    "typescript": "6.0.3",
    "vitest": "4.1.9"
  },
  "expo": {
    "doctor": {
      "reactNativeDirectoryCheck": {
        "listUnknownPackages": false
      }
    }
  }
}
```

- [ ] **Step 4: Ignore the Vitest config in ESLint** — `mobile/eslint.config.js` (match the existing config-file ignore pattern):

```js
const expoConfig = require("eslint-config-expo/flat");

module.exports = [
  ...expoConfig,
  { ignores: ["dist/**", ".expo/**", "babel.config.js", "eslint.config.js", "vitest.config.ts"] },
];
```

- [ ] **Step 5: Install** to materialize `vitest` and refresh the lockfile, from Git Bash:

```bash
cd /d/repos/fountainrank && CI=true pnpm install
```

- [ ] **Step 6: Write the failing test** — `mobile/lib/config.test.ts`:

```ts
import { describe, expect, it } from "vitest";

import { parseMobileConfig } from "./config";

const VALID = {
  apiBaseUrl: "https://api.fountainrank.com",
  logtoEndpoint: "https://auth.fountainrank.com",
  logtoAudience: "https://api.fountainrank.com",
  authCallbackScheme: "com.redducklabs.fountainrank",
};

describe("parseMobileConfig", () => {
  it("returns a typed config for valid extra", () => {
    expect(parseMobileConfig(VALID)).toEqual(VALID);
  });

  it("throws when extra is missing", () => {
    expect(() => parseMobileConfig(undefined)).toThrow();
    expect(() => parseMobileConfig(null)).toThrow();
  });

  it("throws when apiBaseUrl is absent", () => {
    expect(() => parseMobileConfig({ ...VALID, apiBaseUrl: undefined })).toThrow(/apiBaseUrl/);
  });

  it("rejects a non-https apiBaseUrl (HTTPS-only)", () => {
    expect(() => parseMobileConfig({ ...VALID, apiBaseUrl: "http://api.fountainrank.com" })).toThrow(
      /https/,
    );
  });

  it("rejects an https URL with an empty host", () => {
    expect(() => parseMobileConfig({ ...VALID, apiBaseUrl: "https://" })).toThrow(/https/);
  });

  it("rejects a URL containing whitespace", () => {
    expect(() => parseMobileConfig({ ...VALID, apiBaseUrl: "https://api .com" })).toThrow(
      /whitespace/,
    );
  });

  it("accepts an https host with hyphens (e.g. staging)", () => {
    const staging = { ...VALID, apiBaseUrl: "https://api-staging.fountainrank.com" };
    expect(parseMobileConfig(staging).apiBaseUrl).toBe("https://api-staging.fountainrank.com");
  });

  it("rejects a non-https logtoEndpoint", () => {
    expect(() =>
      parseMobileConfig({ ...VALID, logtoEndpoint: "http://auth.fountainrank.com" }),
    ).toThrow(/https/);
  });

  it("requires a non-empty authCallbackScheme", () => {
    expect(() => parseMobileConfig({ ...VALID, authCallbackScheme: "" })).toThrow(/scheme/);
  });
});
```

- [ ] **Step 7: Run it; verify it fails** (module not found / function undefined):

```bash
pnpm --filter mobile exec vitest run lib/config.test.ts
```
Expected: FAIL.

- [ ] **Step 8: Implement** — `mobile/lib/config.ts` (no Expo/native imports; a small regex keeps it React-Native-safe — no `URL` polyfill dependency). `\p{Cc}` (with the `u` flag) matches Unicode control characters without putting any literal control byte in the source:

```ts
export type MobileConfig = {
  apiBaseUrl: string;
  logtoEndpoint: string;
  logtoAudience: string;
  authCallbackScheme: string;
};

function requireNonEmpty(value: unknown, field: string): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`Mobile config: "${field}" is required`);
  }
  return value;
}

// React-Native-safe https validation (no URL polyfill dependency): reject
// whitespace/control characters, then require the https:// scheme + a non-empty
// host. Hyphens in the host (e.g. api-staging.example.com) are allowed.
function requireHttpsUrl(value: unknown, field: string): string {
  const s = requireNonEmpty(value, field);
  if (/[\s\p{Cc}]/u.test(s)) {
    throw new Error(`Mobile config: "${field}" must not contain whitespace or control characters`);
  }
  if (!/^https:\/\/[^/]+(\/.*)?$/.test(s)) {
    throw new Error(`Mobile config: "${field}" must be a valid https URL`);
  }
  return s;
}

export function parseMobileConfig(extra: unknown): MobileConfig {
  if (typeof extra !== "object" || extra === null) {
    throw new Error("Mobile config: expoConfig.extra is missing");
  }
  const e = extra as Record<string, unknown>;
  return {
    apiBaseUrl: requireHttpsUrl(e.apiBaseUrl, "apiBaseUrl"),
    logtoEndpoint: requireHttpsUrl(e.logtoEndpoint, "logtoEndpoint"),
    logtoAudience: requireHttpsUrl(e.logtoAudience, "logtoAudience"),
    authCallbackScheme: requireNonEmpty(e.authCallbackScheme, "authCallbackScheme"),
  };
}
```

- [ ] **Step 9: Run it; verify it passes:**

```bash
pnpm --filter mobile exec vitest run lib/config.test.ts
```
Expected: PASS (9 tests).

- [ ] **Step 10: Lint + typecheck mobile:**

```bash
powershell.exe -NoProfile -ExecutionPolicy Bypass -File run.ps1 check -Mobile -Fast
```
Expected: lint + typecheck + the new vitest test all pass (`-Fast` skips `expo-doctor`, run in full in Task 4/8).

- [ ] **Step 11: Commit:**

```bash
git -C /d/repos/fountainrank add mobile/vitest.config.ts mobile/lib/config.ts mobile/lib/config.test.ts mobile/package.json mobile/eslint.config.js pnpm-lock.yaml
git -C /d/repos/fountainrank commit -m "feat(mobile): runtime config parser + vitest runner (slice 6e-1)"
```

---

### Task 3: Build-info formatter

**Files:**
- Create: `mobile/lib/build-info.ts`
- Test: `mobile/lib/build-info.test.ts`

**Interfaces:**
- Produces: `formatBuildInfo(version: string | null | undefined, build: string | null | undefined): string`. Consumed by `App.tsx` (Task 5).

- [ ] **Step 1: Write the failing test** — `mobile/lib/build-info.test.ts` (ASCII-only fallback):

```ts
import { describe, expect, it } from "vitest";

import { formatBuildInfo } from "./build-info";

describe("formatBuildInfo", () => {
  it("formats version and build", () => {
    expect(formatBuildInfo("0.1.0", "1")).toBe("v0.1.0 (build 1)");
  });

  it("falls back when version is missing", () => {
    expect(formatBuildInfo(null, "3")).toBe("v0.0.0 (build 3)");
  });

  it("falls back when build is missing", () => {
    expect(formatBuildInfo("0.2.0", null)).toBe("v0.2.0 (build unknown)");
  });
});
```

- [ ] **Step 2: Run it; verify it fails:**

```bash
pnpm --filter mobile exec vitest run lib/build-info.test.ts
```
Expected: FAIL.

- [ ] **Step 3: Implement** — `mobile/lib/build-info.ts`:

```ts
export function formatBuildInfo(
  version: string | null | undefined,
  build: string | null | undefined,
): string {
  return `v${version ?? "0.0.0"} (build ${build ?? "unknown"})`;
}
```

- [ ] **Step 4: Run it; verify it passes:**

```bash
pnpm --filter mobile exec vitest run lib/build-info.test.ts
```
Expected: PASS (3 tests).

- [ ] **Step 5: Commit:**

```bash
git -C /d/repos/fountainrank add mobile/lib/build-info.ts mobile/lib/build-info.test.ts
git -C /d/repos/fountainrank commit -m "feat(mobile): build-info formatter (slice 6e-1)"
```

---

### Task 4: Expo app config — identity, versioning, permissions, scheme

**Files:**
- Create: `mobile/app.config.ts`
- Delete: `mobile/app.json`
- Modify: `mobile/package.json` (add `expo-constants` dep), `pnpm-lock.yaml`

**Interfaces:**
- Produces the resolved `Constants.expoConfig` consumed by `App.tsx` (Task 5): `extra` (validated by `parseMobileConfig`), `version`, `ios.buildNumber`, `android.versionCode`.

- [ ] **Step 1: Add `expo-constants` at the SDK-56-correct version** (Expo resolves the version), from Git Bash:

```bash
cd /d/repos/fountainrank && CI=true pnpm --filter mobile exec expo install expo-constants
```
Then refresh the lockfile if `expo install` did not already (it uses the workspace pnpm):

```bash
cd /d/repos/fountainrank && CI=true pnpm install
```
Expected: `expo-constants` added to `mobile/package.json` `dependencies`; `pnpm-lock.yaml` updated.

- [ ] **Step 2: Create `mobile/app.config.ts`** (replaces `app.json`; non-secret config only; `EXPO_PUBLIC_*` env overrides may point at an alternate **HTTPS** endpoint, e.g. staging — not local cleartext):

```ts
import type { ExpoConfig } from "expo/config";

const config: ExpoConfig = {
  name: "FountainRank",
  slug: "fountainrank",
  version: "0.1.0",
  scheme: "com.redducklabs.fountainrank",
  platforms: ["ios", "android"],
  runtimeVersion: { policy: "appVersion" },
  ios: {
    bundleIdentifier: "com.redducklabs.fountainrank",
    buildNumber: "1",
    infoPlist: {
      NSLocationWhenInUseUsageDescription:
        "FountainRank uses your location to show nearby drinking fountains and to place a fountain you add.",
    },
  },
  android: {
    package: "com.redducklabs.fountainrank",
    versionCode: 1,
    permissions: ["ACCESS_COARSE_LOCATION", "ACCESS_FINE_LOCATION"],
  },
  extra: {
    apiBaseUrl: process.env.EXPO_PUBLIC_API_BASE_URL ?? "https://api.fountainrank.com",
    logtoEndpoint: process.env.EXPO_PUBLIC_LOGTO_ENDPOINT ?? "https://auth.fountainrank.com",
    logtoAudience: process.env.EXPO_PUBLIC_LOGTO_AUDIENCE ?? "https://api.fountainrank.com",
    authCallbackScheme: "com.redducklabs.fountainrank",
  },
};

export default config;
```

- [ ] **Step 3: Delete `mobile/app.json`:**

```bash
git -C /d/repos/fountainrank rm mobile/app.json
```

- [ ] **Step 4: Typecheck + lint + full mobile check including `expo-doctor`:**

```bash
powershell.exe -NoProfile -ExecutionPolicy Bypass -File run.ps1 check -Mobile
```
Expected: lint + typecheck + vitest + `expo-doctor` all pass. If `expo-doctor` reports an `expo-constants` version mismatch, re-run Step 1's `expo install` (it pins the SDK-correct version) and re-check.

- [ ] **Step 5: Commit:**

```bash
git -C /d/repos/fountainrank add mobile/app.config.ts mobile/package.json pnpm-lock.yaml
git -C /d/repos/fountainrank commit -m "feat(mobile): app.config.ts — identity, versioning, permissions, scheme (slice 6e-1)"
```

---

### Task 5: Wire App.tsx to runtime config + diagnostics surface

**Files:**
- Modify: `mobile/App.tsx`
- Modify: `docs/style-guide.md`

**Interfaces:**
- Consumes: `parseMobileConfig` (Task 2), `formatBuildInfo` (Task 3), `Constants.expoConfig` (Task 4).

- [ ] **Step 1: Replace `mobile/App.tsx`** — drop the hard-coded `localhost`; resolve config + build label from the app config; render an **invalid-config** state if the config fails to parse (the parse error names only the offending field — no secret values), otherwise the diagnostics surface. The pure helpers are already unit-tested; `App.tsx` is the thin shell (no unit test, per the spec's pure-helper testing pattern):

```tsx
import Constants from "expo-constants";
import { useEffect, useState } from "react";
import { Platform, StyleSheet, Text, View } from "react-native";

import { makeClient } from "@fountainrank/api-client";

import { formatBuildInfo } from "./lib/build-info";
import { parseMobileConfig, type MobileConfig } from "./lib/config";

const versionCode = Constants.expoConfig?.android?.versionCode;
const buildLabel = formatBuildInfo(
  Constants.expoConfig?.version,
  Platform.OS === "ios"
    ? Constants.expoConfig?.ios?.buildNumber
    : versionCode != null
      ? String(versionCode)
      : null,
);

let mobileConfig: MobileConfig | null;
let configError: string | null;
try {
  mobileConfig = parseMobileConfig(Constants.expoConfig?.extra);
  configError = null;
} catch (err) {
  mobileConfig = null;
  configError = err instanceof Error ? err.message : "Invalid mobile configuration";
}

type Status = "loading" | "ok" | "error";

export default function App() {
  const [status, setStatus] = useState<Status>("loading");

  useEffect(() => {
    if (!mobileConfig) return;
    makeClient(mobileConfig.apiBaseUrl)
      .GET("/healthz")
      .then(({ data, error }) => setStatus(!error && data?.status === "ok" ? "ok" : "error"))
      .catch(() => setStatus("error"));
  }, []);

  if (configError) {
    return (
      <View style={styles.container}>
        <Text style={styles.title}>FountainRank</Text>
        <Text>Configuration error: {configError}</Text>
        <Text style={styles.meta}>{buildLabel}</Text>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <Text style={styles.title}>FountainRank</Text>
      <Text>Backend status: {status}</Text>
      <Text style={styles.meta}>{buildLabel}</Text>
      <Text style={styles.meta}>{mobileConfig?.apiBaseUrl}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, alignItems: "center", justifyContent: "center" },
  title: { fontSize: 24, fontWeight: "bold" },
  meta: { marginTop: 8, color: "#475569", fontSize: 12 },
});
```

- [ ] **Step 2: Add a brief mobile note to `docs/style-guide.md`** — read it first to match voice; append a short section near the end:

```markdown
## Mobile (React Native)

The mobile app (Expo / React Native) has its own component system, established in
slice 6e-2 (app shell). It does **not** use the web Tailwind classes above.

### Diagnostics surface (slice 6e-1, temporary)

A minimal startup screen used to verify release configuration before the real
app shell lands. Shows: the app name, backend reachability (`loading` -> `ok` /
`error` from `GET /healthz`), the version/build label (`vX.Y.Z (build N)`), and
the resolved (public) API base URL. If the runtime config fails validation it
renders an "invalid configuration" state naming the bad field (no secret values).
No tokens or PII. Superseded by the 6e-2 app shell.
```

- [ ] **Step 3: Lint + typecheck mobile:**

```bash
powershell.exe -NoProfile -ExecutionPolicy Bypass -File run.ps1 check -Mobile -Fast
```
Expected: PASS. If ESLint flags import order, order imports: `expo-constants`, `react`, `react-native`, `@fountainrank/api-client`, then `./lib/*`.

- [ ] **Step 4: Format the touched files explicitly** — the root `format:check` glob is `{web,mobile,packages}/**`, so it covers `mobile/App.tsx` but **not** `docs/`; format `docs/style-guide.md` directly so it stays consistent:

```bash
pnpm exec prettier --write mobile/App.tsx docs/style-guide.md
```

- [ ] **Step 5: Commit:**

```bash
git -C /d/repos/fountainrank add mobile/App.tsx docs/style-guide.md
git -C /d/repos/fountainrank commit -m "feat(mobile): wire App to runtime config + diagnostics surface (slice 6e-1)"
```

---

### Task 6: EAS build + submit profiles (credential-free)

**Files:**
- Create: `mobile/eas.json`

- [ ] **Step 1: Create `mobile/eas.json`** — `appVersionSource: "local"` (self-contained, no EAS project needed to validate); production `autoIncrement`; production Android -> `.aab` for Play, preview -> `.apk` for easy internal installs; submit `production` sets only the Android `internal` track — **no credentials** (owner provides at submit time):

```json
{
  "cli": {
    "appVersionSource": "local"
  },
  "build": {
    "development": {
      "developmentClient": true,
      "distribution": "internal"
    },
    "preview": {
      "distribution": "internal",
      "android": {
        "buildType": "apk"
      }
    },
    "production": {
      "autoIncrement": true,
      "android": {
        "buildType": "app-bundle"
      }
    }
  },
  "submit": {
    "production": {
      "android": {
        "track": "internal"
      }
    }
  }
}
```

- [ ] **Step 2: Validate config (`expo-doctor`) + format:**

```bash
pnpm exec prettier --write mobile/eas.json
powershell.exe -NoProfile -ExecutionPolicy Bypass -File run.ps1 check -Mobile
```
Expected: PASS. (`expo-doctor` validates app config + deps; `eas.json` requires no Expo account to sit in the repo.)

- [ ] **Step 3: Commit:**

```bash
git -C /d/repos/fountainrank add mobile/eas.json
git -C /d/repos/fountainrank commit -m "build(mobile): eas.json build + submit profiles (slice 6e-1)"
```

---

### Task 7: Wire mobile tests into the local CI mirror + docs

**Files:**
- Modify: `run.ps1`
- Modify: `claude_help/testing-ci.md`
- Modify: `mobile/README.md`

- [ ] **Step 1: Add `test` to the mobile check** — in `run.ps1`, `Invoke-MobileCheck`, change the turbo line to include `test` so `check -Mobile` runs the new vitest suite (CI already runs it via the workspace-wide `turbo run ... test`):

Replace:
```powershell
    Invoke-Native -Exe 'pnpm' -Arguments @('exec', 'turbo', 'run', 'lint', 'typecheck', '--filter=mobile') -WorkingDir $RepoRoot
```
with:
```powershell
    Invoke-Native -Exe 'pnpm' -Arguments @('exec', 'turbo', 'run', 'lint', 'typecheck', 'test', '--filter=mobile') -WorkingDir $RepoRoot
```
Also update the section banner string in `Invoke-MobileCheck` from `'check: mobile (eslint + typecheck + expo-doctor)'` to `'check: mobile (eslint + typecheck + vitest + expo-doctor)'`.

- [ ] **Step 2: Update `claude_help/testing-ci.md`** — the Mobile row of the local-checks table:

Replace:
```
| Mobile | `./run.ps1 check -Mobile` | `tsc --noEmit` + ESLint + `expo-doctor` |
```
with:
```
| Mobile | `./run.ps1 check -Mobile` | `tsc --noEmit` + ESLint + `vitest run` + `expo-doctor` |
```
And in the "Job ↔ local parity" list, update the `workspace-js` line to note mobile **tests** now run there too (the workspace-wide `turbo run lint typecheck test` enforces mobile lint+typecheck+**test**).

- [ ] **Step 3: Update `mobile/README.md`** — replace the stale "later phase" paragraph with current commands + store-testing build notes. New content:

````markdown
# FountainRank Mobile

Expo SDK 56 / React Native. Talks to the backend through
`@fountainrank/api-client`. Release builds target the deployed production
services (`https://api.fountainrank.com`, `https://auth.fountainrank.com`).

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
`https://` (local cleartext is not supported in this slice).

## Store-testing builds (EAS)

`eas.json` defines `development` / `preview` / `production` build profiles and a
credential-free `production` submit profile (Android `internal` track). Producing
and submitting store binaries requires an Expo/EAS account and `eas init`
(owner-gated — see the umbrella spec
`docs/specs/2026-06-23-mobile-store-testing-distribution-design.md`, slice 6e-8).
No build/submit runs as part of this slice.
````

- [ ] **Step 4: Format the touched files** — `mobile/README.md` IS covered by the root `format:check`; `claude_help/testing-ci.md` is **not** (only `{web,mobile,packages}/**`), so format it explicitly for consistency:

```bash
pnpm exec prettier --write claude_help/testing-ci.md mobile/README.md
```

- [ ] **Step 5: Verify the mobile check still passes with the new `test` step wired in:**

```bash
powershell.exe -NoProfile -ExecutionPolicy Bypass -File run.ps1 check -Mobile
```
Expected: banner shows vitest; all pass.

- [ ] **Step 6: Commit:**

```bash
git -C /d/repos/fountainrank add run.ps1 claude_help/testing-ci.md mobile/README.md
git -C /d/repos/fountainrank commit -m "chore(mobile): run mobile vitest in local CI mirror + store-testing docs (slice 6e-1)"
```

---

### Task 8: Full local CI mirror green (PR gate)

**Files:** none (verification; commit only if a formatter/lint fixup is needed).

- [ ] **Step 1: Run the FULL mirror** (backend + workspace-js + web build + mobile) — a cross-workspace contract break must not slip through:

```bash
powershell.exe -NoProfile -ExecutionPolicy Bypass -File run.ps1 check
```
Expected: every section green, ending "All requested checks passed." This requires the `db` container (auto-started) and `uv` (backend `generate`/pytest). If the pnpm store went dirty from a Codex run, recover first (see Global Constraints).

- [ ] **Step 2: Confirm a clean tree** (no stray formatter rewrites):

```bash
git -C /d/repos/fountainrank status --short
```
Expected: empty. If Prettier rewrote anything, `git add` + commit `chore(mobile): formatting (slice 6e-1)` and re-run Step 1.

- [ ] **Step 3: Push the branch:**

```bash
git -C /d/repos/fountainrank push -u origin feat/mobile-6e-1-release-config
```

Then proceed to the PR + Codex Loop B + squash-merge per `claude_help/codex-review-process.md` and `claude_help/testing-ci.md`. (No DOKS deploy and no EAS build apply to this slice — it is mobile config only.)

---

## Self-Review

**Spec coverage (slice 6e-1 per §18 + §20/§21):**
- Kill `localhost` API URL -> Task 5 (via Task 2 runtime config). ✓
- Runtime config (§8) -> Task 2 (`config.ts`) + Task 4 (`extra`). ✓
- App identity (bundle id, package, scheme) -> Task 4. ✓
- Store versioning (`version`/`buildNumber`/`versionCode`/`runtimeVersion` + increment policy, §20) -> Task 4 + Task 6 (`autoIncrement`, `appVersionSource`). ✓
- Location permission usage strings (§20) -> Task 4. ✓
- Deep-link scheme (§20) -> Task 4 (`scheme`). ✓
- `eas.json` (dev/preview/production + submit) -> Task 6. ✓
- App-version/build diagnostic surface -> Task 5 (+ Task 3 formatter). ✓
- README -> Task 7. ✓
- Mobile unit-test runner (§19 intent) -> Task 2; wired into mirror/CI -> Task 7. ✓
- Auth-unavailable mode / no placeholder app id (§21) -> Global Constraints + Task 4 (`extra` has only public Logto URLs). ✓
- Bundle-id confirmation gate (§17) -> Global Constraints (no external record created). ✓
- HTTPS-only / no secrets (§14, §20) -> Task 2 (https validation) + Task 6 (credential-free `eas.json`). ✓
- Slice boundaries (MapLibre plugin -> 6e-3; icon/splash -> 6e-8; `appVersionSource: remote` -> 6e-8) consistent with spec §18, documented in Global Constraints. ✓

**Placeholder scan:** every code/test step has complete content; no "TODO"/"handle errors"/"similar to". ✓

**Type consistency:** `parseMobileConfig(extra: unknown): MobileConfig` (Task 2) and `formatBuildInfo(version, build): string` (Task 3) are consumed with matching signatures in `App.tsx` (Task 5). `MobileConfig` field names (`apiBaseUrl`, `logtoEndpoint`, `logtoAudience`, `authCallbackScheme`) match the `extra` keys authored in `app.config.ts` (Task 4). ✓
