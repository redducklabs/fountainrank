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
  it("groups by category with friendly headers + positive chips", () => {
    const { container } = render(
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
    const variants = [...container.querySelectorAll("[data-variant]")].map((n) =>
      n.getAttribute("data-variant"),
    );
    expect(variants).toEqual(["positive", "positive"]);
  });
  it("renders a value attribute as a neutral 'name: value' chip", () => {
    const { container } = render(
      <AttributeList
        attributes={[
          attr({
            attribute_type_id: 3,
            name: "Venue type",
            category: "access",
            consensus_value: "park",
            latest_observation_value: "park",
          }),
        ]}
      />,
    );
    expect(screen.getByText("Venue type: Park")).toBeInTheDocument();
    expect(container.querySelector("[data-variant]")?.getAttribute("data-variant")).toBe("neutral");
  });
  it("low-confidence consensus renders as a muted chip with the value + report count", () => {
    const { container } = render(
      <AttributeList attributes={[attr({ confidence: "low", observation_count: 2 })]} />,
    );
    expect(container.querySelector("[data-variant]")?.getAttribute("data-variant")).toBe("muted");
    expect(screen.getByText("Bottle filler: Yes")).toBeInTheDocument();
    expect(screen.getByText("(2 reports)")).toBeInTheDocument();
  });
  it("mixed shows the latest hint as a mixed chip", () => {
    const { container } = render(
      <AttributeList
        attributes={[
          attr({ consensus_value: null, confidence: "mixed", latest_observation_value: "no" }),
        ]}
      />,
    );
    expect(container.querySelector("[data-variant]")?.getAttribute("data-variant")).toBe("mixed");
    expect(screen.getByText("latest: No")).toBeInTheDocument();
  });
});
