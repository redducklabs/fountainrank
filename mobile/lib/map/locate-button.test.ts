import { describe, expect, it } from "vitest";

import { locateButtonDescriptor } from "./locate-button";

describe("locateButtonDescriptor — the four states (spec §4)", () => {
  it("granted: the brand locate icon, 'Center on my location', not busy", () => {
    expect(
      locateButtonDescriptor({ status: "granted", refreshing: false, canAskAgain: true }),
    ).toEqual({
      visual: { kind: "icon", tone: "brand" },
      accessibilityRole: "button",
      accessibilityLabel: "Center on my location",
      accessibilityState: { busy: false },
    });
  });

  it("idle (pre-fetch) also shows the brand icon", () => {
    const d = locateButtonDescriptor({ status: "idle", refreshing: false, canAskAgain: true });
    expect(d.visual).toEqual({ kind: "icon", tone: "brand" });
  });

  it("locating: a spinner with busy announced (a press is a no-op, never disabled)", () => {
    const d = locateButtonDescriptor({ status: "locating", refreshing: false, canAskAgain: true });
    expect(d.visual).toEqual({ kind: "spinner" });
    expect(d.accessibilityState).toEqual({ busy: true });
    expect("accessibilityHint" in d).toBe(false);
  });

  it("refreshing (while granted): also the busy spinner", () => {
    const d = locateButtonDescriptor({ status: "granted", refreshing: true, canAskAgain: true });
    expect(d.visual).toEqual({ kind: "spinner" });
    expect(d.accessibilityState).toEqual({ busy: true });
  });

  it("denied (re-promptable): muted icon, retry label, hint mentions RETRY (not Settings)", () => {
    const d = locateButtonDescriptor({ status: "denied", refreshing: false, canAskAgain: true });
    expect(d.visual).toEqual({ kind: "icon", tone: "muted" });
    expect(d.accessibilityLabel).toBe("Location unavailable — tap to retry");
    expect(d.accessibilityHint).toMatch(/retr/i);
    expect(d.accessibilityHint).not.toMatch(/settings/i);
    expect(d.accessibilityState).toEqual({ busy: false });
  });

  it("denied permanently (canAskAgain false): the hint mentions Settings", () => {
    const d = locateButtonDescriptor({ status: "denied", refreshing: false, canAskAgain: false });
    expect(d.accessibilityHint).toMatch(/settings/i);
  });

  it("unavailable: the muted, actionable retry state", () => {
    const d = locateButtonDescriptor({
      status: "unavailable",
      refreshing: false,
      canAskAgain: true,
    });
    expect(d.visual).toEqual({ kind: "icon", tone: "muted" });
    expect(d.accessibilityLabel).toMatch(/tap to retry/i);
  });

  it("refreshing overrides a denied status with the busy spinner (a retry is in flight)", () => {
    const d = locateButtonDescriptor({ status: "denied", refreshing: true, canAskAgain: false });
    expect(d.visual).toEqual({ kind: "spinner" });
    expect(d.accessibilityState).toEqual({ busy: true });
  });
});
