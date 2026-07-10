// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render, screen } from "@testing-library/react";

vi.mock("../map/MapStates", () => ({
  WaterCelebration: ({ triggerKey, points }: { triggerKey: number; points?: number }) =>
    triggerKey > 0 ? (
      <div data-testid="celebration">
        {triggerKey}
        {points != null ? `:${points}` : ""}
      </div>
    ) : null,
}));

import { ContributionStatusOverlay } from "./ContributionStatusOverlay";
import { dispatchContribution } from "../../lib/contribution-event";

afterEach(() => {
  cleanup();
});

describe("ContributionStatusOverlay", () => {
  it("shows celebration after contribution events", () => {
    render(<ContributionStatusOverlay />);

    expect(screen.queryByTestId("celebration")).not.toBeInTheDocument();
    act(() => {
      window.dispatchEvent(new Event("fountainrank:contribution"));
    });

    expect(screen.getByTestId("celebration")).toHaveTextContent("1");
  });

  it("forwards the awarded points from the CustomEvent detail (#2)", () => {
    render(<ContributionStatusOverlay />);
    act(() => {
      dispatchContribution(6);
    });
    expect(screen.getByTestId("celebration")).toHaveTextContent("1:6");
  });

  it("renders no number when points are omitted", () => {
    render(<ContributionStatusOverlay />);
    act(() => {
      dispatchContribution();
    });
    expect(screen.getByTestId("celebration")).toHaveTextContent(/^1$/);
  });
});
