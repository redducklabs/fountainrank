// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { components } from "@fountainrank/api-client";
import type { FountainDetail as Detail } from "../../lib/fountains";
import { FountainDetail } from "./FountainDetail";

const now = new Date("2026-06-22T12:00:00Z");
const base: Detail = {
  id: "a",
  location: { latitude: 1, longitude: 2 },
  is_working: true,
  comments: null,
  average_rating: 4.3,
  rating_count: 128,
  ranking_score: 4.1,
  created_at: "2026-06-01T00:00:00Z",
  last_rated_at: "2026-06-17T00:00:00Z",
  current_status: null,
  last_verified_at: null,
  placement_note: null,
  attributes: [],
  dimensions: [
    { rating_type_id: 1, name: "Clarity", average_rating: 4.6, vote_count: 96 },
    { rating_type_id: 4, name: "Appearance", average_rating: null, vote_count: 0 },
  ],
};

describe("FountainDetail", () => {
  it("working + overall + votes", () => {
    render(<FountainDetail detail={base} notes={[]} now={now} />);
    expect(screen.getByText("Working")).toBeInTheDocument();
    expect(screen.getByText("4.3")).toBeInTheDocument();
    expect(screen.getByText("128 ratings")).toBeInTheDocument();
  });
  it("out of order", () => {
    render(<FountainDetail detail={{ ...base, is_working: false }} notes={[]} now={now} />);
    expect(screen.getByText("Out of order")).toBeInTheDocument();
  });
  it("unrated overall + unrated dimension", () => {
    render(<FountainDetail detail={{ ...base, average_rating: null }} notes={[]} now={now} />);
    expect(screen.getAllByText("Not yet rated").length).toBeGreaterThan(0);
  });
  it("creator comment + caption only when present", () => {
    const { rerender } = render(<FountainDetail detail={base} notes={[]} now={now} />);
    expect(screen.queryByText("Cold and fast")).not.toBeInTheDocument();
    rerender(
      <FountainDetail detail={{ ...base, comments: "Cold and fast" }} notes={[]} now={now} />,
    );
    expect(screen.getByText("Cold and fast")).toBeInTheDocument();
    expect(screen.getByText("From the person who added this fountain")).toBeInTheDocument();
  });
  it("renders meta (added + last rated) and the Directions + Share actions", () => {
    render(<FountainDetail detail={base} notes={[]} now={now} />);
    expect(screen.getByText(/Added Jun 2026/)).toBeInTheDocument();
    expect(screen.getByText(/Last rated Jun 2026/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /directions/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /share/i })).toBeInTheDocument();
  });
  it("status chip reflects current_status (verified working) + relative trust", () => {
    render(
      <FountainDetail
        detail={{ ...base, current_status: "ok", last_verified_at: "2026-06-19T12:00:00Z" }}
        notes={[]}
        now={now}
      />,
    );
    expect(screen.getByText("Verified working")).toBeInTheDocument();
    expect(screen.getByText(/Last verified 3 days ago/)).toBeInTheDocument();
  });
  it("reported_issue keeps baseline chip + advisory (both baselines)", () => {
    const { rerender } = render(
      <FountainDetail
        detail={{ ...base, current_status: "reported_issue", is_working: true }}
        notes={[]}
        now={now}
      />,
    );
    expect(screen.getByText("Working")).toBeInTheDocument();
    expect(screen.getByText(/Issue reported recently/)).toBeInTheDocument();
    rerender(
      <FountainDetail
        detail={{ ...base, current_status: "reported_issue", is_working: false }}
        notes={[]}
        now={now}
      />,
    );
    expect(screen.getByText("Out of order")).toBeInTheDocument();
    expect(screen.getByText(/Issue reported recently/)).toBeInTheDocument();
  });
  it("placement note shown only when present", () => {
    const { rerender } = render(<FountainDetail detail={base} notes={[]} now={now} />);
    expect(screen.queryByText(/east entrance/)).not.toBeInTheDocument();
    rerender(
      <FountainDetail
        detail={{ ...base, placement_note: "Behind the playground, east entrance" }}
        notes={[]}
        now={now}
      />,
    );
    expect(screen.getByText(/east entrance/)).toBeInTheDocument();
  });
  it("renders grouped attributes incl. a mixed latest hint", () => {
    const attributes: components["schemas"]["AttributeConsensusOut"][] = [
      {
        attribute_type_id: 1,
        key: "bottle_filler",
        name: "Bottle filler",
        category: "physical",
        consensus_value: "yes",
        confidence: "high",
        yes_count: 3,
        no_count: 0,
        unknown_count: 0,
        value_counts: null,
        observation_count: 3,
        latest_observation_value: "yes",
      },
      {
        attribute_type_id: 2,
        key: "dual_height",
        name: "Dual height",
        category: "physical",
        consensus_value: null,
        confidence: "mixed",
        yes_count: 1,
        no_count: 1,
        unknown_count: 0,
        value_counts: null,
        observation_count: 2,
        latest_observation_value: "no",
      },
    ];
    render(<FountainDetail detail={{ ...base, attributes }} notes={[]} now={now} />);
    expect(screen.getByText("Features")).toBeInTheDocument();
    expect(screen.getByText("Bottle filler")).toBeInTheDocument();
    expect(screen.getByText("latest: No")).toBeInTheDocument();
  });
  it("renders community notes (author from author_display_name); omitted when empty", () => {
    const { rerender } = render(<FountainDetail detail={base} notes={[]} now={now} />);
    expect(screen.queryByText("Community notes")).not.toBeInTheDocument();
    rerender(
      <FountainDetail
        detail={base}
        notes={[
          {
            id: "n1",
            body: "Hidden tap on the north wall",
            author_display_name: "Sam",
            created_at: "2026-06-20T12:00:00Z",
            updated_at: "2026-06-20T12:00:00Z",
          },
        ]}
        now={now}
      />,
    );
    expect(screen.getByText("Community notes")).toBeInTheDocument();
    expect(screen.getByText("Hidden tap on the north wall")).toBeInTheDocument();
    expect(screen.getByText(/Sam/)).toBeInTheDocument();
  });
});
