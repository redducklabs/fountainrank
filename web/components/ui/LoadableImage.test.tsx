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

  it("fills its parent by default (h-full w-full wrapper for the sized-parent pattern)", () => {
    const { container } = render(<LoadableImage src="/x.jpg" alt="x" />);
    const wrapper = container.querySelector("span.relative");
    expect(wrapper?.className).toMatch(/\bh-full\b/);
    expect(wrapper?.className).toMatch(/\bw-full\b/);
  });

  it("uses ONLY the explicit wrapperClassName size (no leftover w-full to stretch it)", () => {
    // The #257 regression: a baked-in `h-full w-full` won the Tailwind conflict against a caller's
    // `h-12 w-12`, stretching fixed-size thumbnails/avatars to full width. Explicit sizing must win.
    const { container } = render(
      <LoadableImage src="/x.jpg" alt="x" wrapperClassName="h-12 w-12 shrink-0 rounded-md" />,
    );
    const wrapper = container.querySelector("span.relative");
    expect(wrapper?.className).toMatch(/\bh-12\b/);
    expect(wrapper?.className).toMatch(/\bw-12\b/);
    expect(wrapper?.className).toMatch(/\bshrink-0\b/);
    expect(wrapper?.className).not.toMatch(/\bh-full\b/);
    expect(wrapper?.className).not.toMatch(/\bw-full\b/);
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
