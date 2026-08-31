# Photo Upload and Location Freshness Release Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reduce photo-upload payloads before network transfer and show the age of the last successful location fix on web and mobile, then ship both clients from one green PR.

**Architecture:** Each platform gets a focused photo-processing adapter that applies the same 2048-pixel/1.5-MB policy before the existing transport. Location timestamps are captured at the existing successful-fix convergence points and rendered by isolated one-second display components; failures never erase a known successful timestamp and timers never request GPS. Existing backend image validation remains authoritative.

**Tech Stack:** Next.js 16, React 19, browser Canvas APIs, Expo SDK 57, React Native 0.86, Expo Image Manipulator, MapLibre GL/RN, TypeScript, Vitest, GitHub Actions, EAS Build/Submit.

**Spec:** This plan is the owner-approved implementation spec for the two prepared ticket descriptions from 2026-08-30. It remains under `docs/superpowers/plans/` because the required execution skill owns that location; the PR description will link it directly for repository discoverability.

## Global Constraints

- Both features, relevant Dependabot updates, and the mobile version bump land on `feat/photo-location-release` and one PR.
- The release also carries the coordinated Expo SDK 57 / React Native 0.86 migration required to clear the authoritative mobile-doctor gate; it must pass the same native device verification before store dispatch and no gate may be suppressed.
- Photo uploads use a 2048-pixel maximum long edge, never enlarge, pixel-roundtrip to JPEG, bake EXIF orientation into upright pixels before stripping metadata, and target at most 1,500,000 bytes through bounded quality attempts.
- Client processing failure starts no upload. The backend 10-MB limit, validation, normalization, metadata stripping, thumbnailing, quotas, and storage behavior remain unchanged.
- Location copy is `Location refreshed <N>s ago`; before any successful fix it is `Location unavailable`.
- Initial, manual, and watch fixes update freshness. Failed/denied/unavailable attempts do not clear or reset a known successful timestamp.
- Per-second display timers trigger no GPS calls, clean up on unmount, and are not live-announced every second.
- Update `docs/style-guide.md`; log preparation failures only with a stable event, stage, and error name, and never log coordinates, image contents, EXIF, secrets, or raw PII.
- Bump the default mobile app version from `1.0.4` to `1.0.5`; EAS remotely auto-increments platform build numbers.
- Deploy only through GitHub Actions after squash-merging a green, independently approved PR.

---

### Task 1: Web photo preprocessing

**Files:**
- Create: `web/lib/photo-processing.ts`
- Create: `web/lib/photo-processing.test.ts`
- Modify: `web/components/fountain/PhotoUpload.tsx`
- Modify: `web/components/fountain/PhotoUpload.test.tsx`

**Interfaces:**
- Produces `preparePhotoForUpload(file: File): Promise<File>`.
- Existing `uploadPhoto(fountainId, formData)` remains unchanged and consumes the processed JPEG.

- [ ] Write failing tests for resize math, no enlargement, JPEG conversion, bounded quality fallback, exact byte boundary, white transparency background, terminal processing errors, and a non-1 EXIF-orientation image whose output pixels are upright.
- [ ] Run the focused tests and confirm failures are caused by the missing processor.
- [ ] Implement a dependency-injectable Canvas/ImageBitmap processor that honors `imageOrientation: "from-image"`, using quality attempts `0.85, 0.75, 0.65, 0.55, 0.45` and a 1,500,000-byte target.
- [ ] Write failing component tests proving processing gates only photo transport; an independent pending rating is still submitted when photo preparation fails.
- [ ] Integrate processing into `PhotoUpload`, reset the input in `finally`, present a retryable preparation error, and emit privacy-safe diagnostic logging.
- [ ] Run focused web tests and commit the task.

### Task 2: Mobile photo preprocessing

**Files:**
- Modify: `mobile/package.json`
- Modify: `pnpm-lock.yaml`
- Modify: `mobile/lib/detail/photo-picker.ts`
- Modify: `mobile/lib/detail/photo-picker.test.ts`
- Modify: `mobile/lib/detail/photo-upload.ts`
- Modify: `mobile/lib/detail/photo-upload.test.ts`
- Modify: `mobile/app/fountains/[id].tsx`

**Interfaces:**
- Produces `preparePhotoForUpload(asset, dependencies)` returning the existing native `{ uri, type: "image/jpeg" }` upload descriptor.
- Existing `uploadMultipart`/`expo-file-system/legacy.uploadAsync` transport remains unchanged.

- [ ] Add failing tests for picker dimensions, resize decisions, no enlargement, bounded quality attempts, size boundary, temporary-file cleanup, and terminal failure.
- [ ] Run focused tests and confirm expected failures.
- [ ] Add the Expo-SDK-compatible image-manipulator dependency only, using the lockfile's package policy; it has no config plugin.
- [ ] Implement the processor with injected manipulation/filesystem boundaries; delete only generated oversized temporaries, never the source asset.
- [ ] Integrate processing so it gates only photo transport, preserves independent rating submission, releases the single-flight state on failure, and emits privacy-safe diagnostic logging.
- [ ] Run focused mobile tests and commit the task.

### Task 3: Mobile location freshness

**Files:**
- Modify: `mobile/lib/location.ts`
- Modify: `mobile/lib/location.test.ts`
- Modify: `mobile/lib/location-deps.ts`
- Modify: `mobile/lib/location-session.ts`
- Modify: `mobile/lib/location-session.test.ts`
- Modify: `mobile/hooks/useForegroundLocation.ts`
- Create: `mobile/lib/map/location-freshness.ts`
- Create: `mobile/lib/map/location-freshness.test.ts`
- Modify: `mobile/app/(tabs)/index.tsx`

**Interfaces:**
- `ForegroundLocation` exposes `lastSuccessfulFixAtMs: number | null`.
- `formatLocationFreshness(lastFixAtMs, nowMs)` returns the exact unavailable/refreshed copy.

- [ ] Write failing pure/session tests for never-obtained, initial/manual/watch success, ordering-safe timestamps, repeated reset, failure preservation, second flooring/clamping, and disposal.
- [ ] Run focused tests and confirm expected failures.
- [ ] Capture the store-newest effective timestamp into React/reducer state only at successful fix publication; denied/failed branches preserve it even if the underlying fix store resets.
- [ ] Add an isolated ticking label below the locate control; pause/clean timers with lifecycle and keep it out of live announcements.
- [ ] Run focused mobile tests and commit the task.

### Task 4: Web location freshness

**Files:**
- Create: `web/lib/map/location-freshness.ts`
- Create: `web/lib/map/location-freshness.test.ts`
- Modify: `web/components/map/MapBrowser.tsx`
- Modify: relevant `web/components/map/*.test.tsx` if an established MapLibre harness supports event binding.

**Interfaces:**
- The display consumes a nullable successful-fix timestamp updated by startup success, Find-nearest success, and the public MapLibre `geolocate` event.

- [ ] Write failing formatter/timer-state tests for unavailable, ticking, reset, failure preservation, and cleanup behavior.
- [ ] Run focused tests and confirm expected failures.
- [ ] Capture startup, Find-nearest, and control successes without adding geolocation requests; errors leave the prior timestamp unchanged.
- [ ] Render a non-live label below the geolocate control and adjust neighboring control offsets to avoid overlap.
- [ ] Run focused web tests and commit the task.

### Task 5: Style guide, Dependabot integration, and version bump

**Files:**
- Modify: `docs/style-guide.md`
- Modify: dependency manifests/lockfiles only for open Dependabot PRs confirmed relevant and compatible.
- Modify: `mobile/app.config.ts`

**Interfaces:**
- The mobile release workflow reads `defaultAppVersion = "1.0.5"` and EAS owns build-number increments.

- [ ] Document web/mobile location-freshness placement, states, dark-mode tokens, responsive behavior, and non-live accessibility behavior.
- [ ] Review open Dependabot PR diffs/checks and package publication ages; if the user-required bundling is relevant, reproduce the complete compatible manifest change and regenerate the lockfile with pnpm rather than text-merging generated lockfiles. Do not pull unrelated backend or Actions groups into this PR.
- [ ] Add/update version assertions, bump the mobile default app version to `1.0.5`, and update the version-floor comment.
- [ ] Run focused dependency/config checks and commit the task.

### Task 6: Verification, PR, merge, and releases

**Files:**
- No new production files expected; review fixes may modify task-owned files.

**Interfaces:**
- Produces one squash-merged PR and successful `deploy.yml` plus `mobile-store-release.yml` (`platform=all`) runs.

- [ ] Run formatting, lint, type checks, focused tests, builds, and the full supported local CI mirror per `claude_help/testing-ci.md`.
- [ ] Before store dispatch, run the `claude_help/local-dev.md` Android emulator/device loop: upload a large rotated photo and verify upright output plus reduced transferred bytes; verify generated oversized temporaries are removed without deleting the source; verify the freshness label ticks, survives a denied/failed refresh, and disposes its display timer on unmount/tab blur without GPS wakeups.
- [ ] Run the independent whole-branch review and address every finding.
- [ ] Push the branch, open one PR, inspect top-level and inline comments, and monitor all required checks.
- [ ] Fix root causes for every failure, repeat local verification after code changes, and obtain the required approval verdict.
- [ ] Squash-merge only when CI is green, the independent review is approved, and all comments are addressed.
- [ ] Verify `main`, dispatch `deploy.yml --ref main`, monitor success, and run production web/API smoke checks.
- [ ] Dispatch `mobile-store-release.yml --ref main -f platform=all`, monitor both Android and iOS build/submit jobs, and verify Android is published to Play production and iOS reaches TestFlight for owner promotion with the intended version.
