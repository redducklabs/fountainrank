// @vitest-environment jsdom
import { afterEach, expect, it } from "vitest";
import { cleanup, render } from "@testing-library/react";
import { Spinner } from "./Spinner";

afterEach(cleanup);

it("renders a decorative spinning svg that is hidden from assistive tech", () => {
  const { container } = render(<Spinner />);
  const svg = container.querySelector("svg");
  expect(svg).toBeInTheDocument();
  expect(svg).toHaveClass("animate-spin");
  expect(svg).toHaveAttribute("aria-hidden", "true");
});

it("has no accessible name (no <title>)", () => {
  const { container } = render(<Spinner />);
  expect(container.querySelector("svg title")).toBeNull();
});

it("applies a custom size className", () => {
  const { container } = render(<Spinner className="h-6 w-6" />);
  expect(container.querySelector("svg")).toHaveClass("h-6", "w-6");
});
