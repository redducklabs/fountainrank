# Release and store build runbook

This is the operator runbook for repeating the web deploy and mobile store build
flows. It intentionally records the prompts and Apple/EAS edge cases observed
during the first release passes.

Do not commit secrets, signing material, `.p8` keys, `.p12` certificates,
provisioning profiles, App Store Connect API keys, Play service-account JSON, or
downloaded store binaries. Keep build artifacts under ignored/local paths such
as `builds/`.

## Prerequisites

Run from WSL in this repo:

```bash
cd /mnt/d/repos/fountainrank
gh auth status
git fetch origin main --prune
git checkout main
git pull --ff-only
git status --short --branch
```

Expected clean baseline for release work is `main...origin/main`. It is okay to
have unrelated local edits only if the command you run explicitly targets
`origin/main` or the intended artifact path and does not include those edits.

EAS commands should use the WSL-local `pnpm dlx` form. The Windows global `eas`
wrapper can hang when called from WSL.

```bash
cd /mnt/d/repos/fountainrank/mobile
pnpm dlx eas-cli@20.3.0 whoami
```

Expected account access includes `red-duck-labs`.

## Web production deploy

The web app deploys through GitHub Actions, never from the local machine. The
deploy workflow is tag-triggered:

- Workflow: `.github/workflows/deploy.yml`
- Trigger: pushing a tag matching `v*.*.*`
- Behavior: builds and pushes backend + web images, applies Kubernetes
  manifests, runs migrations, and waits for DOKS rollouts.

The release tag is the all-surface production release switch. Pushing one
`vX.Y.Z` tag starts both production workflows:

- `Deploy` — web/backend image build and DOKS deploy.
- `Mobile Store Release` — Android/iOS EAS builds and store submission.

Only push a `vX.Y.Z` tag when the release is intended to go everywhere: web,
Android internal testing, and App Store Connect/TestFlight. Do not use release
tags for web/backend-only changes. For a web/backend-only redeploy, run the
`Deploy` workflow manually with `workflow_dispatch` instead.

Do not create ad hoc mobile store builds for a normal all-surface release. If a
mobile store build fails, rerun `Mobile Store Release` from GitHub Actions or use
its manual dispatch for the affected platform.

### Create the next version tag

List existing tags:

```bash
git tag --sort=-v:refname | head -20
git ls-remote --tags origin 'vX.Y.Z'
```

Create the next tag from the current remote `main` commit:

```bash
git tag -a vX.Y.Z origin/main -m "vX.Y.Z"
git push origin vX.Y.Z
```

Example from the first mobile-map release:

```bash
git tag -a v0.7.0 origin/main -m "v0.7.0"
git push origin v0.7.0
```

### Monitor deploy

Find the deploy run:

```bash
gh run list --repo redducklabs/fountainrank --workflow Deploy --limit 5 \
  --json databaseId,status,conclusion,headBranch,headSha,displayTitle,event,createdAt,url \
  --jq '.[] | {databaseId,status,conclusion,headBranch,headSha,displayTitle,event,createdAt,url}'
```

Watch it:

```bash
gh run watch <run-id> --repo redducklabs/fountainrank --exit-status
```

If the watcher is interrupted, check final state directly:

```bash
gh run view <run-id> --repo redducklabs/fountainrank \
  --json status,conclusion,jobs,url \
  --jq '{status, conclusion, url, jobs: [.jobs[] | {name,status,conclusion,url}]}'
```

The deploy is complete only when both jobs are `success`:

- `Build + push images`
- `Deploy to DOKS`

## Mobile store automation

Mobile store builds and submissions run through GitHub Actions:

- Workflow: `.github/workflows/mobile-store-release.yml`
- Primary trigger: pushing a tag matching `v*.*.*`
- Manual trigger: `workflow_dispatch`, with `platform` set to `all`,
  `android`, or `ios`
- Behavior: EAS builds the selected platform(s) with the `production` profile and
  auto-submits the finished build using the `production` submit profile.

This workflow is the preferred release path. Do not manually upload downloaded
`.aab` or `.ipa` files when the workflow can submit through EAS.

Each mobile store job has a 90-minute timeout. The workflow waits for EAS cloud
builds and submissions so a failed store submit is visible in GitHub Actions
instead of becoming another manual follow-up.

Required production GitHub secret:

- `EXPO_TOKEN` — Expo access token for the `red-duck-labs` account/org.

Required EAS-managed store credentials:

- Android: Google Play service-account key configured in EAS Submit.
- iOS: App Store Connect credentials/API key configured in EAS Submit for ASC
  app id `6782199873`.

GitHub Actions can only preflight `EXPO_TOKEN`. Google Play and App Store
Connect submit credentials are managed by EAS; if they are missing or invalid,
the relevant EAS auto-submit step fails the job.

The intended steady-state release path is:

1. Merge to `main`.
2. Let `CI` and `Security audit` pass on `main`.
3. Confirm the mobile app marketing version in `mobile/app.config.ts` is the
   intended store-facing version before tagging. The workflow does not derive the
   Expo marketing version from the git tag. EAS remote build numbers
   (`appBuildVersion`) increment independently from both values.
4. Push one `vX.Y.Z` tag from `origin/main`.
5. Let `Deploy` publish web/backend.
6. Let `Mobile Store Release` build and submit Android + iOS through EAS.
7. Do not download or manually upload store binaries.

Monitor a mobile store release:

```bash
gh run list --repo redducklabs/fountainrank --workflow "Mobile Store Release" --limit 5 \
  --json databaseId,status,conclusion,headBranch,headSha,displayTitle,event,createdAt,url \
  --jq '.[] | {databaseId,status,conclusion,headBranch,headSha,displayTitle,event,createdAt,url}'
```

Watch it:

```bash
gh run watch <run-id> --repo redducklabs/fountainrank --exit-status
```

The workflow is complete only when the selected jobs are `success`:

- `Android build + Play internal submit`
- `iOS build + App Store Connect submit`

## Android AAB build

Production Android builds use EAS and produce an app bundle (`.aab`) because
`mobile/eas.json` sets:

```json
"production": {
  "autoIncrement": true,
  "android": {
    "buildType": "app-bundle"
  }
}
```

Kick off the build:

```bash
cd /mnt/d/repos/fountainrank/mobile
pnpm dlx eas-cli@20.3.0 build --platform android --profile production --non-interactive --no-wait
```

Useful checks:

```bash
pnpm dlx eas-cli@20.3.0 build:view <build-id> --json
```

Observed behavior:

- EAS loads the `production` environment from Expo.
- Android `versionCode` is remote-managed and auto-incremented.
- Production builds use the remote Android keystore on Expo.
- The build URL looks like:
  `https://expo.dev/accounts/red-duck-labs/projects/fountainrank/builds/<build-id>`.

### Android version-code guardrail

Google Play permanently consumes an Android `versionCode` as soon as an AAB is
accepted into any release, including a draft internal-testing release. If Play
says a version code has already been used, do not upload that same AAB again.
Find the existing draft/release that contains that version code and finish or
discard that Play Console release. A new upload requires a new EAS build with a
higher version code.

Before starting an Android store build, record the current remote EAS version:

```bash
cd /mnt/d/repos/fountainrank/mobile
pnpm dlx eas-cli@20.3.0 build:version:get --platform android
```

After the build finishes, verify the build metadata and record the assigned
`appBuildVersion`:

```bash
pnpm dlx eas-cli@20.3.0 build:view <android-build-id> --json
```

The `appBuildVersion` is the Google Play `versionCode`. Treat the downloaded
`.aab` as a single-use artifact:

- Upload it only once.
- If Google Play reports `version code <n> has already been used`, stop
  uploading and look for the existing draft/release that already contains
  version code `<n>`.
- If Play Console shows the app bundle under `Latest app bundles` with release
  status `Inactive`, that version code is still consumed. It may not appear as an
  active release, but it still cannot be uploaded again.
- Discarding a draft release does not free the version code from an already
  uploaded AAB. If the only available Play Console action is to discard the
  draft, discard it, then create a new EAS Android build with a higher
  `appBuildVersion`.
- Do not create a second Play Console release with the same `.aab`.
- Do not hand the same `.aab` back to the owner as a "new" build after Play has
  accepted it.

Preferred Android submission flow, once the Play service-account key is
configured in EAS, is to submit by EAS build ID instead of manually downloading
and uploading an AAB:

```bash
pnpm dlx eas-cli@20.3.0 submit --platform android --profile production --id <android-build-id> --wait
```

For fully automated builds, use EAS auto-submit with the production submit
profile:

```bash
pnpm dlx eas-cli@20.3.0 build --platform android --profile production --auto-submit-with-profile production
```

If EAS Submit fails with:

```text
Google Service Account Keys cannot be set up in --non-interactive mode.
```

then Google Play submission is not yet automated. Configure the Play service
account outside the repo before relying on automated Android submit.

## iOS build

Kick off the iOS production build:

```bash
cd /mnt/d/repos/fountainrank/mobile
pnpm dlx eas-cli@20.3.0 build --platform ios --profile production
```

To suppress the Expo Go production warning:

```bash
EAS_BUILD_NO_EXPO_GO_WARNING=true pnpm dlx eas-cli@20.3.0 build --platform ios --profile production
```

### Export compliance prompt

EAS may ask:

```text
iOS app only uses standard/exempt encryption?
```

For this app, answer `yes` unless the app has gained custom/non-exempt
encryption. With a dynamic config, EAS cannot write this automatically and may
print:

```text
Cannot automatically write to dynamic config at: app.config.ts
Add the following to app.config.ts:
{
  "ios": {
    "infoPlist": {
      "ITSAppUsesNonExemptEncryption": false
    }
  }
}
```

The required Expo config location is under the existing `ios.infoPlist` object:

```ts
ios: {
  bundleIdentifier: "com.redducklabs.fountainrank",
  buildNumber: "1",
  infoPlist: {
    ITSAppUsesNonExemptEncryption: false,
    NSLocationWhenInUseUsageDescription:
      "FountainRank uses your location to show nearby drinking fountains and to place a fountain you add.",
  },
},
```

After changing config, verify:

```bash
pnpm --filter mobile typecheck
```

### Apple login prompt

EAS may ask:

```text
Log in to your Apple Developer account to continue
Apple ID:
```

Use the Apple ID email that has access to the Red Duck Labs Apple Developer
Program team.

Observed team/provider values:

- Team: `Red Duck Labs, LLC (VPQ79Y3WQ7)`
- Provider: `Red Duck Labs, LLC (129064103)`
- Bundle identifier: `com.redducklabs.fountainrank`

### Capability sync failure

Observed failure:

```text
Failed to patch capabilities: [ { capabilityType: 'APPLE_ID_AUTH', option: 'OFF' } ]
Failed to sync capabilities com.redducklabs.fountainrank
Auto capability syncing can be disabled with the environment variable `EXPO_NO_CAPABILITY_SYNC=1`.
```

Rerun with capability sync disabled:

```bash
EXPO_NO_CAPABILITY_SYNC=1 pnpm dlx eas-cli@20.3.0 build --platform ios --profile production
```

This is acceptable when the bundle identifier already exists and the app config
does not require EAS to add a new entitlement during the build.

### Distribution certificate prompt

EAS may say it fetched Apple distribution certificates and ask:

```text
Generate a new Apple Distribution Certificate? (Y/n)
```

If this is the first iOS build for this EAS project, or if no `.p12` certificate
export is available, answer `Y` and let EAS create/manage the certificate.

Answer `n` only if you already have a valid Apple Distribution Certificate
exported as a `.p12` file with its password. If EAS asks for a path to the `.p12`
file, use an absolute WSL path, for example:

```text
/mnt/d/path/to/certificate.p12
```

A `.p8` file is not a `.p12` certificate. `.p8` files are typically App Store
Connect API keys or Sign in with Apple keys. They cannot sign an IPA.

Apple usually does not let you download a private-key-bearing `.p12` after a
certificate was created. The `.p12` requires the private key from the machine or
keychain that originally generated the certificate signing request. If that was
not exported, let EAS generate a new managed certificate.

## Submit an IPA to App Store Connect

If you already have an IPA locally, submit it with EAS Submit:

```bash
cd /mnt/d/repos/fountainrank/mobile
pnpm dlx eas-cli@20.3.0 submit --platform ios --path /absolute/path/to/build.ipa
```

Example for a repo-local ignored artifact:

```bash
pnpm dlx eas-cli@20.3.0 submit --platform ios --path /mnt/d/repos/fountainrank/builds/v0.0.2.ipa
```

If this is run from a non-interactive automation context, EAS can fail after
uploading because it needs to prompt for Apple credentials:

```text
Authentication with Apple Developer Portal failed!
Input is required, but stdin is not readable. Failed to display prompt: Apple ID:
```

Run the command in an interactive terminal when Apple login is required.

### App Store Connect API key values

If using a `.p8` App Store Connect API key for submit, EAS needs all of:

- Issuer ID
- Key ID
- Private key path (`.p8`)

Find the Issuer ID in App Store Connect:

1. Go to <https://appstoreconnect.apple.com>.
2. Open `Users and Access`.
3. Open the `Integrations` tab.
4. Select `App Store Connect API`.
5. Copy the `Issuer ID`.

The Issuer ID is a UUID from App Store Connect. It is not the Apple Developer
Team ID and not the `.p8` filename.

## TestFlight public link activation

The public TestFlight link does not become active just because a group exists.
If App Store Connect shows:

```text
Testers cannot join public link until this group has an approved build.
```

then assign an approved beta build to that external tester group.

Flow:

1. Upload the IPA.
2. Wait for Apple to finish processing the build.
3. In App Store Connect, open `My Apps -> FountainRank -> TestFlight`.
4. Select the build.
5. Complete missing export-compliance and beta-review info.
6. Add the build to the external tester group.
7. Submit for Beta App Review if Apple prompts.
8. After approval, the public link works.

Internal testers can usually use a processed build without Beta App Review.
External testers and public links require Apple beta approval.

## Add internal App Store Connect users

Apple's expected flow:

1. Open <https://appstoreconnect.apple.com>.
2. Go to `Users and Access -> People`.
3. Click the `+` button above the user list.
4. Enter name, email, role, and app access.
5. After the invite is accepted, add the user to the TestFlight internal group.

If the `+` button is missing even though the current account is `Account Holder`
or `Admin`:

- Click `Cancel` if the page is in edit/selection mode.
- Refresh the page.
- Clear search/filter controls.
- Try a private/incognito window or another browser.
- Zoom out in case the control is off-screen.

Apple documents that `Account Holder`, `Admin`, or `App Manager` can add users
from `Users and Access -> People`.

## Useful status commands

EAS:

```bash
cd /mnt/d/repos/fountainrank/mobile
pnpm dlx eas-cli@20.3.0 whoami
pnpm dlx eas-cli@20.3.0 build:list --platform all --limit 5
pnpm dlx eas-cli@20.3.0 build:view <build-id> --json
```

GitHub deploys:

```bash
gh run list --repo redducklabs/fountainrank --workflow Deploy --limit 5
gh run view <run-id> --repo redducklabs/fountainrank --log-failed
```

Local state:

```bash
git status --short --branch
git log --oneline -5
```
