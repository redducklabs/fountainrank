// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { FountainDetail } from "./FountainDetail";
const base = {
  id: "a",
  location: { latitude: 1, longitude: 2 },
  is_working: true,
  comments: null,
  average_rating: 4.3,
  rating_count: 128,
  ranking_score: 4.1,
  created_at: "2026-06-01T00:00:00Z",
  last_rated_at: "2026-06-17T00:00:00Z",
  dimensions: [
    { rating_type_id: 1, name: "Clarity", average_rating: 4.6, vote_count: 96 },
    { rating_type_id: 4, name: "Appearance", average_rating: null, vote_count: 0 },
  ],
} as any;
describe("FountainDetail", () => {
  it("working + overall + votes", () => {
    render(<FountainDetail detail={base} />);
    expect(screen.getByText("Working")).toBeInTheDocument();
    expect(screen.getByText("4.3")).toBeInTheDocument();
    expect(screen.getByText("128 ratings")).toBeInTheDocument();
  });
  it("out of order", () => {
    render(<FountainDetail detail={{ ...base, is_working: false }} />);
    expect(screen.getByText("Out of order")).toBeInTheDocument();
  });
  it("unrated overall + unrated dimension", () => {
    render(<FountainDetail detail={{ ...base, average_rating: null }} />);
    expect(screen.getAllByText("Not yet rated").length).toBeGreaterThan(0);
  });
  it("note only when present", () => {
    const { rerender } = render(<FountainDetail detail={base} />);
    expect(screen.queryByText("Cold and fast")).not.toBeInTheDocument();
    rerender(<FountainDetail detail={{ ...base, comments: "Cold and fast" }} />);
    expect(screen.getByText("Cold and fast")).toBeInTheDocument();
  });
  it("renders meta (added + last rated) and the Directions + Share actions", () => {
    render(<FountainDetail detail={base} />);
    expect(screen.getByText(/Added Jun 2026/)).toBeInTheDocument();
    expect(screen.getByText(/Last rated Jun 2026/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /directions/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /share/i })).toBeInTheDocument();
  });
});
