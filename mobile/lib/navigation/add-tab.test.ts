import { describe, expect, it, vi } from "vitest";
import { requestMapAddMode, subscribeMapAddMode } from "./add-tab";

describe("map add tab event bridge", () => {
  it("notifies active map subscribers", () => {
    const listener = vi.fn();
    const unsubscribe = subscribeMapAddMode(listener);

    requestMapAddMode();

    expect(listener).toHaveBeenCalledTimes(1);
    unsubscribe();
  });

  it("delivers a pending request to the next subscriber", () => {
    vi.useFakeTimers();
    const listener = vi.fn();

    requestMapAddMode();
    const unsubscribe = subscribeMapAddMode(listener);
    vi.runOnlyPendingTimers();

    expect(listener).toHaveBeenCalledTimes(1);
    unsubscribe();
    vi.useRealTimers();
  });
});
