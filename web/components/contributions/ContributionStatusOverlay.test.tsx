// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render, screen } from "@testing-library/react";
import type { AwardedPoints } from "@fountainrank/contributions";

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

/** Only the action layer can mint AwardedPoints; a test stands in for it. */
const awarded = (n: number) => n as AwardedPoints;

describe("ContributionStatusOverlay", () => {
  it("celebrates a real award and shows the server's number", () => {
    render(<ContributionStatusOverlay />);
    expect(screen.queryByTestId("celebration")).not.toBeInTheDocument();

    act(() => {
      dispatchContribution(awarded(6));
    });

    expect(screen.getByTestId("celebration")).toHaveTextContent("1:6");
  });

  it("does NOT celebrate when the server awarded 0 points (#204)", () => {
    render(<ContributionStatusOverlay />);
    act(() => {
      dispatchContribution(awarded(0));
    });

    // The contribution SAVED — the form says so — but it earned nothing, so there is no reward
    // animation. Before #204 this fired a full celebration on every re-rate.
    expect(screen.queryByTestId("celebration")).not.toBeInTheDocument();
  });

  it("does NOT celebrate an event with no verifiable award", () => {
    render(<ContributionStatusOverlay />);
    act(() => {
      // A bare Event carries no detail, so the award is unknown. Never celebrate what we cannot
      // verify — this used to render a numberless celebration.
      window.dispatchEvent(new Event("fountainrank:contribution"));
    });

    expect(screen.queryByTestId("celebration")).not.toBeInTheDocument();
  });
});
