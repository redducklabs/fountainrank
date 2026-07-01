// Pure helpers for the transient "searched location" marker (spec §7.1). No
// React, no map library types - the map screen (Task 12) owns the
// `searchMarker` state and calls these to decide when to drop it and how to
// shape it as GeoJSON for `FountainMap`'s dedicated `search-result` source.

/**
 * The reason a marker-clear check is being made:
 * - "region": a map viewport change (`FountainMap`'s `onRegionChange`), which
 *   fires after BOTH a user gesture (pan/zoom) AND a programmatic camera fly -
 *   including the very `setFlyTo` that places the marker. Only this cause
 *   needs `userInteraction` to tell the two apart.
 * - "press": a plain map tap (`FountainMap`'s `onMapPress`).
 * - "newSearch": the user opened/started a new search.
 * - "pinSelect": the user tapped a fountain pin.
 */
export type MarkerClearCause = "region" | "press" | "newSearch" | "pinSelect";

export type ShouldClearSearchMarkerInput = {
  /**
   * Only meaningful for `cause: "region"`: `true` for a user-initiated
   * gesture, `false` for a programmatic camera fly (e.g. the `setFlyTo` that
   * placed the marker) - see `ViewStateChangeEvent.userInteraction` in
   * `@maplibre/maplibre-react-native`.
   */
  userInteraction: boolean;
  cause: MarkerClearCause;
};

/**
 * Whether the search-result marker should be cleared for the given cause
 * (spec §7.1). A region change only clears the marker when it was driven by
 * the user (a pan/zoom) - the programmatic fly that placed the marker must
 * NOT clear it. Every other cause (a plain map press, starting a new search,
 * or selecting a fountain pin) is an unconditional user action and always
 * clears it.
 */
export function shouldClearSearchMarker(input: ShouldClearSearchMarkerInput): boolean {
  if (input.cause !== "region") return true;
  return input.userInteraction;
}

/** A searched location, in the app's usual `{ latitude, longitude }` shape. */
export type SearchMarkerPoint = { latitude: number; longitude: number };

/**
 * Builds the GeoJSON fed to `FountainMap`'s dedicated `search-result` source -
 * an empty collection when there is no marker, otherwise a single Point
 * feature at `[longitude, latitude]` (GeoJSON's lng/lat coordinate order).
 * Mirrors `add-fountain/placement.ts`'s `pinFeatureCollection`, kept as its
 * own copy so `map-search` has no dependency on `add-fountain`.
 */
export function searchMarkerFeatureCollection(
  point: SearchMarkerPoint | null,
): GeoJSON.FeatureCollection {
  if (!point) return { type: "FeatureCollection", features: [] };
  return {
    type: "FeatureCollection",
    features: [
      {
        type: "Feature",
        properties: {},
        geometry: { type: "Point", coordinates: [point.longitude, point.latitude] },
      },
    ],
  };
}
