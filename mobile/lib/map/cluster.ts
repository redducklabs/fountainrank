/// <reference types="@types/geojson" />
import Supercluster from "supercluster";

import type { RawBounds } from "./bounds";
import { CLUSTER_MAX_ZOOM, CLUSTER_RADIUS } from "./constants";
import { type PinInput, type PinProps, pinsToFeatureCollection } from "./pins";

/**
 * JS clustering for the native map.
 *
 * Native clustering is broken on this stack (Expo 56 / RN 0.85 /
 * @maplibre/maplibre-react-native 11.3.6 on the New Architecture): a clustered
 * `<GeoJSONSource>` renders nothing below clusterMaxZoom and never repaints on a
 * data update. So the source runs with `cluster={false}` and we compute clusters
 * here with supercluster, feeding the result to that same non-clustered source —
 * which renders and updates correctly. The `clusters` / `cluster-count` layers in
 * FountainMap already expect supercluster-shaped output (`point_count`,
 * `point_count_abbreviated`, `cluster_id`); leaf points keep their original
 * PinProps (`id` / `icon` / `pill`) so the `pins` / `pins-pill` layers are unchanged.
 *
 * Radius + maxZoom mirror web's maplibre-gl built-in clustering (same
 * CLUSTER_RADIUS / CLUSTER_MAX_ZOOM constants, which maplibre-gl feeds to its own
 * internal supercluster) so mobile and web cluster identically.
 */
export type ClusterIndex = Supercluster<PinProps>;

export function buildClusterIndex(pins: PinInput[]): ClusterIndex {
  const index = new Supercluster<PinProps>({
    radius: CLUSTER_RADIUS,
    maxZoom: CLUSTER_MAX_ZOOM,
  });
  index.load(pinsToFeatureCollection(pins).features);
  return index;
}

/**
 * Clusters/points visible in the current viewport. supercluster wants an integer
 * tile zoom, so the fractional map zoom is floored; the bbox order is
 * `[west, south, east, north]` (lng, lat, lng, lat).
 */
export function clustersForViewport(
  index: ClusterIndex,
  bounds: RawBounds,
  zoom: number,
): GeoJSON.FeatureCollection {
  return {
    type: "FeatureCollection",
    features: index.getClusters(
      [bounds.west, bounds.south, bounds.east, bounds.north],
      Math.floor(zoom),
    ),
  };
}
