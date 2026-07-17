# Mobile add-flow resilience — implementation plan (2026-07-17)

Spec (Codex-approved): `docs/specs/2026-07-17-mobile-add-flow-resilience-design.md`. Issues:
#241, #244. TDD: each task lists tests first. Branch: `feat/mobile-add-flow-resilience`;
Conventional Commits, one commit per task with the subject given below; never commit
`temp/codex-reviews/` artifacts.

**Local completion rule (host-specific, per `local-dev.md`)**: a task is *locally complete* when
its node-safe tests, `tsc --noEmit`, and Prettier pass locally; the stricter mobile
React-Compiler lint is CI-gated — final task completion is contingent on CI `workspace-js`.
Never claim a local green for a CI-gated suite.

**Test-strategy amendment (discovered during implementation)**: this plan originally called for
jsdom component-render tests in Tasks 4/6/7. Those are impossible in this repo: the mobile
Vitest toolchain (rolldown/oxc, no Babel/Flow pipeline) cannot import `react-native` at all
(`RolldownError: Flow is not supported` — in CI too), and no RN renderer
(`@testing-library/react-native` / `react-test-renderer`) is resolved anywhere in the lockfile;
adding that infrastructure was previously evaluated and rejected as out of scope (see the header
of `mobile/components/nav/ProfileTabIcon.cache.test.ts`, the established precedent). Every
behavior those tests targeted is instead verified at a node-safe seam where one exists —
QueryClient/QueryObserver level for cache behavior (the exact mechanics `useQuery` wraps), pure
classification/reducer/payload units for the submit path, and a pure overlay-state descriptor
for the banner's decision, copy, retryable flag, and accessibility values — while the renderer
wiring itself was reviewed statically (not executed), and interaction-level behavior remains in
the post-merge owner on-device verification.

**Cross-spec merge gate (enforced, not informational)**: the reconciliation behavior in Task 4
relies on the backend advisory-lock/duplicate-probe invariant. The #242 PR containing its
Verification 2e test (two concurrent identical-coordinate creates → one commit + one typed 409)
MUST be merged to `main` before this PR merges. Task 8 verifies mechanically (see below).

## Task 1 — structured logging seam (`mobile/lib/log.ts`) — `feat(mobile): structured log seam`

- Tests (node-safe, new `mobile/lib/log.test.ts`): one `console.warn` per event whose single
  argument is a JSON string parsing to `{ level, area, event, ...fields }`; **event-specific
  allowlists** — `api_timeout` permits exactly `{ method, path, timeout_ms, source }` and
  `add_fountain_outcome_unknown` permits exactly `{ reason, timeout_ms? }` (present only when
  `reason === "deadline"`); positive assertions that allowed fields survive serialization AND
  negative assertions that any extra field (header-like, token-like, query, message text) is
  omitted from the final string.
- Implement the seam with typed per-event payloads (allowlist by construction, not scrubbing).

## Task 2 — `ApiTimeoutError` + bounded transport (`mobile/lib/api.ts`) — `feat(mobile): request deadlines with abort`

- Tests (node-safe, extend `mobile/lib/api.test.ts`; spec Verification 1a–1i, fake timers + stub
  fetch): hanging POST → `ApiTimeoutError` at `WRITE_TIMEOUT_MS = 30_000`; hanging GET at
  `READ_TIMEOUT_MS = 15_000`; settle-first clears timer + removes inbound listener; inbound abort
  mid-flight → caller's abort reason (never `ApiTimeoutError`); pre-aborted inbound → immediate
  rejection, fetch never called; network `TypeError` unchanged; dispatched request carries the
  composed signal + `Authorization` + no `x-dev*`; the `api_timeout` serialized line carries
  method + path only; never-settling `getAccessToken` → `ApiTimeoutError`, no dispatch, no
  tokenless fallthrough; token rejection → `AuthSessionError`; late-resolving token → nothing
  dispatched; near-simultaneous orderings → one terminal rejection, one log only for deadline, no
  unhandled late rejection.
- Implement per spec §1; uploads untouched.

## Task 3 — classification (`view-state` + both mappers) — `feat(mobile): timeout error classification`

- Tests (node-safe): `resolveViewState(ApiTimeoutError)` → offline/network shape.
  `mapAddFountainError` (`mobile/lib/add-fountain/state.ts`): `ApiTimeoutError` → `"timeout"`,
  mid-flight `TypeError` → `"timeout"`, existing mappings unchanged;
  `addFountainErrorText("timeout")` → reconciliation copy. Contributions mapper
  (`mobile/lib/contributions/state.ts`): `ApiTimeoutError` → network bucket, existing copy.
- Implement both mappers + copy.

## Task 4 — outcome-unknown handling in the add submit path — `feat(mobile): outcome-unknown add recovery`

- **Node-safe seam (explicit, so these tests do not require rendering the screen)**: keep
  classification **pure** — `classifyAddSubmitFailure(error)` in
  `mobile/lib/add-fountain/state.ts` (following that module's existing patterns; smallest seam,
  no orchestration abstraction) returns the mapped `AddFountainError` plus an optional
  outcome-event descriptor (`{ reason: "deadline", timeout_ms } | { reason: "network_failure" }`
  — no raw message ever); the catch branch passes a returned descriptor to the `lib/log.ts` seam
  (`add_fountain_outcome_unknown`). Node-safe tests (extend
  `mobile/lib/add-fountain/state.test.ts`): `ApiTimeoutError` → `"timeout"` + deadline
  descriptor with `timeout_ms`; `TypeError` → `"timeout"` + network-failure descriptor without
  `timeout_ms`; other errors → existing mappings, no descriptor. The log seam's emission of the
  descriptor is covered by Task 1's event-allowlist tests. Reducer tests, limited to reducer-owned state (the
  CURRENT state machine — do NOT change its phase model): `submitError` → `phase === "error"`,
  `error === "timeout"`, `pin` and `isWorking` preserved; `submitStart` transitions the error
  state back to submitting.
- Behavior-seam tests (per the test-strategy amendment above — RN component render is not
  possible; component-owned `useState` draft preservation is covered by the on-device
  checklist). The reconciliation property is verified as **separated units**, not a composed
  flow test: `classifyAddSubmitFailure` classification (timeout/network → `"timeout"` +
  descriptor); reducer preservation of reducer-owned `pin`/`isWorking` across
  `submitError`/`submitStart`; deterministic payload construction from the same supplied draft
  (deep-equal payload, exactly equal latitude/longitude — not a wire-byte claim); and the
  existing `classifyAddConflict`/duplicate-reducer units for the 409 → duplicate routing. The
  end-to-end timeout → unchanged retry → 409 → "taken to your fountain" sequence is an
  interaction-level property carried by the on-device checklist (and its server half by the
  #242 concurrency test).
- Implement: the helper, then the `onSubmit` catch-branch wiring in
  `mobile/app/(tabs)/index.tsx` calling it.

## Task 5 — pure cache helpers (`mobile/lib/map/`) — `feat(mobile): bbox cache insert helpers`

- Tests (node-safe; spec Verification 4–5): pin-from-detail field mapping; bbox insert helper —
  inclusive bounds, out-of-bounds skip, active-filter skip (`hasActiveFilters` + shape
  validation), malformed key/params/filters/pins untouched, `"idle"` key untouched,
  NaN/Infinity no-op, duplicate id replaced, `truncated` preserved, immutability with reference
  identity on untouched entries.
- Implement `fountainPinFromDetail` + the insert helper.

## Task 6 — `onSuccess` cache seeding + `staleTime` — `feat(mobile): seed caches from create response`

- QueryClient/QueryObserver-level tests (node-safe, per the amendment — the exact cache
  mechanics `useQuery` wraps): seed → invalidate → failed refetch → seeded pin retained +
  `isError`; new-key failure → no substituted placeholder; detail seeded at
  `["fountain", id, true, "public"]` gives instant data for non-admin, admin still fetches; **the
  cached detail is the exact server response value (deep-equality/identity assertion at the
  seeding boundary — the spec's no-reshaping flicker requirement)**; existing invalidations
  (`bbox`, `me/contributions`, `fountain` prefix) still fire; bbox `staleTime: 30_000`
  suppresses refetch for a non-invalidated key on pan-back.
- Implement: `AddFountainResult` success branch carries `FountainDetail`; `onSuccess` seeding +
  inserts + invalidations; `pinsQuery.staleTime`.

## Task 7 — stale-pins banner (`MapOverlay`) — `feat(mobile): stale-pins banner`

- Pure overlay-state descriptor tests (node-safe, per the amendment): the descriptor for
  `isError && data != null` carries the persistent stale-data copy ("Couldn't refresh fountains
  — showing saved data"), the retryable flag, the spinner state, `accessibilityRole: "alert"`
  **and** the live-region value (`accessibilityLiveRegion` — a separate RN property from the
  role; both asserted at the descriptor level); `isError && data == null` → the existing error
  state. Coverage stated narrowly: the descriptor pins the decision/copy/flags/a11y **values**;
  `MapOverlay`'s manual mapping of those values (and the retry `onPress` → `refetch` wiring)
  was reviewed statically, not executed — the announcement behavior and retry interaction are
  on-device checklist items.
- Implement both accessibility properties; document the state in `docs/style-guide.md` (same
  commit).

## Task 8 — verification, gate check + PR — no commit unless verification causes a documented
file change (then `docs(mobile): document add-flow resilience verification`); never an empty
commit

- Local verification, enumerated honestly: node-safe Vitest files from all tasks (per the
  amendment, every suite in this plan is node-safe), `tsc --noEmit`, Prettier, and whatever
  baseline ESLint runs on this host. Explicitly deferred to CI: the authoritative
  `workspace-js` run (React-Compiler mobile lint + full suite on the isolated linker) and
  isolated-linker `expo-doctor` (`mobile-doctor` job — the local hoisted-linker result is not
  evidence). Run `./run.ps1 check` and record which steps were host-limited rather than
  claiming a full local green.
- **Gate check (mechanical, reproducible)**: resolve and record the exact #242 PR number and its
  squash-merge commit (`gh pr view`); run `git fetch origin main` immediately before the checks;
  verify that commit is reachable from `origin/main`; grep the identical-coordinate two-session
  test from `origin/main` (not the local tree); inspect that PR's named backend CI check via
  `gh pr checks <N>` and confirm green. This PR does not merge before all of that holds.
- **Post-merge on-device verification handoff (the spec's owner checklist — a plan step, not an
  aspiration)**: after squash-merge, post a comment on #241 and #244 recording the four owner
  checks with their preconditions (authenticated emulator/device + controlled connectivity
  changes; `local-dev.md` emulator loop): (1) airplane-mode mid-submit reaches the
  outcome-unknown copy with the draft retained; (2) unchanged retry after a
  timed-out-but-committed create routes to the created fountain via the duplicate response;
  (3) the locally inserted pin survives a failed bbox refetch and shows the stale-data banner;
  (4) non-admin post-add detail renders without a blocking spinner. Report observed results
  only — never claim these from unit/CI coverage. Note in the same comment that the fix reaches
  users only with the next mobile store release; merging does not ship the native client.
- PR: `gh pr create` linking #241/#244 + the spec; confirm `mergeable != CONFLICTING` before
  waiting on CI (`testing-ci.md`); CI green → Codex PR review loop
  (`claude_help/codex-review-process.md`) → every PR comment (any source) addressed →
  **squash-merge only**. No AI attribution, no time estimates.
