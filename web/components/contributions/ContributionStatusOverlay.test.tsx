// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render, screen } from "@testing-library/react";

vi.mock("../map/MapStates", () => ({
  WaterCelebration: ({ triggerKey }: { triggerKey: number }) =>
    triggerKey > 0 ? <div data-testid="celebration">{triggerKey}</div> : null,
}));

import { ContributionStatusOverlay } from "./ContributionStatusOverlay";

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
});
