// @vitest-environment jsdom
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";

const { getMyContributionStats } = vi.hoisted(() => ({ getMyContributionStats: vi.fn() }));
vi.mock("../app/actions/contributions", () => ({ getMyContributionStats }));
vi.mock("next/link", () => ({
  default: ({
    children,
    href,
    ...props
  }: {
    children: ReactNode;
    href: string;
    [key: string]: unknown;
  }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));

import { HeaderPoints } from "./HeaderPoints";

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("HeaderPoints", () => {
  it("links to the leaderboard and refreshes after contribution events", async () => {
    getMyContributionStats.mockResolvedValue({ ok: true, totalPoints: 42 });
    render(<HeaderPoints initialTotalPoints={7} />);

    expect(screen.getByRole("link", { name: /7 points/i })).toHaveAttribute("href", "/leaderboard");

    window.dispatchEvent(new Event("fountainrank:contribution"));

    await waitFor(() => expect(getMyContributionStats).toHaveBeenCalled());
    await waitFor(() =>
      expect(screen.getByRole("link", { name: /42 points/i })).toBeInTheDocument(),
    );
  });
});
