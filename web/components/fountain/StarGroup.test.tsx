// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { StarGroup } from "./StarGroup";

afterEach(cleanup);

describe("StarGroup", () => {
  it("renders per-radio accessible names and reports the chosen star", () => {
    const onChange = vi.fn();
    render(<StarGroup id={7} name="Clarity" value={0} onChange={onChange} />);
    expect(screen.getByRole("radio", { name: /clarity: 1 star$/i })).toBeTruthy();
    fireEvent.click(screen.getByRole("radio", { name: /clarity: 4 stars/i }));
    expect(onChange).toHaveBeenCalledWith(4);
  });
  it("marks the current value checked", () => {
    render(<StarGroup id={7} name="Taste" value={3} onChange={() => {}} />);
    expect(screen.getByRole("radio", { name: /taste: 3 stars/i })).toHaveProperty("checked", true);
  });
});
