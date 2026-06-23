// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { RatingFields } from "./RatingFields";

afterEach(cleanup);

describe("RatingFields", () => {
  it("maps RatingTypeOut.id to the onChange id", () => {
    const onChange = vi.fn();
    render(
      <RatingFields
        types={[{ id: 11, name: "Coldness", description: "", sort_order: 0 }]}
        value={{}}
        onChange={onChange}
      />,
    );
    fireEvent.click(screen.getByRole("radio", { name: /coldness: 5 stars/i }));
    expect(onChange).toHaveBeenCalledWith(11, 5);
  });

  it("renders nothing when types array is empty", () => {
    const { container } = render(<RatingFields types={[]} value={{}} onChange={vi.fn()} />);
    expect(container.firstChild).toBeNull();
  });
});
