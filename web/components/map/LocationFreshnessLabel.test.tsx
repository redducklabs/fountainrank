// @vitest-environment jsdom
import { act, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { LocationFreshnessLabel } from "./LocationFreshnessLabel";

describe("LocationFreshnessLabel", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("does not start its display ticker before a successful fix", () => {
    vi.useFakeTimers();
    vi.spyOn(document, "visibilityState", "get").mockReturnValue("visible");
    const setInterval = vi.spyOn(window, "setInterval");

    render(<LocationFreshnessLabel lastSuccessfulFixAtMs={null} />);

    expect(screen.getByText("Location unavailable")).toBeInTheDocument();
    expect(setInterval).not.toHaveBeenCalled();
  });

  it("updates only its label clock after a successful fix", () => {
    vi.useFakeTimers();
    vi.setSystemTime(10_000);
    vi.spyOn(document, "visibilityState", "get").mockReturnValue("visible");
    render(<LocationFreshnessLabel lastSuccessfulFixAtMs={10_000} />);

    act(() => {
      vi.advanceTimersByTime(2_000);
    });

    expect(screen.getByText("Location refreshed 2s ago")).toBeInTheDocument();
  });

  it("pauses while hidden, resumes immediately when visible, and cleans up", () => {
    vi.useFakeTimers();
    vi.setSystemTime(10_000);
    let visibilityState: DocumentVisibilityState = "visible";
    vi.spyOn(document, "visibilityState", "get").mockImplementation(() => visibilityState);
    const { unmount } = render(<LocationFreshnessLabel lastSuccessfulFixAtMs={10_000} />);
    expect(vi.getTimerCount()).toBe(1);

    act(() => {
      visibilityState = "hidden";
      document.dispatchEvent(new Event("visibilitychange"));
    });
    expect(vi.getTimerCount()).toBe(0);
    act(() => {
      vi.advanceTimersByTime(5_000);
    });
    expect(screen.getByText("Location refreshed 0s ago")).toBeInTheDocument();

    act(() => {
      visibilityState = "visible";
      document.dispatchEvent(new Event("visibilitychange"));
    });
    expect(screen.getByText("Location refreshed 5s ago")).toBeInTheDocument();
    expect(vi.getTimerCount()).toBe(1);

    unmount();
    expect(vi.getTimerCount()).toBe(0);
  });
});
