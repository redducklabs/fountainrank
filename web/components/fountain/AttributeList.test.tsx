// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import type { components } from "@fountainrank/api-client";
import { describe, expect, it } from "vitest";
import { AttributeList } from "./AttributeList";

type Attr = components["schemas"]["AttributeConsensusOut"];

const attr = (over: Partial<Attr> = {}): Attr => ({
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
  ...over,
});

describe("AttributeList", () => {
  it("returns null when empty", () => {
    const { container } = render(<AttributeList attributes={[]} />);
    expect(container.firstChild).toBeNull();
  });
  it("groups by category with friendly headers + values", () => {
    render(
      <AttributeList
        attributes={[
          attr(),
          attr({ attribute_type_id: 2, name: "Wheelchair reachable", category: "accessibility" }),
        ]}
      />,
    );
    expect(screen.getByText("Features")).toBeInTheDocument();
    expect(screen.getByText("Accessibility")).toBeInTheDocument();
    expect(screen.getByText("Bottle filler")).toBeInTheDocument();
    expect(screen.getByText("Wheelchair reachable")).toBeInTheDocument();
    expect(screen.getAllByText("Yes").length).toBe(2);
  });
  it("mixed shows the latest hint", () => {
    render(
      <AttributeList
        attributes={[
          attr({ consensus_value: null, confidence: "mixed", latest_observation_value: "no" }),
        ]}
      />,
    );
    expect(screen.getByText("Mixed")).toBeInTheDocument();
    expect(screen.getByText("latest: No")).toBeInTheDocument();
  });
});
