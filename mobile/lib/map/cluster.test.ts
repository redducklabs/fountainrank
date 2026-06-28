import { describe, expect, it } from "vitest";

import type { RawBounds } from "./bounds";
import { buildClusterIndex, clustersForViewport } from "./cluster";
import type { PinInput } from "./pins";

// A tight knot of fountains in downtown San Diego (tens of meters apart) so they
// merge into one cluster at low zoom and separate only when zoomed past the
// cluster boundary.
const SD: PinInput[] = [
  {
    id: "a",
    location: { latitude: 32.715, longitude: -117.16 },
    is_working: true,
    average_rating: 4.5,
    ranking_score: 4.6,
  },
  {
    id: "b",
    location: { latitude: 32.7151, longitude: -117.1601 },
    is_working: true,
    average_rating: 3,
    ranking_score: 3,
  },
  {
    id: "c",
    location: { latitude: 32.7152, longitude: -117.1602 },
    is_working: false,
    average_rating: null,
    ranking_score: null,
  },
];

const SD_BBOX: RawBounds = { west: -117.3, south: 32.6, east: -117.0, north: 32.8 };
const WORLD: RawBounds = { west: -180, south: -85, east: 180, north: 85 };

describe("buildClusterIndex / clustersForViewport", () => {
  it("returns an empty FeatureCollection when there are no pins", () => {
    const fc = clustersForViewport(buildClusterIndex([]), WORLD, 3);
    expect(fc.type).toBe("FeatureCollection");
    expect(fc.features).toHaveLength(0);
  });

  it("merges nearby pins into one cluster below the cluster-max-zoom", () => {
    const fc = clustersForViewport(buildClusterIndex(SD), SD_BBOX, 9);
    expect(fc.features).toHaveLength(1);
    const props = fc.features[0].properties!;
    expect(props.cluster).toBe(true);
    expect(props.point_count).toBe(3);
    // supercluster keeps the raw count (not "3" string) below 1000 — the layer
    // reads point_count_abbreviated.
    expect(props.point_count_abbreviated).toBe(3);
    expect(typeof props.cluster_id).toBe("number");
  });

  it("returns individual pins carrying their original PinProps past the boundary", () => {
    const fc = clustersForViewport(buildClusterIndex(SD), SD_BBOX, 18);
    expect(fc.features).toHaveLength(3);
    for (const f of fc.features) {
      expect(f.properties!.cluster).toBeUndefined();
      expect(f.properties!.point_count).toBeUndefined();
    }
    const byId = Object.fromEntries(fc.features.map((f) => [f.properties!.id, f.properties!]));
    expect(byId.a.icon).toBe("pin-gold"); // working + ranking_score 4.6 > GOLD_THRESHOLD
    expect(byId.a.pill).toBe("★ 4.5");
    expect(byId.c.icon).toBe("pin-broken"); // not working
    expect(byId.c.pill).toBeNull(); // unrated
  });

  it("excludes pins outside the requested viewport bbox", () => {
    // A bbox over the Atlantic — none of the SD pins fall inside it.
    const fc = clustersForViewport(
      buildClusterIndex(SD),
      { west: -40, south: 30, east: -20, north: 45 },
      18,
    );
    expect(fc.features).toHaveLength(0);
  });

  it("floors a fractional zoom and exposes a higher expansion zoom for tap-to-zoom", () => {
    const index = buildClusterIndex(SD);
    // A fractional map zoom must not throw and must behave like its floor (9).
    const fc = clustersForViewport(index, SD_BBOX, 9.8);
    expect(fc.features).toHaveLength(1);
    const clusterId = fc.features[0].properties!.cluster_id as number;
    const expansionZoom = index.getClusterExpansionZoom(clusterId);
    expect(typeof expansionZoom).toBe("number");
    expect(expansionZoom).toBeGreaterThan(9);
  });
});
