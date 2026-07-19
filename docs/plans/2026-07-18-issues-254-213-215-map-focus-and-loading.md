# Plan — Focused fountain and complete loading feedback

**Issues:** #254, #213, #215 (with #169 as the regression contract)
**Spec source:** the issue bodies and the standing architecture/style guide. These are UI-state
and navigation corrections within the existing web/mobile architecture, so no architecture spec
change is required.
**Date:** 2026-07-18

## Goal

Make deep-linked fountains unmistakably selected at pin-level zoom, acknowledge every covered web
soft navigation immediately, and finish #215's remaining cold-start, route, geolocation, and image
loading states on web and mobile. Preserve #247's shipped mobile live-location behavior.

## Product decisions

- A focused fountain uses a persistent enlarged pin and high-contrast halo plus a named preview
  card. The preview supplies a non-color cue, remains after camera motion, is exposed as a status
  announcement, and is the detail-opening control. Motion is only the camera transition; no
  required pulse animation is used, so reduced-motion users retain the full selected state.
- Focus deep links use pin-level zoom (at least the first unclustered/useful zoom) and fetch the
  focused fountain by id when bbox data has not produced it. A missing, hidden, or deleted id clears
  the pending focus presentation and never substitutes a nearby pin.
- When `focus` and `flyto` coexist (the shipped "See on Map" URL), the focus controller is the sole
  camera owner. The generic fly-to consumer validates and strips `flyto`/`bbox` but does not move
  the camera; general search URLs without `focus` retain their existing fit/fly behavior.
- Navigation feedback has two layers: the initiating control becomes busy immediately and the
  destination route renders a skeleton/loading surface. Pin/detail navigation mounts a pending
  drawer immediately and shows a retryable failure instead of silently returning to idle.
- Image placeholders reserve final geometry. They remain visible until load succeeds and expose a
  neutral fallback on failure; avatars retain initials behind the image.
- Mobile splash/bootstrap gating covers provider/auth bootstrap only. Location remains an explicit
  in-app state and must not indefinitely hold the native splash.

## Scope boundaries

- #169's list link and star work remains unchanged except for pending/image behavior.
- Do not alter request timeouts, backend add locking, continuous location tracking, or map cache
  invalidation (#241–#244).
- Do not redo #247's mobile locate-button/location-state work.
- No database, infrastructure, dependency, or environment-file changes.

## Tasks

1. **Focused-fountain state and data (web).** Add pure focus-camera/state helpers and tests. Consume
   `focus` separately from general search `flyto`; move to pin-level zoom, resolve the exact id,
   merge it into the map source without duplicate ids, keep it outside clustering at the focused
   destination, and retain selection after async bbox/style loads. Define `FOCUSED_PIN_ZOOM` as a
   concrete value strictly greater than `CLUSTER_MAX_ZOOM` and assert it in tests. Resolve through
   the existing unauthenticated public fountain-detail API; the backend visibility rule must return
   not-found for hidden/soft-deleted records so their coordinates are never sent for client-side
   filtering. Distinguish not-found/hidden from transport failure and log failures through the
   existing map diagnostic seam.
2. **Persistent selected presentation (web).** Strengthen the selected layer scale/halo ordering,
   add a named selected-fountain preview with `role=status`/selected context, and ensure marker/list
   activation is keyboard/screen-reader equivalent. Add reduced-motion camera duration handling and
   component/pure-layer tests.
3. **Soft-navigation controller (#213).** Add a reusable pending-link/push pattern using Next 16's
   supported navigation APIs. Apply it to header search, leaderboard controls, list/detail links,
   map pins, and in-view rows. Disable duplicate activation, announce busy state, mount the pending
   detail surface immediately, and expose retry on navigation failure. A MapLibre pin event first
   sets React-owned `pendingDetailId` (rendering the pressed marker treatment and pending drawer),
   then calls `router.push`; no hook runs from the native map callback. Log failed navigation via
   the existing diagnostic seam. Add focused tests.
4. **Web first-paint and geolocation states (#215 P0/P1/P2).** Show an accessible MapLibre dynamic
   import fallback; distinguish startup locating/success/failure and suppress the below-zoom hint
   during first fix; split add-mode GPS pending from denied; add root and intercepted-detail loading
   files (plus route-specific skeletons where materially different); and use `FormSubmitButton` for
   AuthControl sign-in/sign-out.
5. **Web image placeholders (#215 P3).** Introduce the smallest reusable image-loading wrapper/state
   pattern and apply it to fountain carousel, hero, list thumbnails, and avatars. Reserve dimensions,
   cover error behavior, and test state transitions.
6. **Mobile remaining #215 work.** Gate splash/bootstrap with a bounded app-ready lifecycle; reserve
   the points/auth header geometry; add expo-image placeholders/transitions and stable hero/list/avatar
   geometry. Bootstrap readiness depends only on provider/auth completion or its handled error and
   never on `location.coords`/GPS. Preserve location behavior and add pure/component coverage where
   locally supportable. Native currently has no `focus`/"See on Map" entry point, so #254's qualified
   native requirement is N/A; if inspection finds one, add equivalent selected-source/callout work.
7. **Documentation.** Update `docs/style-guide.md` with focused pins/previews, route and control
   pending states, map locating/import states, skeletons, image fallbacks, accessibility semantics,
   contrast, reduced motion, and mobile splash boundaries.
8. **Verification.** Run formatting plus local web/mobile typecheck, lint, pure tests, and web build
   using the WSL-safe workflow. Run the full project mirror where feasible and disclose host-limited
   component/mobile checks. Perform desktop+narrow browser interaction checks and record any
   on-device items that remain release-gated. Use the documented local Android emulator debug-build
   loop to verify splash handoff, stable header geometry, image placeholders, and that bootstrap never
   awaits location; if unavailable, record those exact owner-device release gates. Then run the
   independent code-review gate; a PR/CI,
   issue updates, deployment, and merge require separate explicit GitHub write authorization.

## Acceptance mapping

- #254: tasks 1–2 and 7–8.
- #213: task 3 plus the intercepted drawer portion of task 4.
- #215 remaining web P0–P2: task 4; P3: tasks 5–6; mobile splash/auth pop-in: task 6.
- Accessible and documented loading/selection patterns: task 7, verified in task 8.

## Sequence and review boundaries

Implement and review independently revertible slices; do not accumulate one mega-diff:

1. **PR A — #254 + map-pin portion of #213 (web):** pure focus contract/tests; map data/camera
   integration; selected preview/pending drawer; documentation and focused verification. Tasks 1–2
   land in that order. PR A introduces the shared React-owned pending-navigation primitive/state
   contract; PR B extends that same primitive to Link/router surfaces rather than replacing it.
2. **PR B — remaining #213 + web #215:** commit task 3, task 4, task 5, then docs/verification; each
   commit passes its scoped checks before the next begins. Root route loading uses a map-appropriate
   boundary (not a generic skeleton followed by a second MapBrowser dynamic-import skeleton); the
   MapBrowser fallback itself becomes visible and accessible.
3. **PR C — mobile #215 remainder:** splash/bootstrap, stable auth/points geometry, image placeholders,
   docs/checklist, and verification. It does not depend on PR A/B code.

Each PR boundary gets its own CI and independent code-review loop. No commit, push, PR creation, or
issue mutation occurs without explicit user authorization; until then each slice remains a locally
reviewable working tree.

## Risks and mitigations

- **Focus races with bbox/style loads:** one id-keyed state machine and generation guards own focus;
  every source replacement re-merges the resolved focused feature.
- **Focus and fly-to fight:** a valid focus suppresses generic fly-to camera work; focus owns the
  single move while URL cleanup still removes `flyto`/`bbox`.
- **Clusters hide the selected feature:** pin-level camera plus a dedicated non-clustered focused
  source/layer (or equivalent promoted feature) keeps it visible without globally disabling clusters.
- **Pending UI gets stuck:** destination commit/path change clears pending; rejected navigation sets a
  visible retry state; duplicate actions are ignored while busy.
- **Splash hangs:** bootstrap readiness has explicit success/error completion and never waits for GPS.
- **Layout shift:** placeholders use the same aspect ratio/size contract as loaded content.
- **Reduced motion:** rely on MapLibre's non-essential-animation preference handling and never mark
  focus movement `essential`; explicit duration logic may only shorten/disable, never force, motion.

## Definition of done

Every unchecked criterion in #254, #213, and #215 is implemented or explicitly release-gated;
focused and loading state tests cover success, race, not-found, failure, and accessibility paths;
style-guide decisions are current; relevant local checks have actually passed; CI and the independent
review gate must pass before any merge claim.
