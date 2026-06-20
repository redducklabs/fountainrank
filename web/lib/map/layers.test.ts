import { describe, expect, it } from "vitest";
import {
  fountainsSource,
  pinLayer,
  pillLayer,
  clusterCircleLayer,
  clusterCountLayer,
  selectedHaloLayer,
  selectedPinLayer,
} from "./layers";
import { CLUSTER_MAX_ZOOM, CLUSTER_RADIUS, PILL_MIN_ZOOM } from "./constants";

describe("fountainsSource", () => {
  it("clusters", () => {
    const s = fountainsSource();
    expect(s.cluster).toBe(true);
    expect(s.clusterRadius).toBe(CLUSTER_RADIUS);
    expect(s.clusterMaxZoom).toBe(CLUSTER_MAX_ZOOM);
    expect(s.data).toEqual({ type: "FeatureCollection", features: [] });
  });
});
describe("pinLayer", () => {
  it("uses the per-feature icon and excludes clusters", () => {
    const l = pinLayer();
    expect(l.layout!["icon-image"]).toEqual(["get", "icon"]);
    expect(l.layout!["icon-anchor"]).toBe("bottom");
    expect(JSON.stringify(l.filter)).toContain("point_count"); // !has point_count
  });
});
describe("pillLayer", () => {
  it("is a zoom-gated icon-text-fit pill excluding null pills + clusters", () => {
    const l = pillLayer();
    expect(l.minzoom).toBe(PILL_MIN_ZOOM);
    expect(l.layout!["icon-image"]).toBe("pill-bg");
    expect(l.layout!["icon-text-fit"]).toBe("both");
    expect(l.layout!["text-field"]).toEqual(["get", "pill"]);
    expect(JSON.stringify(l.filter)).toContain("pill");
  });
});
describe("cluster layers", () => {
  it("count uses point_count_abbreviated", () => {
    expect(clusterCountLayer().layout!["text-field"]).toEqual(["get", "point_count_abbreviated"]);
    expect(JSON.stringify(clusterCircleLayer().filter)).toContain("point_count");
  });
});
describe("selected layers", () => {
  it("halo + pin filter by id and swap icon for working non-gold", () => {
    expect(JSON.stringify(selectedHaloLayer("abc").filter)).toContain("abc");
    const sp = selectedPinLayer("abc");
    expect(JSON.stringify(sp.layout!["icon-image"])).toContain("pin-selected");
  });
});
