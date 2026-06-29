// @vitest-environment jsdom
import { afterEach, describe, it, expect } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { Stars } from "./Stars";

afterEach(cleanup);

describe("Stars", () => {
  it("exposes an accessible rating label", () => {
    render(<Stars value={3.5} />);
    expect(screen.getByRole("img", { name: "Rated 3.5 out of 5" })).toBeInTheDocument();
  });
  it("renders five stars with the correct fills for 3.5", () => {
    const { container } = render(<Stars value={3.5} />);
    const fills = [...container.querySelectorAll("[data-fill]")].map((n) =>
      n.getAttribute("data-fill"),
    );
    expect(fills).toEqual(["full", "full", "full", "half", "empty"]);
  });
  it("supports a custom label", () => {
    render(<Stars value={4} label="Clarity rated 4 out of 5" />);
    expect(screen.getByRole("img", { name: "Clarity rated 4 out of 5" })).toBeInTheDocument();
  });
});
