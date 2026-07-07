# Local Development (Windows host + Codex-in-WSL)

Read this before running local checks, building the mobile app locally, or doing
browser/visual verification on the primary Windows dev host. It explains what is
verifiable locally, what is effectively **CI-only**, and the recurring
environment gotchas — so you neither waste time fighting them nor falsely claim a
local green you didn't get. `CLAUDE.md` is the hub; this is the "how the dev box
behaves" spoke, alongside `testing-ci.md`.

## The core reality: two OSes share one workspace

Claude Code runs on the **Windows host**; **Codex runs in WSL (Linux)** against
the *same* checkout (`/mnt/<drive>/.../fountainrank`). So the platform-specific
build artifacts each side creates are frequently **unusable by the other**:

- `backend/.venv` built by WSL is a Linux venv (its `pyvenv.cfg` home points at a
  Linux Python, it has a `lib64 -> lib` symlink and no `Scripts/`). Windows `uv`
  can't use or even cleanly remove it (`Access is denied` on the `lib64` symlink).
- The JS `node_modules` built by WSL carries Linux-resolved transitive versions
  and a WSL-flavored `.modules.yaml`, which the next Windows `pnpm` sees as a
  mismatch and tries to purge.

**Do NOT "fix" this by deleting Codex's `.venv` / `node_modules`** — you break
Codex's environment and gain nothing. Work *around* the boundary instead
(below). Fighting it (reinstalling, clobbering venvs) wastes sessions.

## Backend — fully verifiable locally (isolated env)

Point `uv` at an **isolated, Windows-owned** environment so it never touches
Codex's `.venv`:

```bash
# PowerShell
$env:UV_PROJECT_ENVIRONMENT="<a scratchpad path outside the repo>/fr-venv"
./run.ps1 check -Backend   # uv auto-creates + syncs on first run
```

The full backend mirror (ruff + `ruff format --check` + `alembic upgrade head` +
`alembic check` + pytest) then runs green against PostGIS on `localhost:5436`
(`./run.ps1 up` starts the `db` container). **turbo strips env vars in strict
mode**, so the `api-client#generate` step's backend `uv` call won't see
`UV_PROJECT_ENVIRONMENT` — pass it through with `--env-mode=loose` when you drive
turbo directly, e.g.:

```bash
$env:UV_PROJECT_ENVIRONMENT="…"; pnpm exec turbo run typecheck test build --filter=web --env-mode=loose
```

`packages/api-client/openapi.json` + `src/schema.d.ts` are **git-tracked** (not
generated-and-ignored), so a regen must leave a clean tree.

## Web / mobile JS — what runs locally vs. CI-only

**Runs locally** (verify these before a PR): `tsc --noEmit`, ESLint, Prettier,
`next build`, and **pure-logic** vitest files (helpers that don't render React,
e.g. `mobile/lib/*.test.ts`).

**CI-only on this host** (do not claim local green — rely on `workspace-js`):
- **Component-render vitest suites** and the **full** unit suites. The local,
  skip-worktree `pnpm-workspace.yaml` uses `nodeLinker: hoisted` (a MAX_PATH
  workaround, below), which hoists a **duplicate React** → `Invalid hook call` on
  render (~a quarter of web tests fail on a clean tree). CI's isolated linker
  (Linux) passes them.
- Render test files need `// @vitest-environment jsdom` as line 1 (the config
  defaults `environment: "node"`); without it you get `localStorage is not
  defined` — that's a **real bug that also fails CI**, not the host limitation.
- **Mobile ESLint's stricter React-Compiler rules** — see `testing-ci.md`.

State honestly which suites you ran and which you're deferring to CI.

## pnpm store repair (when Windows pnpm wedges)

Symptom: every `pnpm …` triggers a deps-status check → wants to purge
`node_modules` → `ERR_PNPM_ABORTED_REMOVE_MODULES_DIR_NO_TTY`; a
`pnpm install --frozen-lockfile` then EPERMs on `unlink …/.pnpm/…` (WSL-created
files Windows can't delete) and can **empty** the root `node_modules` mid-recreate.
Cause: node_modules was last installed by WSL with different transitive versions
than the committed lockfile. **Repair (WSL deletes, Windows reinstalls):**

```bash
# 1. delete node_modules from the side that owns the files (WSL) — no EPERM
wsl.exe -e bash -c "cd /mnt/<drive>/.../fountainrank && rm -rf node_modules web/node_modules mobile/node_modules packages/*/node_modules"
# 2. reinstall from Windows into empty targets → Windows-owned files, no unlink, no EPERM (~20s, packages reused from the store)
powershell.exe -NoProfile -Command "pnpm install --frozen-lockfile"
```

- **🚨 NEVER set `CI=true` to silence the purge prompt.** It turns the safe abort
  into a *destructive* purge that then EACCES-fails on a WSL symlink and can
  corrupt `node_modules`. If you must skip the deps check, use
  `npm_config_verify_deps_before_run=false`, and keep turbo scoped
  (`--filter=web`; adding `--filter=mobile` widens to a root deps check that wants
  to purge).
- A dirty store can also come from leftover `.ignored_*` symlinks (from an
  interrupted install) beside a live link — clear all `.ignored_*` residue under
  the root `.pnpm` + `web/` + `mobile/` `node_modules`, then reinstall. The
  ~85 editor/AV processes only produce **non-fatal** `[WARN] Failed to remove …`
  lines — they don't block the install; don't chase a process to kill.

## The hoisted linker masks `expo-doctor` — CI is the truth for mobile deps

The local `pnpm-workspace.yaml` sets `nodeLinker: hoisted` (skip-worktree,
`git ls-files -v` → `S`; a Windows **260-char MAX_PATH** workaround so RN native
CMake/ninja paths stay short). Hoisting **flattens/dedupes** `node_modules`, so a
**local `expo-doctor` reports a false `21/21` pass** while CI's default
**isolated** linker runs the real "no duplicate dependencies" check and can fail.
**Treat CI (or an isolated-linker run) as the source of truth for any mobile
dependency change**, never local `expo-doctor`. Reproduce CI locally:

```bash
PNPM_CONFIG_NODE_LINKER=isolated CI=true pnpm install --frozen-lockfile
PNPM_CONFIG_NODE_LINKER=isolated pnpm dlx expo-doctor
```

Expo SDK patch releases are a **coordinated set — do not cherry-pick.** For SDK
maintenance use `npx expo install --fix` (or a full re-resolve:
`rm pnpm-lock.yaml && rm -rf node_modules && pnpm install`), not hand-bumps. pnpm
11 **ignores** `pnpm.overrides` in `package.json` — overrides live in
`pnpm-workspace.yaml`.

## Local Android emulator dev loop (zero EAS credits)

Iterate on the mobile app (esp. the MapLibre map) on a **local Android emulator**
with no Expo/EAS build credits. Toolchain: JDK 17, an Android SDK dir
(`ANDROID_HOME`/`ANDROID_SDK_ROOT`), and an AVD (`fountainrank`, API 35
`google_apis` x86_64). Env vars are persisted at USER scope for PowerShell but are
**NOT inherited into Git Bash** — export them before `gradlew` there or you get
"JAVA_HOME is not set".

- **MAX_PATH is the #1 gotcha.** pnpm's isolated layout makes
  `node_modules/.pnpm/react-native-screens@<hash>/…` CMake paths exceed 260 →
  `ninja: error: manifest 'build.ninja' still dirty`. **Fix = the `nodeLinker:
  hoisted` local override** (above). After switching linker, nuke `node_modules`
  + reinstall, then clear `mobile/android/{.gradle,build,app/build,app/.cxx}`
  (they cache old `.pnpm` autolinking paths).
- **Build (emulator ABI only, ~4× faster):**
  `mobile/android/gradlew -p mobile/android :app:assembleDebug -PreactNativeArchitectures=x86_64`
  → APK at `mobile/android/app/build/outputs/apk/debug/app-debug.apk`.
- **Emulator networking** on a Hyper-V host (WSL2/Docker present) comes up with no
  default route. Per boot (non-persistent):
  `adb root && adb shell ip route add default via 10.0.2.2 dev wlan0`.
- **Metro:** the debug app loads JS from `10.0.2.2:8081` (emulator → host
  loopback), not localhost (`adb reverse` is irrelevant). Run
  `CI=1 pnpm exec expo start --port 8081` **from `mobile/`** in the background.
- **🔴🔴 STALE-METRO TRAP (the #1 time-sink).** Two conditions make Metro serve
  **stale JS** so edits never reach the device (a correct fix looks broken):
  (1) Metro started from the **repo root** instead of `mobile/` (404s the bundle);
  (2) **`CI=1` disables the file watcher**, so Metro ignores edits made after it
  started. **Restart Metro after every JS edit** (fast, re-crawls); verify a
  reload took by tagging a `console.log` and grepping logcat. JS edit → restart
  Metro + relaunch app (no rebuild). Native/patch-package edit → gradle rebuild.
- **Testing authenticated features** needs the Logto Native **app id baked in at
  gradle-build time** (`expo-constants` embeds `app.config`'s `extra` into the APK
  at build, not from Metro's manifest). Export `EXPO_PUBLIC_LOGTO_APP_ID` +
  `EXPO_PUBLIC_LOGTO_NATIVE_AUTH_CONFIRMED=true` **before `gradlew assembleDebug`**
  (the config task is asset-only, ~18s, no full recompile); restarting Metro with
  env vars does nothing. The Native app id is a **public client id (PKCE)** —
  supply it via the env-var convention in `mobile/README.md` / `docs/setup/06-logto.md`.
- Grant location + set a seeded area: `adb shell pm grant com.redducklabs.fountainrank
  android.permission.ACCESS_FINE_LOCATION` then `adb emu geo fix <lon> <lat>`
  (use a city with seeded fountains, e.g. San Diego `-117.162 32.715`; many cities
  have 0). `wm size reset` so screenshot px == `input tap` coords. Deep-link:
  `adb shell am start -a android.intent.action.VIEW -d "com.redducklabs.fountainrank://fountains/<uuid>"`.

Do a **clean reinstall before any `eas` / `expo prebuild`** that follows
incremental Expo dep installs (pnpm's symlinked layout leaves config-plugin
`@expo/*` resolution inconsistent → "Unable to resolve a valid config plugin"):
`rm -rf node_modules web/node_modules mobile/node_modules packages/*/node_modules && CI=true pnpm install`,
then verify `pnpm --filter mobile exec expo config --type prebuild` exits 0.

## RN New-Architecture (Fabric) layout gotchas

The mobile app runs on the **New Architecture / Fabric** (Expo SDK 56 / RN 0.85);
`newArchEnabled: false` is a silently-ignored no-op (it can't be disabled). Two
non-obvious traps when building "mounted-but-hidden" tab panels (preserve form
input / scroll across a tab switch):

- **`style={{ display: "none" }}` does NOT collapse an inactive `flex:1`
  `ScrollView`** — every sibling still claims an equal share of the height, so
  most content ends up clipped below the fold.
- **A `position:absolute` fill overlay swallows taps on the active panel** — a
  `Pressable` under an `absoluteFill` sibling (even with `opacity:0` +
  `pointerEvents="none"` + `zIndex`) never fires `onPress`.
- **Working pattern:** wrap each panel in
  `<View style={selected ? { flex: 1 } : { height: 0, overflow: "hidden" }}>` —
  inactive collapses to 0 height (children stay mounted → state preserved), active
  is a normal `flex:1` child so its content stays tappable.

Map note: **native MapLibre clustering is broken on this stack** — use
`cluster={false}` and cluster in JS via `supercluster` (`mobile/lib/map/cluster.ts`);
basemap glyphs are `Noto Sans Regular` (Bold 404s on the tile CDN). Inspect the
live layout with `uiautomator dump` (pull with `MSYS_NO_PATHCONV=1` + a Windows
dest path so Git Bash doesn't mangle `/sdcard/...`).

## Browser / process safety

- **Use Chrome/Chromium for map/WebGL2 verification.** MapLibre GL JS requires
  **WebGL2**; the owner's Firefox can't create a WebGL2 context, so the web map
  shows the graceful "needs WebGL" hint there, not the map — a poor render test,
  independent of any tile/hosting change. **The Playwright MCP defaults to
  Firefox** and fails the same way (and won't launch here — 180s timeout).
- **NEVER blanket-kill a browser/app by image name** (`taskkill /IM firefox.exe`,
  `chrome.exe`, …) — the owner runs a real browser session on this host, so a
  blanket kill closes *their* windows. Target only a specific process (match the
  MCP profile dir / PID); if you can't target precisely, leave it and verify
  another way.

## Host tools

- **actionlint:** the committed `temp/actionlint/actionlint` is a **Linux** binary
  (a WSL artifact) — it fails in Git Bash with `Exec format error`. Run it through
  WSL: `wsl.exe -e ./temp/actionlint/actionlint .github/workflows/<file>.yml`
  (pinned to match the CI actionlint version). Quick structural sanity without it:
  `python -c "import yaml; yaml.safe_load(open('.github/workflows/<file>.yml'))"`.
- **Docker Desktop wedge:** the named pipe accepts connections but `docker info`
  500s and `docker ps`/`docker version` hang, blocking the backend `db` container.
  Recover (Docker-only, consistent with the no-blanket-kill rule):
  `wsl --terminate docker-desktop` (leaves the Codex `Ubuntu` distro running); if
  the manager is also wedged, `Stop-Process -Name 'Docker Desktop','com.docker.backend','com.docker.build' -Force`;
  relaunch Docker Desktop; poll `until docker ps`. Go straight to this cycle if a
  cold start hasn't come up after a few minutes.

## When you actually need to RUN the JS toolchain — delegate to Codex

When a task needs the JS toolchain *run* (not just verified via CI) and the
Windows host can't — e.g. applying a Prettier reformat to fix a Dependabot PR —
delegate the mutation to **Codex** (it runs in WSL with a working `node_modules`).
Hand it a **bounded** action ("checkout the branch, `pnpm install --frozen-lockfile`,
`pnpm run format`, verify `pnpm run format:check`, confirm the diff is
formatting-only, commit with a `style:` message and **no AI attribution**, push")
so it doesn't over-reach. See `AGENTS.md` for how Codex runs here.

## Related

- `testing-ci.md` — the local CI mirror + the CI-only gotchas (release-age gate,
  mergeability check, mobile lint rules).
- `codex-review-process.md` / `AGENTS.md` — the WSL↔Windows path boundary and how
  Codex operates on this workspace.
- `mobile/README.md` — the mobile app structure, runtime config, and map/prebuild
  specifics.
