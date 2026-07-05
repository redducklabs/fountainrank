import {
  createExpression,
  type Feature,
  type GlobalProperties,
} from "@maplibre/maplibre-gl-style-spec";
import { describe, expect, it } from "vitest";
import {
  fountainsSource,
  pinLayer,
  pillLayer,
  clusterCircleLayer,
  clusterCountLayer,
  selectedHaloLayer,
  selectedPinLayer,
  selectedIconExpr,
} from "./layers";
import { mapColorsFor } from "./colors";
import { CLUSTER_MAX_ZOOM, CLUSTER_RADIUS, PILL_MIN_ZOOM } from "./constants";

const light = mapColorsFor("light");
const dark = mapColorsFor("dark");

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
describe("cluster layers", () => {
  it("count uses point_count_abbreviated", () => {
    expect(clusterCountLayer(light).layout!["text-field"]).toEqual([
      "get",
      "point_count_abbreviated",
    ]);
    expect(JSON.stringify(clusterCircleLayer(light).filter)).toContain("point_count");
  });
  it("dark uses brightened circle paint", () => {
    expect(clusterCircleLayer(dark).paint!["circle-color"]).toBe("#4C82F0");
    expect(clusterCircleLayer(dark).paint!["circle-stroke-color"]).toBe("#0B1220");
  });
});

describe("pillLayer", () => {
  it("is a zoom-gated icon-text-fit pill excluding null pills + clusters", () => {
    const l = pillLayer(light);
    expect(l.minzoom).toBe(PILL_MIN_ZOOM);
    expect(l.layout!["icon-image"]).toBe("pill-bg");
    expect(l.layout!["icon-text-fit"]).toBe("both");
    expect(l.layout!["text-field"]).toEqual(["get", "pill"]);
    expect(JSON.stringify(l.filter)).toContain("pill");
  });
  it("dark uses the dark pill image + light pill text", () => {
    const l = pillLayer(dark);
    expect(l.layout!["icon-image"]).toBe("pill-bg-dark");
    expect(l.paint!["text-color"]).toBe("#E7F0FF");
  });
});

describe("selected layers", () => {
  it("halo + pin filter by id and swap icon for working non-gold", () => {
    expect(JSON.stringify(selectedHaloLayer("abc", light).filter)).toContain("abc");
    const sp = selectedPinLayer("abc", light.selectedPin);
    expect(JSON.stringify(sp.layout!["icon-image"])).toContain("pin-selected");
  });
  it("dark selected pin uses the -dark asset name + brightened halo", () => {
    expect(selectedHaloLayer("abc", dark).paint!["circle-color"]).toBe("#5FC5F0");
    const sp = selectedPinLayer("abc", dark.selectedPin);
    expect(JSON.stringify(sp.layout!["icon-image"])).toContain("pin-selected-dark");
  });
});

/**
 * Behavioral cross-check: evaluates selectedIconExpr (the shipping MapLibre
 * expression) over a property matrix and asserts it agrees with the selection
 * rule.  selectedSwapIcon() in pins.ts is the readable TS mirror of that rule;
 * this test guards the two implementations against divergence.
 *
 * Rule: feature gets "pin-selected" when is_working === true AND it is RATED
 * (ranking_score != null) AND not gold (ranking_score <= GOLD_THRESHOLD);
 * otherwise (broken, gold, or unrated) it falls back to the feature's own
 * `icon` property.
 */
describe("selectedIconExpr behavioral matrix", () => {
  const globals: GlobalProperties = { zoom: 0 };

  function evalExpr(props: {
    is_working: boolean;
    ranking_score: number | null;
    icon: string;
  }): string {
    // Pass null for propertySpec — the second arg is optional; null skips
    // property-type constraints while still parsing the expression fully.
    const parsed = createExpression(selectedIconExpr("pin-selected"), null);
    if (parsed.result !== "success") {
      throw new Error(`Failed to parse SELECTED_ICON_EXPR: ${JSON.stringify(parsed.value)}`);
    }
    const feature: Feature = {
      type: "Point",
      properties: props,
    };
    return parsed.value.evaluate(globals, feature) as string;
  }

  it("working, ranking_score null (unrated) → falls back to feature icon", () => {
    expect(evalExpr({ is_working: true, ranking_score: null, icon: "pin-unrated" })).toBe(
      "pin-unrated",
    );
  });

  it("working, ranking_score 3.2 → pin-selected", () => {
    expect(evalExpr({ is_working: true, ranking_score: 3.2, icon: "pin-standard" })).toBe(
      "pin-selected",
    );
  });

  it("working, ranking_score 4 (boundary, NOT gold) → pin-selected", () => {
    expect(evalExpr({ is_working: true, ranking_score: 4, icon: "pin-standard" })).toBe(
      "pin-selected",
    );
  });

  it("working, ranking_score 4.6 (gold) → falls back to feature icon", () => {
    expect(evalExpr({ is_working: true, ranking_score: 4.6, icon: "pin-gold" })).toBe("pin-gold");
  });

  it("broken (is_working false) → falls back to feature icon", () => {
    expect(evalExpr({ is_working: false, ranking_score: null, icon: "pin-broken" })).toBe(
      "pin-broken",
    );
  });
});
