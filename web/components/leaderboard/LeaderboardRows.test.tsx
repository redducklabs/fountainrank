// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { LeaderboardRows } from "./LeaderboardRows";
import type { ContributorRow, YourStanding } from "../../lib/leaderboard";

afterEach(cleanup);

const row = (over: Partial<ContributorRow> = {}): ContributorRow => ({
  rank: 1,
  display_name: "Alice",
  points: 100,
  category_count: null,
  is_you: false,
  ...over,
});

describe("LeaderboardRows", () => {
  it("shows the empty state AND the pinned 'You' row on an empty total board (#117)", () => {
    const you: YourStanding = { rank: null, points: 0, category_count: null };
    render(<LeaderboardRows rows={[]} you={you} sort="total" />);
    expect(screen.getByText("No contributors yet.")).toBeInTheDocument();
    // The signed-in caller's standing is still shown (unranked).
    expect(screen.getByText("Not yet ranked")).toBeInTheDocument();
  });

  it("shows the pinned 'You' row on an empty category board, with total points in the caption", () => {
    const you: YourStanding = { rank: null, points: 20, category_count: 0 };
    render(<LeaderboardRows rows={[]} you={you} sort="notes" />);
    expect(screen.getByText("No contributors yet.")).toBeInTheDocument();
    expect(screen.getByText("Not yet ranked")).toBeInTheDocument();
    expect(screen.getByText(/20 pts/)).toBeInTheDocument(); // total points, not category points
  });

  it("pins a ranked 'You' row when the caller is below the visible cut", () => {
    const you: YourStanding = { rank: 42, points: 5, category_count: null };
    render(<LeaderboardRows rows={[row()]} you={you} sort="total" />);
    expect(screen.getByText("42")).toBeInTheDocument();
    expect(screen.getByText("You")).toBeInTheDocument();
  });

  it("does not pin a duplicate 'You' row when the caller is already in the list", () => {
    const you: YourStanding = { rank: 1, points: 100, category_count: null };
    render(<LeaderboardRows rows={[row({ is_you: true })]} you={you} sort="total" />);
    expect(screen.queryByText("Not yet ranked")).toBeNull();
    expect(screen.getAllByText("You")).toHaveLength(1); // the in-list tag only
  });
});
