import { describe, expect, it } from "vitest";
import { CLUSTER_MAX_ZOOM, FOCUSED_PIN_ZOOM } from "./constants";
import {
  detailToPin,
  focusCameraAction,
  focusZoomClearsClusters,
  mergeFocusedPin,
  shouldMoveToStartupLocation,
} from "./focus";

const detail = {
  id: "focused",
  location: { longitude: -122.42, latitude: 37.77 },
  is_working: true,
  comments: null,
  average_rating: 4.2,
  rating_count: 3,
  ranking_score: 4.1,
  created_at: "2026-01-01T00:00:00Z",
  last_rated_at: null,
  dimensions: [],
  attributes: [],
};

describe("focused fountain map contract", () => {
  it("uses a deterministic pin-level zoom above clusterMaxZoom", () => {
    expect(focusZoomClearsClusters).toBe(true);
    expect(FOCUSED_PIN_ZOOM).toBeGreaterThan(CLUSTER_MAX_ZOOM);
    expect(focusCameraAction(detail)).toEqual({ center: [-122.42, 37.77], zoom: 16 });
  });

  it("converts detail and replaces duplicate bbox data with the exact focused pin", () => {
    const focused = detailToPin(detail);
    const merged = mergeFocusedPin(
      [
        { ...focused, average_rating: 1 },
        { ...focused, id: "other" },
      ],
      focused,
    );
    expect(merged.map((pin) => pin.id)).toEqual(["other", "focused"]);
    expect(merged[1]?.average_rating).toBe(4.2);
  });

  it("leaves bbox data unchanged without a resolved focus", () => {
    const pins = [detailToPin(detail)];
    expect(mergeFocusedPin(pins, null)).toBe(pins);
  });

  it("never lets startup geolocation clobber an explicit focused fountain", () => {
    expect(shouldMoveToStartupLocation("fountain-id")).toBe(false);
    expect(shouldMoveToStartupLocation("")).toBe(true);
  });
});
