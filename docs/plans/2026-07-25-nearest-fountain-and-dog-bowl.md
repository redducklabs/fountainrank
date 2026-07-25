# Nearest fountain and dog-bowl terminology — Implementation Plan

**Spec:** `docs/specs/2026-07-25-nearest-fountain-and-dog-bowl-design.md`  
**Issues:** #278, #279

## Task 1 — Nearest discovery contract

- Add failing backend tests for spherical-nearest correctness, complete pin-field parity, hidden
  exclusion, deterministic ties, empty results, coordinate validation, filter independence,
  `distance_m`, and literal-route precedence over `/{fountain_id}`.
- Implement the public `GET /api/v1/fountains/nearest` route using the centralized geography point
  helper, explicit geography `<->` KNN ordering, id tie-break, and spherical distance serialization.
  Treat an empty result as a normal 404 without error logging; rely on centralized exception/request
  logging for unexpected database failures and never log raw coordinates.
- Run `EXPLAIN` against representative production-scale statistics and record evidence that the GiST
  KNN index serves the ordering; do not infer index use from tiny test fixtures.
- Regenerate the tracked OpenAPI/client schema and add/update client contract checks.
- Run backend and API-client checks.

## Task 2 — Attribute terminology migration

- Add a new reversible Alembic data migration that changes only attribute type id 3/key
  `lower_spout` metadata to `Dog bowl` / `Has a dog-accessible drinking bowl`.
- Keep the already-shipped `0006` migration immutable. Target id/key rather than matching label text;
  extend migration tests for fresh upgrade convergence and exact historical downgrade values.
- Run backend migration, drift, lint, and test checks against the isolated environment.

## Task 3 — Style-guide contract

- Before adding UI, update `docs/style-guide.md` with the placement and distinct navigation-arrow
  glyph for Find nearest fountain, its separation from MapLibre's crosshair locate-me control, the
  44×44 icon-action pattern/tooltips, far-distance confirmation, and Dog bowl wording.

## Task 4 — Web nearest action and detail icons

- Add tested client helpers for requesting a fresh position, classifying nearest lookup outcomes,
  preserving cancellation/stale-response safety, formatting distance, and requiring confirmation
  beyond 50 km.
- Add the persistent Find nearest fountain control to `MapBrowser`. On success merge/select/focus
  the returned pin and use the existing soft detail navigation; cover loading and all error states
  with accessible feedback and coordinate-free diagnostic logging. Map nearest 404 to the empty
  message and retain an explicitly selected pin even when active filters would exclude it.
- Move Directions and Share beside the detail heading and replace visible text with inline standard
  SVG icons, keeping stable accessible labels, tooltip text, focus treatment, minimum target sizing,
  and a separate `aria-live` share-feedback region.
- Update web component/interaction tests.

## Task 5 — Mobile nearest action and detail icons

- Add a tested pure coordinator/helper that maps the existing foreground-location refresh outcome
  and nearest API response into camera/navigation/toast actions without duplicate in-flight work;
  include distance formatting and a confirmation action for results beyond 50 km.
- Add a safe-area-aware Find nearest fountain control to the map screen. Use the existing location
  hook, call the generated nearest endpoint, clear search selection, fly to the returned pin, seed
  its cache/source where appropriate, and push the existing detail route. Cover denied/settings,
  unavailable, 404-empty, and request-failure feedback. Retain the selected pin even when active
  filters would exclude it.
- Move Directions and Share beside the detail heading and render Ionicons icon buttons with
  accessible labels and 44-point targets. Update component tests.

## Task 6 — Versioning and verification

- Inspect the latest submitted mobile marketing version and release/tag history, bump
  `mobile/app.config.ts`'s `defaultAppVersion` to a new version, and verify Expo's resolved public and
  prebuild configs. Commit the bump with the feature so the post-merge store dispatch cannot reuse an
  iOS `CFBundleShortVersionString`.
- Run formatting plus all locally supported backend, API-client, web, and mobile checks, including a
  production web build. Record any host-limited render suites as CI-only rather than claiming them.
- Commit in Conventional Commit units, run the full local mirror, push, and open one PR closing both
  issues.

## Task 7 — Review, merge, deploy, and mobile release

- Monitor all PR checks to green. Run the required independent PR review loop, address every
  `[BLOCKER]`/`[MAJOR]` and every GitHub top-level/inline comment, rerun checks, and obtain
  `VERDICT: APPROVED`.
- Squash-merge only after every gate is green.
- Dispatch `deploy.yml` from `main`, monitor all jobs, and verify the production web/API health and
  nearest behavior without mutating application data.
- Dispatch `mobile-store-release.yml` from `main` with `platform=all`; monitor release notes,
  Android build + Google Play production submission, and iOS build + App Store Connect submission
  to successful completion. Report exact workflow/run outcomes and any external store-processing
  state separately.

## Verification evidence

- PostGIS query plan checked with 100,000 transaction-scoped test fountains on 2026-07-25. The
  plan was `Index Scan using idx_fountains_location` ordered by `<->`, followed only by
  `Incremental Sort` with the KNN distance as its presorted key and id as its tie-break; there was
  no sequential scan or full sort. The transaction was rolled back.
