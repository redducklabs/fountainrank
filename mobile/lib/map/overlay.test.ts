import { describe, expect, it } from "vitest";

import type { ViewState } from "../view-state";
import { resolveMapOverlay, STALE_PINS_MESSAGE } from "./overlay";

const base = {
  belowZoom: false,
  viewState: "ready" as ViewState,
  refetching: false,
  capped: false,
  stalePins: false,
  locating: false,
};

describe("resolveMapOverlay — stale-pins banner (isError && data != null)", () => {
  it("renders the persistent stale copy as a polite alert with a retry affordance", () => {
    const model = resolveMapOverlay({ ...base, viewState: "error", stalePins: true });
    expect(model).toEqual({
      kind: "banner",
      spinner: null,
      message: STALE_PINS_MESSAGE,
      retryable: true,
      stale: true,
      accessibilityRole: "alert",
      accessibilityLiveRegion: "polite",
    });
    // Both accessibility properties are asserted, per the spec — a visually present but
    // non-announced banner cannot pass.
    expect(model.kind === "banner" && model.accessibilityRole).toBe("alert");
    expect(model.kind === "banner" && model.accessibilityLiveRegion).toBe("polite");
  });

  it("takes precedence over the offline/error message and the below-zoom hint", () => {
    const offline = resolveMapOverlay({ ...base, viewState: "offline", stalePins: true });
    expect(offline.kind === "banner" && offline.message).toBe(STALE_PINS_MESSAGE);
    const belowZoom = resolveMapOverlay({
      ...base,
      belowZoom: true,
      viewState: "error",
      stalePins: true,
    });
    expect(belowZoom.kind === "banner" && belowZoom.message).toBe(STALE_PINS_MESSAGE);
  });

  it("shows the updating spinner alongside the stale banner while a retry is in flight", () => {
    const model = resolveMapOverlay({
      ...base,
      viewState: "error",
      stalePins: true,
      refetching: true,
    });
    expect(model.kind === "banner" && model.spinner).toBe("updating");
    expect(model.kind === "banner" && model.stale).toBe(true);
  });
});

describe("resolveMapOverlay — non-stale states keep the existing behavior", () => {
  it("a NEW-key error (data == null → stalePins false) shows the full error overlay, not the banner", () => {
    const model = resolveMapOverlay({ ...base, viewState: "error", stalePins: false });
    expect(model).toEqual({
      kind: "banner",
      spinner: null,
      message: "Couldn't load fountains",
      retryable: true,
      stale: false,
      accessibilityRole: undefined,
      accessibilityLiveRegion: "none",
    });
  });

  it("offline (no data) is a retryable full overlay, silent to the live region", () => {
    const model = resolveMapOverlay({ ...base, viewState: "offline" });
    expect(model.kind === "banner" && model.message).toBe("You appear to be offline");
    expect(model.kind === "banner" && model.retryable).toBe(true);
    expect(model.kind === "banner" && model.stale).toBe(false);
    expect(model.kind === "banner" && model.accessibilityRole).toBeUndefined();
  });

  it("loading and background-refetch show only the corresponding spinner", () => {
    const loading = resolveMapOverlay({ ...base, viewState: "loading" });
    expect(loading.kind === "banner" && loading.spinner).toBe("loading");
    const refetching = resolveMapOverlay({ ...base, refetching: true });
    expect(refetching.kind === "banner" && refetching.spinner).toBe("updating");
    expect(refetching.kind === "banner" && refetching.message).toBeNull();
  });

  it("below-zoom, empty, and capped hints are non-retryable messages", () => {
    expect(resolveMapOverlay({ ...base, belowZoom: true, viewState: "loading" })).toMatchObject({
      message: "Zoom in to see fountains",
      retryable: false,
    });
    expect(resolveMapOverlay({ ...base, viewState: "empty" })).toMatchObject({
      message: "No fountains in this area",
      retryable: false,
    });
    expect(resolveMapOverlay({ ...base, viewState: "ready", capped: true })).toMatchObject({
      message: "Showing the first 500 — zoom in for more",
      retryable: false,
    });
  });

  it("is hidden when ready, not capped, not loading, not refetching", () => {
    expect(resolveMapOverlay(base)).toEqual({ kind: "hidden" });
  });
});

describe("resolveMapOverlay — locating (first-fix) priority (spec §5)", () => {
  it("shows 'Locating you…' above the below-zoom hint (not the misleading zoom message)", () => {
    const model = resolveMapOverlay({ ...base, locating: true, belowZoom: true });
    expect(model).toMatchObject({ message: "Locating you…", retryable: false });
  });

  it("ranks below the offline/error states — a real data error still wins", () => {
    expect(resolveMapOverlay({ ...base, locating: true, viewState: "offline" })).toMatchObject({
      message: "You appear to be offline",
      retryable: true,
    });
    expect(resolveMapOverlay({ ...base, locating: true, viewState: "error" })).toMatchObject({
      message: "Couldn't load fountains",
      retryable: true,
    });
  });

  it("the below-zoom hint RETURNS once locating ends (denial/failure)", () => {
    // status is no longer "locating" (denied/unavailable) → locating false → below-zoom hint again.
    const model = resolveMapOverlay({ ...base, locating: false, belowZoom: true });
    expect(model).toMatchObject({ message: "Zoom in to see fountains" });
  });

  it("still shows 'Locating you…' with a loading spinner when pins are also loading", () => {
    const model = resolveMapOverlay({ ...base, locating: true, viewState: "loading" });
    expect(model).toMatchObject({ message: "Locating you…", spinner: "loading" });
  });
});
