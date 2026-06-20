/** Thresholds + map tuning. Behavior is tested; values are tunable here. */
export const GOLD_THRESHOLD = 4; // ranking_score strictly greater -> gold (spec §7.2)
export const MAX_BBOX_RESULTS = 500; // pinned contract: mirrors backend settings.max_results (Task 9 test)
export const MIN_ZOOM = 10; // below this we don't fetch (spec §6.1)
export const PILL_MIN_ZOOM = 13; // rating pill appears at/above this zoom
export const DEBOUNCE_MS = 300;
export const GEOLOCATE_TIMEOUT_MS = 8000;
export const NEIGHBORHOOD_ZOOM = 14;
export const DEFAULT_CENTER: [number, number] = [-98.5, 39.8]; // continental US [lng, lat]
export const DEFAULT_ZOOM = 3.5;
export const CLUSTER_RADIUS = 60;
export const CLUSTER_MAX_ZOOM = 14;
