# Handoff — FountainRank mobile store testing state (2026-06-25)

This handoff supersedes the older 6e-7 add-fountain handoff. The app has moved
from "prepare store readiness" into **first store testing/release operations**.
Use this file to resume after clearing the conversation.

## Current State

- Current branch: `main`.
- Current `main` head at handoff time: `3fdf17e fix(mobile): declare Expo Babel preset (#78)`.
- PR #75 merged: store readiness plan/docs.
- PR #76 merged: store launch assets.
- PR #77 merged: store screenshots and screenshot generator.
- PR #78 merged: declared `babel-preset-expo` directly so Android EAS release bundling works.
- Android production EAS build **succeeded** after #78.
- Owner uploaded the Android AAB to Google Play as an **internal testing release**.
- Owner reports Android internal testing is now working.
- App Store Connect and Google Play app records exist.
- Logto native callback is confirmed as:
  `com.redducklabs.fountainrank://callback`.
- EAS production public env vars are configured:
  - `EXPO_PUBLIC_LOGTO_NATIVE_AUTH_CONFIRMED=true`
  - `EXPO_PUBLIC_LOGTO_APP_ID=oikth3qbmnrhqd9jmkbc8`

## Important Build Artifacts

Successful Android production build:

- EAS build ID: `eb104be4-c142-44dd-849c-5128ec00648d`
- Build URL:
  `https://expo.dev/accounts/red-duck-labs/projects/fountainrank/builds/eb104be4-c142-44dd-849c-5128ec00648d`
- AAB URL:
  `https://expo.dev/artifacts/eas/FBCZOkwGdCmX8AtsuO85Qegvdj3JwZEYeSgPUO40C6k.aab`
- Android versionCode: `4`
- Git commit built: `3fdf17ef02fec15c7e44751e29c1ee0482ea6537`
- Commit message: `fix(mobile): declare Expo Babel preset (#78)`

Prior failed Android build:

- Build ID: `f922541a-188b-4fe9-9107-e070bb76127e`
- Failed in `:app:createBundleReleaseJsAndAssets`.
- Root cause from EAS log:
  `Failed to construct transformer: Error: Cannot find module 'babel-preset-expo'`.
- Fixed by #78, which adds `babel-preset-expo@56.0.15` to `mobile/devDependencies`.

## Store Assets

Store assets are in repo:

- App Store 6.5 screenshots:
  `mobile/assets/store/screenshots/app-store-6-5/*.png`
- App Store 6.9 screenshots:
  `mobile/assets/store/screenshots/app-store-6-9/*.png`
- Play Store screenshots:
  `mobile/assets/store/screenshots/play-store/*.png`
- Play feature graphic:
  `mobile/assets/store/play-feature-graphic.png`
- Other launch assets from #76 are under `mobile/assets/store/`.

Owner already uploaded the screenshots/assets needed to proceed in the store
consoles.

## Verified Work And Gates

PR #78:

- URL: `https://github.com/redducklabs/fountainrank/pull/78`
- State: merged.
- Merge commit: `3fdf17ef02fec15c7e44751e29c1ee0482ea6537`
- CI: green.
- CodeQL: green.
- Security audit: green, including `pnpm-audit` after a long run.
- Claude review: approved.
- Claude review artifact:
  `temp/claude-reviews/pr-78-review-1.md`
- Claude review verdict:
  `VERDICT: APPROVED`

Local verification run for #78:

```bash
pnpm --filter mobile run lint
pnpm --filter mobile run typecheck
pnpm --filter mobile run test
cd mobile && CI=true pnpm dlx expo-doctor
EXPO_PUBLIC_LOGTO_NATIVE_AUTH_CONFIRMED=true EXPO_PUBLIC_LOGTO_APP_ID=oikth3qbmnrhqd9jmkbc8 pnpm --filter mobile exec expo export --platform android --output-dir /tmp/fountainrank-export-android-fix --clear
pnpm install --frozen-lockfile
pnpm run format:check
pnpm --filter web run lint
pnpm --filter web run typecheck
pnpm exec turbo run build --filter=web
cd backend && uv run ruff check . && uv run ruff format --check .
```

Local caveats:

- `./run.ps1 check` could not run directly in WSL because `pwsh` is not installed
  and the script shebang is not usable from this WSL environment.
- Full local workspace Vitest hit WSL worker startup timeouts in web tests; PR CI
  `workspace-js` passed and is the source of truth.
- Backend DB-backed local tests were not run because Docker was not available at
  `/var/run/docker.sock`; PR CI backend job passed against PostGIS.

## Android Status

Android is past the first build/distribution blocker.

Done:

- Android app record exists in Google Play Console.
- Android AAB versionCode `4` built successfully on EAS.
- Owner uploaded the AAB as an internal testing release.
- Owner added tester emails.
- Owner got internal testing working.

Known submit state:

- Non-interactive EAS submit failed only because the Google Service Account key
  is not configured in EAS:

```text
Google Service Account Keys cannot be set up in --non-interactive mode.
```

This is not a build/code failure. For future automated Android submit, run
interactive submit once and configure the Google service account key in EAS:

```bash
cd /mnt/d/repos/fountainrank/mobile
pnpm dlx eas-cli@20.3.0 submit --platform android --profile production --latest
```

Do not paste credentials, service account JSON, or private keys into chat or
commit them. Let EAS store the submit credential.

## iOS Status

iOS still needs first interactive credential setup and build.

Previous non-interactive iOS build attempt failed before queueing because EAS
distribution credentials were not configured:

```text
Distribution Certificate is not validated for non-interactive builds.
Failed to set up credentials. Credentials are not set up. Run this command again in interactive mode.
```

Next iOS action:

```bash
cd /mnt/d/repos/fountainrank/mobile
pnpm dlx eas-cli@20.3.0 build --platform ios --profile production
```

Let EAS manage the Apple distribution certificate and provisioning profile for:

```text
com.redducklabs.fountainrank
```

After the iOS build succeeds:

```bash
cd /mnt/d/repos/fountainrank/mobile
pnpm dlx eas-cli@20.3.0 submit --platform ios --profile production --latest
```

Do not share Apple credentials, 2FA codes, certificates, provisioning profiles,
or keys in chat or commit them.

## App Store Connect Note

EAS warned:

```text
app.config.ts is missing ios.infoPlist.ITSAppUsesNonExemptEncryption boolean.
Manual configuration is required in App Store Connect before the app can be tested.
```

Do not blindly hardcode the export-compliance answer. The owner must confirm the
legal/export-compliance answer in App Store Connect. The app uses standard
HTTPS/auth crypto, but the declaration is still an owner/legal account decision.

## Immediate Next Steps

1. **Android smoke test from internal testing**
   - Install from the internal testing opt-in link.
   - Confirm app launches.
   - Confirm production map loads.
   - Confirm native Logto sign-in callback returns to the app.
   - Confirm authenticated write flows:
     - existing fountain rating
     - condition report
     - attribute observation
     - note
     - add fountain

2. **iOS credential/build path**
   - Run interactive EAS iOS production build.
   - Submit the successful iOS build to App Store Connect/TestFlight.
   - Answer App Store Connect export-compliance prompts.
   - Add testers and verify TestFlight installation.

3. **Automated submit follow-up**
   - Configure Google Play service account key in EAS via interactive submit.
   - Optionally configure Apple submit credentials if needed.
   - Do not commit credential material.

4. **CI follow-up recommended by Claude**
   - Add a future CI smoke step for release bundling, for example an Android
     `expo export --platform android` check, so missing Babel/build-time
     dependencies are caught before EAS.
   - This is a follow-up; it was not required for #78.

5. **Store listing / review**
   - Android internal testing works, but production Play release is a separate
     review/release flow.
   - iOS cannot proceed to TestFlight until the first iOS production build and
     App Store Connect setup are completed.

## Useful Commands

Check current repo state:

```bash
cd /mnt/d/repos/fountainrank
git status --short --branch
git log --oneline -8 --decorate
gh pr view 78 --json state,mergedAt,url,mergeCommit
gh run list --branch main --limit 10
```

Check EAS auth/project:

```bash
cd /mnt/d/repos/fountainrank/mobile
pnpm dlx eas-cli@20.3.0 whoami
pnpm dlx eas-cli@20.3.0 build:list --platform android --limit 5
pnpm dlx eas-cli@20.3.0 build:list --platform ios --limit 5
```

Rebuild Android production if needed:

```bash
cd /mnt/d/repos/fountainrank/mobile
EAS_BUILD_NO_EXPO_GO_WARNING=true pnpm dlx eas-cli@20.3.0 build --platform android --profile production --non-interactive --no-wait
```

Interactive iOS build:

```bash
cd /mnt/d/repos/fountainrank/mobile
pnpm dlx eas-cli@20.3.0 build --platform ios --profile production
```

Android submit after credentials are configured:

```bash
cd /mnt/d/repos/fountainrank/mobile
pnpm dlx eas-cli@20.3.0 submit --platform android --profile production --latest
```

iOS submit after build succeeds:

```bash
cd /mnt/d/repos/fountainrank/mobile
pnpm dlx eas-cli@20.3.0 submit --platform ios --profile production --latest
```

## Process Reminders

- For any repo change: branch -> PR -> CI green -> Claude review approval ->
  address comments -> squash merge.
- Use `gh` for GitHub operations.
- Verify `gh auth status` before GitHub operations.
- Do not merge with failing or pending required checks.
- Do not commit secrets, service-account JSON, certificates, provisioning
  profiles, private keys, tokens, or `.env` values.
- Do not expose local/internal services publicly.
- Do not make database writes unless explicitly requested.
- Do not run local state-mutating Terraform/Kubernetes/Helm/cloud operations.
- No AI attribution in commits, PRs, changelogs, docs, or handoffs.
- No time estimates unless explicitly asked.

## Current Git Caveat At Handoff Time

At the time this file was updated, `git status --short --branch` showed:

```text
## main...origin/main
M  .gitignore
A  handoffs/2026-06-24-slice-6e-7-add-fountain-merged-handoff.md
```

The `.gitignore` change (`builds/`) existed before this handoff update in the
working tree and was not made by this handoff edit. Do not revert it unless the
owner explicitly asks. This handoff file is also currently an added working-tree
file unless a later agent commits it.
