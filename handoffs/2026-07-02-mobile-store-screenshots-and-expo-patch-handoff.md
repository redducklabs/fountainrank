# Mobile store screenshots (Phase 1) + Expo SDK-56 patch CI fix — handoff (2026-07-02)

**Source:** the session that captured the first **real Android store screenshots** (Phase 1 of
promoting the mobile apps from internal-testing to public release) and, along the way, fixed the
pre-existing **repo-wide `mobile-doctor` CI red** caused by Expo shipping SDK-56 patch updates on
2026-07-01.

**Goal of the larger effort (owner):** submit both apps for **public** store approval (currently
internal-testing only). That needs real screenshots (Phase 1 ✅), iOS screenshots (Phase 2), store
metadata/automation (Phase 3), and console-only policy forms. Only Phase 1 shipped this session.

---

## ✅ What shipped this session (both merged to `main`, both squash-merged)

### 1. Real Android store screenshots — PR **#148** (`fabbf41`, owner-merged)
- **5 real captures** of the release-UI app on the `fountainrank` Android emulator (San Diego
  basemap, production API, clean demo-mode status bar), all **1080×1920 24-bit RGB**, replacing the
  generated mockups in `mobile/assets/store/screenshots/play-store/`:
  `01-map-discovery`, `02-fountain-detail`, `03-search`, `04-rating-filter`, `05-rankings`.
- Removed the obsolete play-store mockups (`03-contribute`/`04-add-fountain`/`05-account-diagnostics`
  — auth-gated screens not capturable in public-read).
- **iOS mockups (`app-store-6-9/`, `app-store-6-5/`) are UNCHANGED — still generated mockups**
  pending real iPhone captures (Phase 2).
- Docs updated: `mobile/assets/store/screenshots/README.md` (Android-real vs iOS-mockup split + the
  **capture recipe**) and `docs/setup/07-mobile-store-readiness.md`. Codex PR review APPROVED on
  content (only blocker was the CI red below).

### 2. Adopt Expo SDK-56 patch releases / fix `mobile-doctor` — PR **#150** (`ed4a2a8`, Codex-APPROVED)
- Expo published SDK-56 patches on 2026-07-01; `expo-doctor` immediately demanded them, so
  `mobile-doctor` went **red on every branch including `main`** (it was NOT caused by the screenshots
  PR). Fixed by adopting the five patches: `expo` 56.0.13, `expo-constants`/`expo-location` 56.0.19,
  `expo-router` 56.2.12, `expo-splash-screen` 56.0.11.
- **Owner-approved trade-off:** these patches are a *coordinated* set that can't be cherry-picked (see
  gotcha below), so the fix is a **full lockfile re-resolve** — it also moved ~53 unrelated aged-in
  transitives to latest patch (e.g. `react-native-worklets` 0.9.2→0.10.1, `@typescript-eslint`
  8.62.1, radix-ui, browserslist). `pnpm-audit` stayed green (no new vulns).
- **`main` CI is fully green** after the merge (verified run `28615059419`: `mobile-doctor`,
  `workspace-js`, `backend`, all checks SUCCESS).

---

## ⚠️ CRITICAL gotchas (read before ANY mobile Expo/dependency work — these cost most of the session)

1. **`nodeLinker: hoisted` MASKS `expo-doctor`'s duplicate-dependency check → local expo-doctor lies.**
   The local, skip-worktree'd `pnpm-workspace.yaml` sets `nodeLinker: hoisted` (a Windows MAX_PATH
   workaround — see [[fountainrank-local-android-build-windows]]). Hoisting flattens/dedupes
   `node_modules`, so local `pnpm dlx expo-doctor` reports a **false 21/21** while CI's default
   **isolated** linker fails the duplicate check. **CI (or an isolated-linker run) is the source of
   truth.** To reproduce CI locally: `PNPM_CONFIG_NODE_LINKER=isolated CI=true pnpm install
   --frozen-lockfile && PNPM_CONFIG_NODE_LINKER=isolated pnpm dlx expo-doctor` (Codex-in-WSL also
   reproduces CI). See [[fountainrank-hoisted-linker-masks-expo-doctor-duplicates]].

2. **Expo SDK patch releases are a COORDINATED set — do not cherry-pick.** `expo-router@56.2.12`
   raises its **optional** `@expo/metro-runtime` peer to `^56.0.16`, and pnpm will not upgrade an
   optional peer incrementally. Two dead ends found this session: (a) declaring `@expo/metro-runtime`
   a direct mobile dep pulls its web `react-dom` peer and **bridges mobile↔web react** (web pins
   `react@19.2.7`, mobile `19.2.3`) → duplicate; (b) a partial bump leaves `expo-constants` skewed
   vs the unchanged `expo-linking`. The only clean adopt is a **full re-resolve** (`rm pnpm-lock.yaml
   && rm -rf node_modules && pnpm install`). **For future SDK maintenance, use `npx expo install
   --fix`** rather than hand-bumping.

3. **`pnpm-workspace.yaml` is skip-worktree'd and local-only.** The committed version has only
   `packages` + `allowBuilds`; `nodeLinker: hoisted` + `minimumReleaseAge*` live only in the local
   working copy (`git ls-files -v` shows `S`). CI has **no** min-release-age gate — the committed
   lockfile governs CI. Don't try to commit overrides there (pnpm 11 ignores `pnpm.overrides` in
   package.json anyway).

4. **Android screenshot capture recipe** is documented in
   `mobile/assets/store/screenshots/README.md` → "Android real captures": emulator + `wm size
   1080x1920` + `adb emu geo fix -117.162 32.715` (San Diego, 360+ fountains) + demo-mode status bar
   + `adb exec-out screencap -p` + flatten RGBA→RGB (Pillow). The app was run from the **existing
   debug APK + Metro started from `mobile/`** (release build attempt got killed; STALE-METRO trap bit
   again — a root-launched Metro 404s the bundle: start from `mobile/`). Emulator `fountainrank` is
   still set up if more captures are wanted.

---

## 🔵 Outstanding work toward the actual public release

1. **Phase 2 — iOS screenshots (owner-gated, needs iPhone).** No Mac in the build env, so the iOS
   simulator cannot be driven here — real iOS captures require a **physical iPhone**. **Blocked on the
   owner's iPhone MODEL** (determines the App Store slot: 6.9" = `1290×2796`, 6.5" = `1242×2688`, a
   6.1" needs scaling). **Deliverable owed:** an exact per-screen shot list + steps mirroring the
   Android set (use the in-app search to reach a fountain-dense city; tap the ★3.5 Embarcadero
   fountain for the rich detail shot). Then replace `app-store-6-9/` + `app-store-6-5/` mockups.

2. **Phase 3 — automate the scriptable promotion (not started).** `fastlane supply` (Google Play:
   listing text + screenshots + internal→production track promotion) and **EAS Metadata**
   (`store.config.json`) or `fastlane deliver` (Apple: metadata + screenshots + submit). Wire to **CI
   with secrets** (repo rule: store mutations from CI, never local). Needs owner credentials: App
   Store Connect API key (issuer/key id/.p8) and the Play service-account JSON — kept out of the repo.

3. **Console-only steps (NOT scriptable — owner must do in-console):** Apple **App Privacy** nutrition
   label, Google **Data Safety** form, content/age ratings (both stores), category selection. Draft
   inputs are in the metadata worksheet in `docs/setup/07-mobile-store-readiness.md`.

4. **Google Play production-access gate (possible hard blocker):** personal developer accounts created
   after Nov-2023 must run **closed testing with ~20 testers for 14 continuous days** before Google
   grants production access. **Owner should check Play Console status** — this blocks going public
   regardless of screenshots.

5. **After store listings have public URLs:** set `NEXT_PUBLIC_APP_STORE_URL` /
   `NEXT_PUBLIC_GOOGLE_PLAY_URL` on the web deploy (footer badges hide until present).

---

## 📝 Notes / data reality

- **Screenshot data honesty:** the map/search screens are public-read → **pixel-identical to
  production**. The `02-fountain-detail` (3.5★, per-dimension ratings, features/accessibility) and
  `05-rankings` shots use **seed/test-account data** (leaderboard names like "A-Rizzle fo Shizzle",
  "Soooozie", "Gaia Weiler"; a single seeded 3.5★ fountain at the Embarcadero). The UI is real; the
  data is representative, not organic. Owner accepted this for now.
- The owner took their **own 4 device screenshots** mid-session and asked to commit them, but they had
  a black camera-cutout dot in the status bar + irregular sizes (`1076×1913` etc.); owner then chose
  to **keep the clean 5** instead. Those device files were discarded.
- **`docs/design/gamification/app-store-descriptions.md`** — owner was rewriting the store copy to a
  "gamified"/leaderboard tone in parallel; that was their WIP (working tree is clean now, so handled).

---

## 🔁 Process gate (unchanged — per `CLAUDE.md`)

branch → PR → **CI green AND Codex `VERDICT: APPROVED` AND every PR comment addressed** →
**squash-merge**. Codex PR review in bypass mode (`sandbox:"danger-full-access"`,
`approval-policy:"never"`), WSL `cwd` `/mnt/d/repos/fountainrank`, repo-relative paths, loop until
APPROVED. **No AI attribution, no time estimates.** New UI → `docs/style-guide.md`. Handoff/docs
commits go direct to `main`. Mobile deploy/store-release is manual dispatch and owner-gated.

**Store readiness reference:** `docs/setup/07-mobile-store-readiness.md` (metadata worksheet, asset
checklist, data-flow inventory for privacy forms) and `mobile/assets/store/screenshots/README.md`
(capture recipe + upload guide).
