// @vitest-environment jsdom
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";

const { getMyContributionStats } = vi.hoisted(() => ({ getMyContributionStats: vi.fn() }));
vi.mock("../../app/actions/contributions", () => ({ getMyContributionStats }));
// The badge is now a next/link <Link>, which needs router context this unit test lacks — render a
// plain anchor instead (same pattern as app/.../page.test.tsx).
vi.mock("next/link", () => ({
  default: ({ children, href }: { children: ReactNode; href: string }) => (
    <a href={href}>{children}</a>
  ),
}));

import { ContributionStatusOverlay } from "./ContributionStatusOverlay";

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("ContributionStatusOverlay", () => {
  it("seeds points and refreshes them on contribution events", async () => {
    getMyContributionStats.mockResolvedValue({ ok: true, totalPoints: 12 });
    render(<ContributionStatusOverlay initialTotalPoints={7} />);

    // The badge shows the seeded points and is now a leaderboard link.
    expect(screen.getByText("7")).toBeInTheDocument();
    const link = screen.getByRole("link");
    expect(link).toHaveAttribute("href", "/leaderboard");
    expect(link.parentElement).toHaveClass("top-16", "z-40");
    window.dispatchEvent(new Event("fountainrank:contribution"));

    await waitFor(() => expect(getMyContributionStats).toHaveBeenCalled());
    await waitFor(() => expect(screen.getByText("12")).toBeInTheDocument());
  });
});
