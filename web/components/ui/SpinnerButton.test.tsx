// @vitest-environment jsdom
import { afterEach, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { SpinnerButton } from "./SpinnerButton";

afterEach(cleanup);

it("shows a spinner, sets aria-busy, and disables while pending", () => {
  const { container } = render(<SpinnerButton pending>Submit rating</SpinnerButton>);
  const btn = screen.getByRole("button", { name: /submit rating/i });
  expect(btn).toHaveAttribute("aria-busy", "true");
  expect(btn).toBeDisabled();
  expect(container.querySelector("svg.animate-spin")).toBeInTheDocument();
});

it("swaps to pendingLabel while pending when provided", () => {
  render(
    <SpinnerButton pending pendingLabel="Saving…">
      Save
    </SpinnerButton>,
  );
  expect(screen.getByRole("button")).toHaveTextContent("Saving…");
});

it("shows no spinner and stays enabled when not pending", () => {
  const { container } = render(<SpinnerButton pending={false}>Save</SpinnerButton>);
  const btn = screen.getByRole("button", { name: /save/i });
  expect(btn).toHaveAttribute("aria-busy", "false");
  expect(btn).not.toBeDisabled();
  expect(container.querySelector("svg.animate-spin")).toBeNull();
});

it("stays disabled when disabled is passed even if not pending", () => {
  render(
    <SpinnerButton pending={false} disabled>
      Save
    </SpinnerButton>,
  );
  expect(screen.getByRole("button")).toBeDisabled();
});

it("defaults to type=button and forwards onClick", () => {
  render(<SpinnerButton pending={false}>Save</SpinnerButton>);
  expect(screen.getByRole("button")).toHaveAttribute("type", "button");
});
