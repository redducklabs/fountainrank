import { describe, expect, it, vi } from "vitest";
import { requestMapSearch, subscribeMapSearch } from "./map-search";

describe("map search tab event bridge", () => {
  it("notifies active map subscribers", () => {
    const listener = vi.fn();
    const unsubscribe = subscribeMapSearch(listener);

    requestMapSearch();

    expect(listener).toHaveBeenCalledTimes(1);
    unsubscribe();
  });

  it("delivers a pending request to the next subscriber", () => {
    vi.useFakeTimers();
    const listener = vi.fn();

    requestMapSearch();
    const unsubscribe = subscribeMapSearch(listener);
    vi.runOnlyPendingTimers();

    expect(listener).toHaveBeenCalledTimes(1);
    unsubscribe();
    vi.useRealTimers();
  });
});
