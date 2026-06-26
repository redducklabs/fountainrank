// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";

const { getMyContributionStats } = vi.hoisted(() => ({ getMyContributionStats: vi.fn() }));
vi.mock("../../app/actions/contributions", () => ({ getMyContributionStats }));

import { ContributionStatusOverlay } from "./ContributionStatusOverlay";

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("ContributionStatusOverlay", () => {
  it("seeds points and refreshes them on contribution events", async () => {
    getMyContributionStats.mockResolvedValue({ ok: true, totalPoints: 12 });
    render(<ContributionStatusOverlay initialTotalPoints={7} />);

    expect(screen.getByLabelText("7 points")).toBeInTheDocument();
    expect(screen.getByLabelText("7 points").parentElement).toHaveClass("top-16", "z-40");
    window.dispatchEvent(new Event("fountainrank:contribution"));

    await waitFor(() => expect(getMyContributionStats).toHaveBeenCalled());
    await waitFor(() => expect(screen.getByLabelText("12 points")).toBeInTheDocument());
  });
});
