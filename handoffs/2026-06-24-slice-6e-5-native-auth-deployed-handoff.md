# Handoff — Mobile slice 6e-5 (native auth scaffolding) merged + deployed; NEXT = 6e-6 (contributions) (2026-06-24)

> **This supersedes** `handoffs/2026-06-23-slice-6e-4-detail-merged-handoff.md` as the resume point. Slice 6e-5 is merged to `main` and deployed via the repo's production CI workflow. The next slice is **6e-6 (authenticated contributions/write flows)**.

## TL;DR — resume from here

1. **Immediate next action: build slice 6e-6 (contributions).** Start from `main` at `272ead1` or newer. Flow: write a 6e-6 plan in `docs/plans/` → Codex Loop A → branch → implement TDD-first → CI green → Codex Loop B with every comment addressed → squash-merge PR → deploy via `deploy.yml` workflow if the user asks for deployment or the slice needs production.
2. **6e-5 code is done, merged, and deployed.** PR #71 was squash-merged as `272ead1` (`feat(mobile): add native auth scaffolding`). Deploy workflow run `28067369255` completed successfully on `main` for that SHA.
3. **Native auth is still runtime-gated.** The app now has gated Logto RN/Expo auth scaffolding, secure-token plumbing, protected API token attachment, account UI state, and tests. It does **not** claim an on-device sign-in round trip yet. Do not set `EXPO_PUBLIC_LOGTO_NATIVE_AUTH_CONFIRMED=true` until the exact native redirect URI is registered and verified.
4. **This was a backend/web production deploy, not a mobile store/dev-client build.** The CI deployment rebuilt and rolled out production backend/web images. It did not produce an EAS/TestFlight/Play build.

**Latest deployed `main`:** `272ead1aff42c24e94e11ddbef323f786b07f4bb`.

---

## Verified state

**Merged:**

- PR #71: `https://github.com/redducklabs/fountainrank/pull/71`
- Squash commit: `272ead1aff42c24e94e11ddbef323f786b07f4bb`
- Commit subject: `feat(mobile): add native auth scaffolding`
- Codex PR review: second review posted `VERDICT: APPROVED`; first-review findings were addressed before merge.

**Deployed:**

- Workflow: `Deploy`
- Run: `https://github.com/redducklabs/fountainrank/actions/runs/28067369255`
- Head SHA: `272ead1aff42c24e94e11ddbef323f786b07f4bb`
- Conclusion: `success`
- CI deployment steps completed: image build/push, backend/web Trivy image scans and SARIF uploads, DOKS deploy, DB migrations, rollout gate.

**Local repo status when this handoff was written:**

- `main` aligned with `origin/main`.
- `AGENTS.md` had an existing local modification from user-provided instructions. It was not touched for this handoff.
- This handoff file was created locally after the merge/deploy.

---

## What 6e-5 shipped

**Plan and dependencies:**

- Added `docs/plans/2026-06-23-mobile-6e-5-native-auth.md`.
- Added mobile dependencies in `mobile/package.json` and `pnpm-lock.yaml`:
  - `@logto/rn@1.1.0`
  - `expo-crypto@~56.0.4`
  - `expo-secure-store@~56.0.4`
  - `expo-web-browser@~56.0.5`
  - `@react-native-async-storage/async-storage@2.2.0`

**Auth/config layer:**

- `mobile/lib/auth/config.ts` and tests: native Logto config helpers and gated confirmation behavior.
- `mobile/lib/auth/state.ts` and tests: auth state normalization/helpers.
- `mobile/lib/auth/profile.ts` and tests: profile helpers for `/me`.
- `mobile/lib/config.ts` and tests: auth-related runtime config wiring.
- `mobile/app.config.ts`: Expo runtime config for auth fields.

**App wiring:**

- `mobile/providers/auth-provider.tsx`: Logto-backed `AuthProvider`.
- `mobile/providers/api-provider.tsx`: API provider receives auth/token integration.
- `mobile/app/_layout.tsx`: app wrapped with auth provider.
- `mobile/app/(tabs)/account.tsx`: account screen with signed-out/auth-unavailable/authenticated states, sign-in/sign-out actions, `/me` profile query, and profile cache clearing.

**API behavior:**

- `mobile/lib/api.ts`: protected request classification and token attachment.
- Public GET reads do **not** acquire tokens by default, so map/detail public reads should not appear offline if auth token acquisition fails.
- Token attachment is scoped to non-GET protected writes and `GET /api/v1/me`.
- Auth-session failures map to error state, not offline.
- The existing sanitizer still prevents `X-Dev-*` headers from reaching the network.

**Docs/style:**

- `docs/setup/06-logto.md`: updated native auth setup wording. It explicitly says not to set `EXPO_PUBLIC_LOGTO_NATIVE_AUTH_CONFIRMED=true` until the exact redirect URI is confirmed.
- `docs/style-guide.md`: account/auth UI notes.
- `mobile/README.md`: native auth setup notes.

---

## Verification already run

Local checks after the final fix:

```bash
corepack pnpm --filter mobile exec vitest run lib/api.test.ts lib/auth/state.test.ts lib/auth/config.test.ts lib/config.test.ts lib/view-state.test.ts
corepack pnpm --filter mobile run typecheck
corepack pnpm --filter mobile run lint
corepack pnpm --filter mobile run test
CI=true corepack pnpm dlx expo-doctor
git diff --check
```

Results:

- Focused Vitest: 5 files, 65 tests passed.
- Full mobile tests: 14 files, 144 tests passed.
- Mobile typecheck passed.
- Mobile lint passed.
- Expo Doctor passed: 21/21 checks.
- `git diff --check` passed.

CI checks before merge were green for PR #71:

- CodeQL analysis jobs passed.
- `backend` passed.
- `workspace-js` passed.
- `mobile-doctor` passed.
- `pip-audit`, `pnpm-audit`, and `trivy-fs` passed.

One local workflow caveat:

- `./run.ps1 check -Mobile` was attempted earlier from WSL and failed because it invoked Windows `pnpm`, which hit `EACCES` on `D:\repos\fountainrank\node_modules\turbo`. The WSL dependency tree was then repaired with Linux `corepack pnpm install`, and the Linux `corepack pnpm` mobile verification commands above passed.

---

## Codex review issues fixed before merge

1. **Profile cache leakage across users.** `/me` React Query cache could have shown a previous user's profile after sign-out/sign-in. Fixed in `mobile/app/(tabs)/account.tsx` by using `PROFILE_QUERY_KEY` and clearing cached profile data before sign-in, after successful sign-in, before/after sign-out, when leaving authenticated state, and on 401/auth-session errors.
2. **Public reads could be blocked by auth token acquisition.** Initial token plumbing could call `getAccessToken` for public GET reads and make map/detail look offline when auth was unavailable. Fixed in `mobile/lib/api.ts` by scoping auth to protected methods and `GET /api/v1/me`; public GETs do not request tokens.
3. **Auth errors looked like offline states.** Fixed in `mobile/lib/view-state.ts` so `AuthSessionError` maps to `"error"`.
4. **Logto docs could be misread as enabling auth too early.** Fixed in `docs/setup/06-logto.md`; the confirmation flag must remain false until the exact redirect URI is registered and verified.

---

## Facts and constraints for 6e-6

- 6e-6 should build on the authenticated API path added in 6e-5. Use `createApiClient`; do not create raw generated clients at call sites.
- Keep the no-dev-auth rule: never emit `X-Dev-*` headers, and never add a mobile dev-auth bypass.
- Public reads should remain public. Only protected reads/writes should require Logto access tokens.
- Use the generated API schema in `packages/api-client/src/schema.d.ts` for exact method/path/body typing.
- Any write UI must handle unauthenticated/auth-unavailable states honestly. If auth is not configured or native auth is not confirmed, show a blocked/auth-required state rather than pretending the write path is usable.
- Keep proof-level wording strict. CI can prove helper logic, type safety, lint, and build/config health. It does not prove device sign-in, MapLibre render, or native browser callback behavior.
- Do not claim native auth works on device until an owner-gated dev-client/EAS/device round trip has actually been observed.

Likely 6e-6 areas to inspect before planning:

- `docs/specs/2026-06-23-mobile-store-testing-distribution-design.md`
- `docs/specs/2026-06-16-architecture-and-foundation-design.md`
- `docs/design/*.md` relevant to contribution/write behavior
- `mobile/app/(tabs)/account.tsx`
- `mobile/providers/auth-provider.tsx`
- `mobile/providers/api-provider.tsx`
- `mobile/lib/api.ts`
- Existing web contribution/write UI and backend endpoints for ratings, notes, status/attributes, and add-fountain flows.

---

## Resume commands

Use WSL/Linux paths in Codex. From repo root:

```bash
git status --short --branch
git log --oneline -8 origin/main
gh pr view 71 --json state,mergedAt,mergeCommit,url
gh run view 28067369255 --json conclusion,status,url,headSha,workflowName,createdAt,updatedAt
```

Expected important facts:

- PR #71 is `MERGED`.
- Deploy run `28067369255` is `completed` with `success`.
- `origin/main` includes `272ead1 feat(mobile): add native auth scaffolding`.

For mobile verification:

```bash
corepack pnpm --filter mobile run lint
corepack pnpm --filter mobile run typecheck
corepack pnpm --filter mobile run test
cd mobile && CI=true corepack pnpm dlx expo-doctor
```

Repo workflow commands, when the Windows/WSL pnpm state is healthy:

```bash
powershell.exe -NoProfile -ExecutionPolicy Bypass -File run.ps1 check -Mobile
powershell.exe -NoProfile -ExecutionPolicy Bypass -File run.ps1 check
```

Deploy, only when appropriate and requested:

```bash
gh workflow run deploy.yml --ref main
gh run list --workflow deploy.yml --branch main --limit 5
gh run watch <run-id> --exit-status
```

Do not deploy locally with kubectl/helm/doctl. Use CI.

---

## Process reminders

- Read `CLAUDE.md` before work, then only the relevant `claude_help/*.md` and docs for the slice.
- Use `gh` for GitHub operations.
- No commits unless explicitly requested with task context.
- No AI attribution in commits, PRs, changelogs, docs, or handoffs.
- No time estimates in plans, docs, PRs, or chat unless explicitly requested.
- Do not edit `.env` files or expose secrets.
- Do not write to the database unless explicitly asked.
- Native folders generated by Expo/CNG stay out of git.
- Handoff/date note: the deploy finished at `2026-06-24T00:54:34Z`; local shell date during the handoff session was still `2026-06-23` in Pacific time.

---

## Slice table

6e-1 ✅ release config (#66) · 6e-2 ✅ app shell (#67) · 6e-3 ✅ map/public discovery (#69) · 6e-4 ✅ detail/public reads (#70) · 6e-5 ✅ native auth scaffolding (#71, deployed) · **6e-6 ◀ NEXT** contributions/write flows · 6e-7 add fountain · 6e-8 store metadata/icon/splash · 6e-9 auth/OAuth records · 6e-10 device RC + store builds.
