# Contributor Experience Issues 264–267 Implementation Plan

**Date:** 2026-07-20  
**Issues:** #264, #265, #266, #267  
**Design sources:** the issue contracts, the standing architecture, and existing
photo-upload, admin-auth, leaderboard, and map-focus patterns.

## Goal

Resolve the four requested contributor-experience issues on one branch while
keeping each issue in a focused, independently reviewable/revertible commit.

## Scope boundaries

- #264 is mobile-only and reuses the existing upload mutation and award flow.
- #265 means every row in the existing append-only `contribution_events` table;
  it does not create or fabricate a broader raw-mutation audit model.
- #266 is web-only and changes selection/URL ownership, not map camera behavior.
- #267 extends the existing leaderboard query; it adds no profile/N+1 requests.
- No database schema, infrastructure, dependency, or environment-file changes.
- One branch and one PR are intentional per the user request. Each issue remains
  a separate commit and test boundary so the security-sensitive admin surface is
  independently inspectable within the grouped PR.

## Tasks

### 1. Mobile photo source selection (#264)

1. Extract one shared image-picker option object and one successful-result
   forwarder so camera and library assets have identical image-only/quality and
   `onPick` behavior.
2. Use React Native's cross-platform `Alert.alert` with **Take photo**, **Choose
   from library**, and **Cancel** actions. Cancel performs no async work.
3. The camera action alone requests camera permission and invokes
   `launchCameraAsync`; camera cancellation is a no-op and denial displays
   actionable camera-specific Settings guidance.
4. The library action alone preserves the existing media-library permission,
   denial guidance, and `launchImageLibraryAsync`; cancellation remains a no-op.
5. Configure `expo-image-picker`'s `cameraPermission` copy and Android camera
   runtime permission through the existing Expo app configuration.
6. Test option routing, prompt/picker cancellation, isolated permissions,
   denial messages, shared options, and successful camera forwarding.

### 2. Admin contribution history (#265)

1. Add a separate `require_admin`-protected leaderboard endpoint with the same
   validated global/local/sort query behavior as the public endpoint, returning
   an admin row variant that adds `user_id`. Confirmed-admin clients use this
   endpoint; the public `ContributorRow` and endpoint never contain stable IDs.
   This makes row identity stable across duplicate/changed names without using
   mutable rank, scope, or display-name resolution.
2. Add `GET /api/v1/admin/contributors/{user_id}/contributions`, guarded by
   `require_admin`, returning the target's current public display name, current
   aggregate contribution stats, event rows, and a nullable next cursor. Unknown
   target users return the existing admin not-found convention.
3. Use a bounded limit and opaque URL-safe cursor encoding `(created_at, id)`.
   Query and cursor predicates both order by `created_at DESC, id DESC`, so tied
   timestamps paginate deterministically. Include awarded and reversed rows.
4. Return only event type, points, status, timestamp, fountain ID, target type/ID,
   and an explicit safe metadata allowlist used for useful labels (currently
   rating/attribute identifiers and non-PII observed value). Never return the
   dedup key, Logto subject, location, parent IDs, confirmation internals, or raw
   metadata. Add response-shape/redaction tests.
5. Log each request with admin actor ID, target user ID, cursor/page presence,
   requested limit, result count, and end state only; never log metadata or names.
6. Regenerate the OpenAPI schema and shared TypeScript client from the backend.
7. On web, resolve the viewer server-side using the existing viewer helper. Only
   confirmed admins fetch/render admin leaderboard rows and **View history**
   links. Add an admin route that repeats the server-side gate before fetching
   protected data and renders context, audit rows, errors/empty state, and a
   cursor-based **Load more** control.
8. On mobile, query `me` first and enable the admin leaderboard/history query
   only when `is_admin === true`. Add an admin route with a second local gate;
   unresolved and non-admin states never render protected cached data. Implement
   loading/error/empty/end states and cursor pagination.
9. Render human-readable event labels, signed points plus explicit awarded/
   reversed status, and timestamps. Link only when an existing safe route is
   available: a present `fountain_id` may link to fountain detail; unsupported or
   deleted target types remain plain audit context rather than speculative links.
10. Test anonymous/non-admin rejection, admin success, duplicate names, cursor
    validation/order/ties, both statuses, redaction, contextual stats, UI gate
    visibility, stable navigation IDs, pagination, and protected-route states.
11. Document the web/mobile contribution-history audit rows and their awarded,
    reversed, loading, error, empty, and pagination treatments in the style guide.

### 3. Web map focus ownership (#266)

1. Add pure helpers for removing `focus` while preserving every unrelated query
   parameter and for resolving selection ownership between focus and route state.
2. Treat the deep-link focus as authoritative only for initial resolution/fly.
   When its detail is dismissed or another pin/list row is selected, synchronously
   clear focused-pin/status state and use `router.replace` to strip `focus` without
   adding a history entry, reload, or camera operation. The new route selection
   then owns the active ID.
3. Keep `flyto` consumption one-shot and do not call `flyTo`, startup location,
   or bbox recenter logic as part of focus removal; preserve the current viewport.
4. Clear the exact focused pin/ref, merged focused-only source data, selected
   filters/halo/icon, and callout together. Provide dismissal for loading,
   not-found, and transport-error focus states as well as resolved focus.
5. Test original deep-link resolution/fly-once, dismiss, selection transfer,
   unrelated query preservation, no camera replay, invalid/error dismissal, and
   Back/Forward semantics: replace removes stale focus from the current entry;
   only navigating to an actually retained original deep-link entry can restore it.

### 4. Leaderboard avatars (#267)

1. Add nullable `avatar_url` to public `ContributorRow` and select
   `User.avatar_url` in both existing global and local joined queries.
2. Regenerate the OpenAPI schema/client and test global/local API responses with
   present and null avatar URLs.
3. Add small circular web/mobile avatar components immediately before the name.
   Images are decorative (empty alt / accessibility-hidden) because the adjacent
   visible name is authoritative. On null URL or load error, render consistently
   derived display-name initials without shifting the row.
4. Preserve truncation, narrow layout, rank-one crown, current-user styling, and
   metric alignment; test image and fallback rendering plus accessibility.
5. Document avatar dimensions, spacing, crop/shape, decorative semantics, and
   initials fallback in the leaderboard style-guide section.

## Acceptance mapping

- #264 chooser/source routing: tasks 1.1–1.4; permission configuration: 1.5;
  cancellation, denial isolation, forwarding, and policy parity: 1.6.
- #265 admin-only stable identity/public redaction: 2.1, 2.7–2.8; complete
  awarded/reversed audit context: 2.2–2.4 and 2.9; bounded stable pagination:
  2.3; non-PII logging: 2.5; generated contract: 2.6; all API/UI states and
  duplicate-name correctness: 2.10; new UI patterns: 2.11.
- #266 initial handoff and fly once: 3.2–3.3; dismiss/selection transfer and full
  visual/data clearing: 3.2–3.4; query, viewport, invalid state, and browser
  history behavior: 3.1 and 3.5.
- #267 global/local API contract: 4.1–4.2; web/mobile avatar plus fallback,
  accessibility, and preserved row treatments: 4.3–4.4; style guide: 4.5.

## Commit and review boundaries

1. `feat(mobile): add camera option for fountain photos` — #264.
2. `feat(admin): add contributor event history` — #265 backend, generated
   contract, web/mobile integration, and its style-guide entry.
3. `fix(web): clear transferred map focus` — #266.
4. `feat(leaderboard): show contributor avatars` — #267 backend, generated
   contract, web/mobile UI, and style-guide entry.

Each boundary gets focused tests before proceeding. The grouped PR review prompt
will call out the #265 commit/diff explicitly for an isolated auth/redaction pass.

## Risks and mitigations

- **Stable-ID disclosure:** only the separately authorized admin leaderboard
  schema contains IDs; public response models and tests prohibit the field.
- **Cursor duplicates/gaps:** cursor predicate exactly mirrors the two-column
  descending order and tests identical timestamps.
- **Protected UI cache flash:** protected queries are disabled until confirmed
  admin state and guarded screens return early before reading/rendering data.
- **Metadata/PII leakage:** construct allowlisted metadata dictionaries; never
  pass through `event_metadata` or log it.
- **Focus camera regression:** focus cleanup owns URL/selection state only and is
  tested with camera calls asserted unchanged.
- **Broken avatars:** error state permanently swaps to fixed-size initials for
  that URL, maintaining layout and accessible name behavior.

## Verification and definition of done

- Run focused backend and pure/component tests while implementing each commit.
- Run backend lint/format/migrations/tests, web lint/typecheck/format/build, API
  client checks, and mobile typecheck/format plus locally supportable pure tests.
- On this shared Windows/WSL checkout, treat component-render/full JS suites,
  strict mobile React-Compiler lint, and `expo-doctor` dependency truth as CI-only
  where `local-dev.md` says they are unreliable; report them only from actual CI.
- Open one PR, verify mergeability and all CI jobs, run the independent critical
  review loop, inspect top-level and inline comments, address every finding, and
  squash-merge only after all gates are actually green.
- Done means every mapped criterion is implemented, relevant checks have actually
  passed, generated artifacts are current, unrelated changes are absent, CI is
  green, and the independent review verdict is approved.
