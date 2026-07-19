// @vitest-environment jsdom
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { LoadableImage } from "./LoadableImage";

describe("LoadableImage", () => {
  it("moves from reserved skeleton to visible image on load", () => {
    const { container } = render(<LoadableImage src="/photo.jpg" alt="Fountain" />);
    const image = screen.getByAltText("Fountain");
    expect(image).toHaveClass("opacity-0");
    fireEvent.load(image);
    expect(image).toHaveClass("opacity-100");
    expect(container.querySelector(".animate-pulse")).toBeNull();
  });

  it("shows an accessible fallback on error", () => {
    render(<LoadableImage src="/broken.jpg" alt="Fountain photo" />);
    fireEvent.error(screen.getByAltText("Fountain photo"));
    expect(screen.getByRole("img", { name: "Fountain photo" })).toHaveTextContent(
      "Image unavailable",
    );
  });

  it("recognizes an already-complete cached image from the callback ref", () => {
    const originalComplete = Object.getOwnPropertyDescriptor(
      HTMLImageElement.prototype,
      "complete",
    );
    const originalNaturalWidth = Object.getOwnPropertyDescriptor(
      HTMLImageElement.prototype,
      "naturalWidth",
    );
    Object.defineProperty(HTMLImageElement.prototype, "complete", {
      configurable: true,
      get: () => true,
    });
    Object.defineProperty(HTMLImageElement.prototype, "naturalWidth", {
      configurable: true,
      get: () => 64,
    });
    const { getByAltText } = render(<LoadableImage src="/cached.jpg" alt="Cached" />);
    expect(getByAltText("Cached")).toHaveClass("opacity-100");
    if (originalComplete)
      Object.defineProperty(HTMLImageElement.prototype, "complete", originalComplete);
    if (originalNaturalWidth)
      Object.defineProperty(HTMLImageElement.prototype, "naturalWidth", originalNaturalWidth);
  });
});
