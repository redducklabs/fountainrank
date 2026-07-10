// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

import { RatingDraftProvider, useRatingDraft } from "./RatingDraftContext";

afterEach(cleanup);

function Probe() {
  const { edits, setEdit, clear } = useRatingDraft();
  return (
    <div>
      <span data-testid="edits">{JSON.stringify(edits)}</span>
      <button type="button" onClick={() => setEdit(1, 5)}>
        set
      </button>
      <button type="button" onClick={() => clear()}>
        clear
      </button>
    </div>
  );
}

it("throws when used outside a provider", () => {
  const spy = vi.spyOn(console, "error").mockImplementation(() => {});
  expect(() => render(<Probe />)).toThrow(/RatingDraftProvider/);
  spy.mockRestore();
});

it("setEdit records a tap and clear resets the draft", () => {
  render(
    <RatingDraftProvider dimensions={[]}>
      <Probe />
    </RatingDraftProvider>,
  );
  expect(screen.getByTestId("edits")).toHaveTextContent("{}");
  fireEvent.click(screen.getByRole("button", { name: "set" }));
  expect(screen.getByTestId("edits")).toHaveTextContent('{"1":5}');
  fireEvent.click(screen.getByRole("button", { name: "clear" }));
  expect(screen.getByTestId("edits")).toHaveTextContent("{}");
});
