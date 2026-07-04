// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { FountainListRow } from "./FountainListRow";
import type { FountainPin } from "../../lib/fountains";

const base: FountainPin = {
  id: "f1",
  location: { latitude: 37.77, longitude: -122.42 },
  is_working: true,
  rating_count: 3,
  average_rating: 4.5,
};

afterEach(cleanup);

describe("FountainListRow", () => {
  it("renders stars, count, and a See on Map link for a rated fountain", () => {
    render(<FountainListRow fountain={base} />);
    expect(screen.getByRole("img", { name: /Rated 4.5 out of 5/ })).toBeDefined();
    expect(screen.getByText(/3 ratings/)).toBeDefined();
    expect(screen.getByRole("link", { name: /See on Map/i }).getAttribute("href")).toBe(
      "/?flyto=-122.42,37.77&focus=f1",
    );
  });

  it("shows 'Not yet rated' and no stars when unrated", () => {
    render(<FountainListRow fountain={{ ...base, average_rating: null, rating_count: 0 }} />);
    expect(screen.getByText(/Not yet rated/i)).toBeDefined();
    expect(screen.queryByRole("img")).toBeNull();
  });
});
