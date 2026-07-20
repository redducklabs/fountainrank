// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { LeaderboardRows } from "./LeaderboardRows";
import type { AdminContributorRow, ContributorRow, YourStanding } from "../../lib/leaderboard";

// jsdom has no IntersectionObserver; provide a controllable stub so the sticky-overlay
// visibility logic (#147) can be driven from tests. Each instance records its callback.
let observerCallbacks: IntersectionObserverCallback[] = [];
class MockIntersectionObserver {
  constructor(cb: IntersectionObserverCallback) {
    observerCallbacks.push(cb);
  }
  observe() {}
  unobserve() {}
  disconnect() {}
  takeRecords() {
    return [];
  }
}

function emitIntersection(isIntersecting: boolean) {
  act(() => {
    for (const cb of observerCallbacks) {
      cb([{ isIntersecting } as IntersectionObserverEntry], {} as IntersectionObserver);
    }
  });
}

beforeEach(() => {
  observerCallbacks = [];
  vi.stubGlobal("IntersectionObserver", MockIntersectionObserver);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const row = (over: Partial<ContributorRow> = {}): ContributorRow => ({
  rank: 1,
  display_name: "Alice",
  avatar_url: null,
  points: 100,
  category_count: null,
  is_you: false,
  ...over,
});

describe("LeaderboardRows", () => {
  it("shows the empty state AND the 'You' overlay on an empty total board (#117)", () => {
    const you: YourStanding = { rank: null, points: 0, category_count: null };
    render(<LeaderboardRows rows={[]} you={you} sort="total" />);
    expect(screen.getByText("No contributors yet.")).toBeInTheDocument();
    // The signed-in caller's standing is still shown (unranked).
    expect(screen.getByText("Not yet ranked")).toBeInTheDocument();
  });

  it("shows the 'You' overlay on an empty category board, with total points in the caption", () => {
    const you: YourStanding = { rank: null, points: 20, category_count: 0 };
    render(<LeaderboardRows rows={[]} you={you} sort="notes" />);
    expect(screen.getByText("No contributors yet.")).toBeInTheDocument();
    expect(screen.getByText("Not yet ranked")).toBeInTheDocument();
    expect(screen.getByText(/20 pts/)).toBeInTheDocument(); // total points, not category points
  });

  it("shows a ranked 'You' overlay when the caller is not in the fetched rows", () => {
    const you: YourStanding = { rank: 42, points: 5, category_count: null };
    render(<LeaderboardRows rows={[row()]} you={you} sort="total" />);
    expect(screen.getByText("42")).toBeInTheDocument();
    expect(screen.getByText("You")).toBeInTheDocument();
  });

  it("does not show the overlay when the caller's row is already visible in the list", () => {
    const you: YourStanding = { rank: 1, points: 100, category_count: null };
    render(<LeaderboardRows rows={[row({ is_you: true })]} you={you} sort="total" />);
    expect(screen.queryByText("Not yet ranked")).toBeNull();
    expect(screen.getAllByText("You")).toHaveLength(1); // the in-list tag only
  });

  it("crowns only the rank-1 row (#146)", () => {
    render(
      <LeaderboardRows
        rows={[row({ rank: 1, display_name: "Alice" }), row({ rank: 2, display_name: "Bob" })]}
        you={null}
        sort="total"
      />,
    );
    expect(screen.getAllByRole("img", { name: "Category leader" })).toHaveLength(1);
  });

  it("renders decorative avatars and swaps failed images to initials", () => {
    const { container } = render(
      <LeaderboardRows
        rows={[row({ display_name: "Ada Lovelace", avatar_url: "https://example.com/ada.jpg" })]}
        you={null}
        sort="total"
      />,
    );
    const image = container.querySelector('img[src="https://example.com/ada.jpg"]');
    expect(image).toHaveAttribute("alt", "");
    fireEvent.error(image as HTMLImageElement);
    expect(screen.getByText("AL")).toHaveAttribute("aria-hidden", "true");
  });

  it("renders a fixed initials fallback when no avatar is available", () => {
    render(
      <LeaderboardRows
        rows={[row({ display_name: "Ada Lovelace", avatar_url: null })]}
        you={null}
        sort="total"
      />,
    );
    expect(screen.getByText("AL")).toHaveAttribute("aria-hidden", "true");
  });

  it("shows no current-user overlay for signed-out visitors (#147)", () => {
    render(<LeaderboardRows rows={[row()]} you={null} sort="total" />);
    expect(screen.queryByText("You")).toBeNull();
    expect(screen.queryByText("Not yet ranked")).toBeNull();
  });

  it("shows stable-id history links only for confirmed admin rows", () => {
    const adminRow: AdminContributorRow = {
      ...row(),
      user_id: "11111111-1111-1111-1111-111111111111",
    };
    const { rerender } = render(
      <LeaderboardRows rows={[adminRow]} you={null} sort="total" admin />,
    );
    expect(screen.getByRole("link", { name: "View history" })).toHaveAttribute(
      "href",
      "/admin/contributors/11111111-1111-1111-1111-111111111111",
    );
    rerender(<LeaderboardRows rows={[row()]} you={null} sort="total" />);
    expect(screen.queryByRole("link", { name: "View history" })).toBeNull();
  });

  it("reveals the overlay when the caller's in-list row scrolls out of view (#147)", () => {
    const you: YourStanding = { rank: 2, points: 50, category_count: null };
    render(
      <LeaderboardRows
        rows={[row({ rank: 1 }), row({ rank: 2, display_name: "Me", is_you: true })]}
        you={you}
        sort="total"
      />,
    );
    // The caller's real row is assumed on screen → only the in-list "You" tag.
    expect(screen.getAllByText("You")).toHaveLength(1);
    // Their row scrolls out of view → the sticky overlay appears (a second "You").
    emitIntersection(false);
    expect(screen.getAllByText("You")).toHaveLength(2);
    // Back into view → the overlay hides again.
    emitIntersection(true);
    expect(screen.getAllByText("You")).toHaveLength(1);
  });

  it("shows the overlay after switching to a board where the caller has no in-list row (#147)", () => {
    const you: YourStanding = { rank: 5, points: 30, category_count: null };
    const { rerender } = render(
      <LeaderboardRows
        rows={[row({ rank: 5, display_name: "Me", is_you: true })]}
        you={you}
        sort="total"
      />,
    );
    // In-list and assumed visible → no overlay.
    expect(screen.getAllByText("You")).toHaveLength(1);
    // Switch to a board where the caller ranks below the fetched rows (no is_you row). Even though
    // the previous board's row was "visible", the overlay must show because there is no in-list row.
    rerender(
      <LeaderboardRows rows={[row({ rank: 1, display_name: "Alice" })]} you={you} sort="ratings" />,
    );
    expect(screen.getByText("You")).toBeInTheDocument();
  });
});
