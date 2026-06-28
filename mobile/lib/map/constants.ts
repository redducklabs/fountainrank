/** Map thresholds + tuning for slice 6e-3. Values mirror web/lib/map/constants.ts
 *  so mobile and web behave identically; behavior is tested in bounds/pins tests. */
export const GOLD_THRESHOLD = 4; // ranking_score strictly greater -> gold (spec section 7.2)
export const MAX_BBOX_RESULTS = 500; // pinned contract: mirrors backend settings.max_results
export const MIN_ZOOM = 8; // below this we don't fetch pins
export const PILL_MIN_ZOOM = 13; // rating pill appears at/above this zoom
export const NEIGHBORHOOD_ZOOM = 14; // fly-to zoom after locating the user
export const INITIAL_USER_ZOOM = NEIGHBORHOOD_ZOOM;
export const DEFAULT_CENTER: [number, number] = [-98.5, 39.8]; // continental US [lng, lat]
export const DEFAULT_ZOOM = 3.5;
export const CLUSTER_RADIUS = 60;
// Diverges from web (14) on purpose: the native maplibre clustered source renders
// NOTHING at zoom >= clusterMaxZoom on this stack (confirmed on-device — pins:N fc:N
// but nat:0 at exactly z14, which is also the user's landing zoom; below 14 it works).
// Keep the cluster boundary above the normal browse/add zoom range (PLACE_MIN_ZOOM=16)
// so clustering stays active and pins render; the bug then only hits at z>=20 (rare).
export const CLUSTER_MAX_ZOOM = 20;
export const BOUND_RADIUS_MIN_M = 150;
export const ACCURACY_MAX_M = 1000;
export const PLACE_MIN_ZOOM = 16;
export const FALLBACK_MAX_SPAN_M = 4000;
export const NUDGE_STEP_M = 5;
// Bottom camera padding (points) applied when flying to the placement target while
// the add sheet is open, so the pin frames above the sheet instead of hiding under
// it (#100). Approximate; tune on-device against the placing-phase panel height.
export const ADD_SHEET_CAMERA_PADDING = 260;
