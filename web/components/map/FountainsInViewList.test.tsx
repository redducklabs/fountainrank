// @vitest-environment jsdom
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { FountainsInViewList } from "./FountainsInViewList";

const pins = [
  {
    id: "a",
    location: { latitude: 1, longitude: 2 },
    is_working: true,
    average_rating: 4.6,
    rating_count: 9,
    ranking_score: 4.5,
  },
  {
    id: "b",
    location: { latitude: 3, longitude: 4 },
    is_working: false,
    average_rating: 2.1,
    rating_count: 3,
    ranking_score: 2.0,
  },
] as any;

describe("FountainsInViewList", () => {
  it("renders one focusable button per fountain and opens on activate", () => {
    const onOpen = vi.fn();
    render(<FountainsInViewList pins={pins} onOpen={onOpen} />);
    const buttons = screen.getAllByRole("button");
    expect(buttons.length).toBe(2);
    buttons[0].focus();
    expect(buttons[0]).toHaveFocus();
    fireEvent.click(buttons[0]); // native <button> => keyboard-operable (Enter/Space)
    expect(onOpen).toHaveBeenCalledWith("a");
  });
  it("marks the active item", () => {
    render(<FountainsInViewList pins={pins} activeId="b" onOpen={() => {}} />);
    expect(screen.getByRole("button", { name: /out of order/i })).toHaveAttribute(
      "aria-current",
      "true",
    );
  });
});
