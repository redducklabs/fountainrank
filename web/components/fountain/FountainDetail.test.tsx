// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { components } from "@fountainrank/api-client";
import type { FountainDetail as Detail } from "../../lib/fountains";
import { FountainDetail } from "./FountainDetail";

vi.mock("./ContributeSection", () => ({
  ContributeSection: ({
    isAuthenticated,
    variant,
  }: {
    isAuthenticated: boolean;
    variant?: string;
  }) => (
    <div data-testid="contribute-section" data-variant={variant}>
      {isAuthenticated ? "authed" : "anon"}
    </div>
  ),
}));
vi.mock("./PhotoGallery", () => ({
  PhotoGallery: () => <div data-testid="photo-gallery" />,
}));

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
  it("renders the prominent Info, Details, and Photos tabs", () => {
    render(<FountainDetail detail={base} notes={[]} now={now} isAuthenticated={false} />);
    expect(screen.getByRole("tab", { name: "Info" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("tab", { name: "Details" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Photos" })).toBeInTheDocument();
  });
  it("working + overall + votes (graphical hero + dimension stars)", () => {
    render(<FountainDetail detail={base} notes={[]} now={now} isAuthenticated={false} />);
    expect(screen.getByText("Working")).toBeInTheDocument();
    expect(screen.getByText("4.3")).toBeInTheDocument();
    expect(screen.getByText("128 ratings")).toBeInTheDocument();
    // graphical: hero star row + per-dimension star row, numbers preserved
    expect(screen.getByRole("img", { name: "Rated 4.3 out of 5" })).toBeInTheDocument();
    expect(screen.getByRole("img", { name: "Clarity rated 4.6 out of 5" })).toBeInTheDocument();
    expect(screen.getByText("Clarity")).toBeInTheDocument();
    expect(screen.getByText("4.6")).toBeInTheDocument();
  });
  it("out of order", () => {
    render(
      <FountainDetail
        detail={{ ...base, is_working: false }}
        notes={[]}
        now={now}
        isAuthenticated={false}
      />,
    );
    expect(screen.getByText("Out of order")).toBeInTheDocument();
  });
  it("unrated overall + unrated dimension", () => {
    render(
      <FountainDetail
        detail={{ ...base, average_rating: null }}
        notes={[]}
        now={now}
        isAuthenticated={false}
      />,
    );
    expect(screen.getAllByText("Not yet rated").length).toBeGreaterThan(0);
  });
  it("creator comment + caption only when present", () => {
    const { rerender } = render(
      <FountainDetail detail={base} notes={[]} now={now} isAuthenticated={false} />,
    );
    expect(screen.queryByText("Cold and fast")).not.toBeInTheDocument();
    rerender(
      <FountainDetail
        detail={{ ...base, comments: "Cold and fast" }}
        notes={[]}
        now={now}
        isAuthenticated={false}
      />,
    );
    expect(screen.getByText("Cold and fast")).toBeInTheDocument();
    expect(screen.getByText("From the person who added this fountain")).toBeInTheDocument();
  });
  it("renders meta (added + last rated) and the Directions + Share actions", () => {
    render(<FountainDetail detail={base} notes={[]} now={now} isAuthenticated={false} />);
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
        isAuthenticated={false}
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
        isAuthenticated={false}
      />,
    );
    expect(screen.getByText("Working")).toBeInTheDocument();
    expect(screen.getByText(/Issue reported recently/)).toBeInTheDocument();
    rerender(
      <FountainDetail
        detail={{ ...base, current_status: "reported_issue", is_working: false }}
        notes={[]}
        now={now}
        isAuthenticated={false}
      />,
    );
    expect(screen.getByText("Out of order")).toBeInTheDocument();
    expect(screen.getByText(/Issue reported recently/)).toBeInTheDocument();
  });
  it("uses legacy placement note as comment fallback", () => {
    const { rerender } = render(
      <FountainDetail detail={base} notes={[]} now={now} isAuthenticated={false} />,
    );
    expect(screen.queryByText(/east entrance/)).not.toBeInTheDocument();
    rerender(
      <FountainDetail
        detail={{ ...base, placement_note: "Behind the playground, east entrance" }}
        notes={[]}
        now={now}
        isAuthenticated={false}
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
    render(
      <FountainDetail
        detail={{ ...base, attributes }}
        notes={[]}
        now={now}
        isAuthenticated={false}
      />,
    );
    expect(screen.getByText("Features")).toBeInTheDocument();
    expect(screen.getByText("Bottle filler")).toBeInTheDocument();
    expect(screen.getByText("latest: No")).toBeInTheDocument();
  });
  it("renders community notes (author from author_display_name); omitted when empty", () => {
    const { rerender } = render(
      <FountainDetail detail={base} notes={[]} now={now} isAuthenticated={false} />,
    );
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
        isAuthenticated={false}
      />,
    );
    expect(screen.getByText("Community notes")).toBeInTheDocument();
    expect(screen.getByText("Hidden tap on the north wall")).toBeInTheDocument();
    expect(screen.getByText(/Sam/)).toBeInTheDocument();
  });
  it("signed-out: renders contribute section as anon", () => {
    render(<FountainDetail detail={base} notes={[]} now={now} isAuthenticated={false} />);
    const sections = screen.getAllByTestId("contribute-section");
    expect(sections).toHaveLength(3);
    expect(sections.map((section) => section.getAttribute("data-variant"))).toEqual([
      "primary",
      "details",
      "photos",
    ]);
    sections.forEach((section) => expect(section).toHaveTextContent("anon"));
  });
  it("signed-in: renders contribute section as authed", () => {
    render(<FountainDetail detail={base} notes={[]} now={now} isAuthenticated={true} />);
    screen
      .getAllByTestId("contribute-section")
      .forEach((section) => expect(section).toHaveTextContent("authed"));
  });
});
