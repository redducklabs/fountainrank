// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render, screen } from "@testing-library/react";

const { fetchFn } = vi.hoisted(() => ({ fetchFn: vi.fn() }));
vi.mock("../../app/actions/admin", () => ({ fetchPendingReportCount: fetchFn }));

import { ReportBadge } from "./ReportBadge";

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  vi.useRealTimers();
});

describe("ReportBadge", () => {
  it("renders nothing at count 0", () => {
    render(<ReportBadge initialCount={0} />);
    expect(screen.queryByText("0")).toBeNull();
  });

  it("renders the raw count for 1-9", () => {
    render(<ReportBadge initialCount={3} />);
    expect(screen.getByText("3")).toBeTruthy();
    expect(screen.getByText(", 3 pending reports")).toBeTruthy();
  });

  it("formats any count above 9 as 9+", () => {
    render(<ReportBadge initialCount={42} />);
    expect(screen.getByText("9+")).toBeTruthy();
    expect(screen.getByText(", 42 pending reports")).toBeTruthy();
  });

  it("polls fetchPendingReportCount on a ~60s interval and updates the count", async () => {
    vi.useFakeTimers();
    fetchFn.mockResolvedValue(5);
    render(<ReportBadge initialCount={0} />);
    expect(screen.queryByText("5")).toBeNull();
    expect(fetchFn).not.toHaveBeenCalled();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(60_000);
    });

    expect(fetchFn).toHaveBeenCalledTimes(1);
    expect(screen.getByText("5")).toBeTruthy();
  });

  it("hides again once a poll returns 0", async () => {
    vi.useFakeTimers();
    fetchFn.mockResolvedValue(0);
    render(<ReportBadge initialCount={4} />);
    expect(screen.getByText("4")).toBeTruthy();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(60_000);
    });

    expect(screen.queryByText("4")).toBeNull();
    expect(screen.queryByText("0")).toBeNull();
  });

  it("clears the interval on unmount", () => {
    vi.useFakeTimers();
    const clearSpy = vi.spyOn(global, "clearInterval");
    const { unmount } = render(<ReportBadge initialCount={1} />);
    unmount();
    expect(clearSpy).toHaveBeenCalled();
  });
});
