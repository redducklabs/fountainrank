import { describe, expect, it } from "vitest";

import {
  SETTINGS_OPEN_FAILED_TEXT,
  TOAST_AUTO_DISMISS_MS,
  TOAST_AUTO_DISMISS_WITH_ACTION_MS,
  toastAutoDismissMs,
} from "./toast";

describe("toastAutoDismissMs (spec §3)", () => {
  it("a plain toast auto-dismisses at 3.2 s", () => {
    expect(toastAutoDismissMs(false)).toBe(TOAST_AUTO_DISMISS_MS);
    expect(TOAST_AUTO_DISMISS_MS).toBe(3200);
  });

  it("a toast WITH an action extends the window to 6 s", () => {
    expect(toastAutoDismissMs(true)).toBe(TOAST_AUTO_DISMISS_WITH_ACTION_MS);
    expect(TOAST_AUTO_DISMISS_WITH_ACTION_MS).toBe(6000);
    expect(toastAutoDismissMs(true)).toBeGreaterThan(toastAutoDismissMs(false));
  });
});

describe("settings-open failure replacement (spec §3)", () => {
  it("has a plain, action-free replacement message", () => {
    expect(SETTINGS_OPEN_FAILED_TEXT).toMatch(/settings/i);
    expect(SETTINGS_OPEN_FAILED_TEXT.length).toBeGreaterThan(0);
  });
});
