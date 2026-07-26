# Nearest fountain and dog-bowl terminology — Design

**Date:** 2026-07-25  
**Issues:** #278, #279  
**Scope:** Backend discovery API, web map/detail, mobile map/detail, attribute metadata

## Goal

Let a user explicitly find the closest visible fountain to their current position on both map
clients, select it, and open its details. Make the primary detail actions easier to reach and scan
by placing icon-only Directions and Share controls beside the detail heading. Rename the existing
user-facing “Lower spout” attribute to “Dog bowl” without changing its stable identity or losing
observations.

## Product behavior

### Find nearest fountain

- Web and mobile add a persistent map action with the accessible name **Find nearest fountain**.
  It is visually distinct from the existing locate-me action: locate-me centers the camera on the
  user, while find-nearest selects a fountain and opens its details.
- Activation obtains a fresh foreground position through each platform's existing permission and
  timeout-bounded location path. It does not continuously transmit location or persist coordinates.
- On success, the client calls `GET /api/v1/fountains/nearest?lat=…&lng=…`. The endpoint returns the
  single nearest non-hidden fountain as a fully populated `FountainPin`, including `is_working`,
  ratings/ranking, current condition fields, and `distance_m`, or `404` when no visible fountain
  exists.
- “Nearest” is global rather than limited to the existing `/fountains` endpoint's 50 km safety cap.
  “Nearest” is defined by spherical great-circle distance, matching PostGIS geography's index-backed
  KNN `<->` operator. The query orders by `Fountain.location <-> point`, then fountain id as a
  deterministic equal-distance tie-break, and limits to one row. The returned `distance_m` uses
  `ST_Distance(location, point, false)`, the same spherical model. Latitude/longitude validation
  remains `[-90,90]` and `[-180,180]`; coordinate construction stays centralized in `app/geo.py`.
- Active rating/status filters do not change this command: its label promises the nearest fountain,
  not the nearest currently filtered pin. Hidden fountains remain excluded.
- Web merges the returned pin into the map source, moves the camera to it, and performs the same
  soft detail navigation as a pin click. Mobile moves the camera and pushes the existing fountain
  detail route. Both paths clear a transient search marker as normal fountain selection does. This
  explicit selection may temporarily show a pin excluded by active discovery filters, matching the
  existing deep-link focus behavior.
- Results through 50 km select immediately. For a result farther than 50 km, the client first shows
  a confirmation that includes a human-readable distance (for example, “The nearest fountain is
  1,842 km away. Show it?”); only confirmation moves the camera and opens details. Cancellation
  leaves the current map context intact. Distance formatting and the boundary are shared/tested per
  client. This keeps the lookup truthful and global without silently teleporting the map.
- While a request is active the control is disabled/busy. Denied permission, unavailable location,
  no mapped fountains, and network/server failures produce accessible, non-destructive feedback.
  Repeated activation is allowed after the prior request settles. Failures are logged without raw
  coordinates.

### Detail actions

- Directions and Share move directly below/beside the fountain title and status block, before
  ratings, dimensions, and contribution controls.
- Both actions use familiar glyphs (navigation/directions arrow and platform share glyph) rather
  than visible word labels. They retain at least a 44×44 px/pt target, accessible names, keyboard
  focus on web, and existing behavior. Web surfaces transient share feedback accessibly without
  replacing the icon; mobile retains its native share sheet and maps-link error handling.
- No new icon dependency is needed: web uses small inline SVG components following existing icon
  patterns, and mobile uses the installed Ionicons set.

### Dog-bowl terminology

- Attribute type id `3` and key `lower_spout` remain unchanged for database/API compatibility.
- A new reversible data migration changes its label to **Dog bowl** and description to **Has a
  dog-accessible drinking bowl**. The downgrade restores the exact prior label and description.
- The shipped `0006` seed migration remains immutable. Fresh and existing databases converge because
  both run the new migration on upgrade to head. The update targets stable id 3 and key
  `lower_spout`, not the previous label text; downgrade restores historical `Lower spout` / `Has a
lower / accessible spout`. Existing boolean observations and consensus values require no rewrite.
- Historical specs remain unchanged; the style guide records the current user-facing term.

## API and data considerations

- The new nearest route must be declared before `/fountains/{fountain_id}` and covered by OpenAPI;
  regenerate the tracked TypeScript client artifacts.
- The endpoint is public and read-only, matching other discovery reads. It accepts only validated
  numeric coordinates, returns no user/location record, and introduces no authentication change.
- The global nearest query must use geography KNN ordering (`Fountain.location <-> point`) rather
  than `ORDER BY ST_Distance`, which would scan/sort the global table. `ST_Distance(..., false)` is
  selected only to serialize the winning row's distance using the same spherical metric. Backend
  tests verify result correctness, full field parity, hidden-row exclusion, deterministic ties,
  invalid coordinates, empty data, filter independence, and that the literal `/nearest` route is
  not captured by `/{fountain_id}`. An `EXPLAIN` against representative production-scale statistics
  must confirm the GiST KNN index plan; a tiny test fixture's sequential plan is not sufficient.
- Clients map nearest `404` specifically to “No fountains have been mapped yet”; other non-2xx and
  transport failures use generic retryable feedback. The 404 is an empty-dataset case, not the
  far-away case handled by confirmation.

## Testing and release

- Backend: migration upgrade/downgrade metadata tests and nearest endpoint tests.
- Web: nearest-request/location outcome helpers and MapBrowser interaction coverage; fountain detail
  tests verify icon actions, stable accessible names, placement, tooltip text, and separate
  `aria-live` share feedback.
- Mobile: pure nearest-flow helper tests plus map screen/detail component coverage in CI; verify
  location denial/unavailable/error/no-result states and route selection.
- Run the repository's full local mirror within documented WSL limitations, then require all PR CI,
  security, and independent review gates to pass.
- Before merge, bump `mobile/app.config.ts`'s `defaultAppVersion` beyond the latest submitted
  marketing version and validate the resolved Expo version. After squash merge, dispatch and verify
  the web deploy workflow from `main`. The user explicitly authorized a mobile release in this
  request; dispatch the owner-gated mobile store release workflow with `platform=all`, then verify
  both the iOS build/submission and Android build/production submission jobs. Do not expose release
  credentials or deploy locally.

## Non-goals

- Replacing locate-me, adding background location, storing user coordinates, routing inside the
  app, or changing the `lower_spout` API key.
- Selecting the nearest fountain from only the currently loaded viewport.
