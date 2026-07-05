// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { PhotoCarousel } from "./PhotoCarousel";
import type { PhotoOut } from "../../lib/fountains";

afterEach(cleanup);

function makePhoto(overrides: Partial<PhotoOut> = {}): PhotoOut {
  const id = overrides.id ?? "p1";
  return {
    id,
    url: `/api/v1/photos/${id}`,
    thumbnail_url: `/api/v1/photos/${id}/thumb`,
    width: 800,
    height: 600,
    uploaded_by: "user-1",
    created_at: "2026-07-01T00:00:00Z",
    ...overrides,
  };
}

describe("PhotoCarousel", () => {
  it("renders nothing for an empty photo list", () => {
    const { container } = render(<PhotoCarousel photos={[]} />);
    expect(container).toBeEmptyDOMElement();
  });

  // The photo `<img>` is intentionally decorative (`alt=""` per docs/style-guide.md) — the
  // meaningful content is the fountain, not the image — so it has no accessible "img" role;
  // query it directly rather than via getByRole.
  function currentImg(container: HTMLElement): HTMLImageElement {
    return container.querySelector("img") as HTMLImageElement;
  }

  it("renders the first photo's image", () => {
    const photos = [makePhoto({ id: "p1" }), makePhoto({ id: "p2" })];
    const { container } = render(<PhotoCarousel photos={photos} />);
    expect(currentImg(container).src).toContain("/api/v1/photos/p1");
  });

  it("navigates with the next/prev buttons and wraps at the ends", () => {
    const photos = [makePhoto({ id: "p1" }), makePhoto({ id: "p2" }), makePhoto({ id: "p3" })];
    const { container } = render(<PhotoCarousel photos={photos} />);

    const next = screen.getByRole("button", { name: "Next photo" });
    const prev = screen.getByRole("button", { name: "Previous photo" });

    fireEvent.click(next);
    expect(currentImg(container).src).toContain("/api/v1/photos/p2");

    fireEvent.click(next);
    expect(currentImg(container).src).toContain("/api/v1/photos/p3");

    // wraps forward past the last photo back to the first
    fireEvent.click(next);
    expect(currentImg(container).src).toContain("/api/v1/photos/p1");

    // wraps backward past the first photo to the last
    fireEvent.click(prev);
    expect(currentImg(container).src).toContain("/api/v1/photos/p3");
  });

  it("navigates with ArrowLeft/ArrowRight keys", () => {
    const photos = [makePhoto({ id: "p1" }), makePhoto({ id: "p2" })];
    const { container } = render(<PhotoCarousel photos={photos} />);

    fireEvent.keyDown(window, { key: "ArrowRight" });
    expect(currentImg(container).src).toContain("/api/v1/photos/p2");

    fireEvent.keyDown(window, { key: "ArrowLeft" });
    expect(currentImg(container).src).toContain("/api/v1/photos/p1");
  });

  it("has accessible aria-labels on the arrow buttons", () => {
    const photos = [makePhoto({ id: "p1" }), makePhoto({ id: "p2" })];
    render(<PhotoCarousel photos={photos} />);
    expect(screen.getByRole("button", { name: "Previous photo" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Next photo" })).toBeInTheDocument();
  });

  it("shows a dot indicator per photo", () => {
    const photos = [makePhoto({ id: "p1" }), makePhoto({ id: "p2" }), makePhoto({ id: "p3" })];
    const { container } = render(<PhotoCarousel photos={photos} />);
    expect(container.querySelectorAll("[data-dot]").length).toBe(3);
  });

  it("calls onReport with the current photo when the report control is clicked", () => {
    const onReport = vi.fn();
    const photos = [makePhoto({ id: "p1" }), makePhoto({ id: "p2" })];
    render(<PhotoCarousel photos={photos} onReport={onReport} />);
    fireEvent.click(screen.getByRole("button", { name: /report/i }));
    expect(onReport).toHaveBeenCalledWith(photos[0]);
  });

  it("does not render a report control when onReport is not provided", () => {
    const photos = [makePhoto({ id: "p1" })];
    render(<PhotoCarousel photos={photos} />);
    expect(screen.queryByRole("button", { name: /report/i })).toBeNull();
  });

  it("renders a delete button only when isOwner is true, and calls onDelete", () => {
    const onDelete = vi.fn();
    const photos = [makePhoto({ id: "p1" }), makePhoto({ id: "p2" })];
    const { rerender } = render(
      <PhotoCarousel photos={photos} isOwner onDelete={onDelete} />,
    );
    fireEvent.click(screen.getByRole("button", { name: /delete/i }));
    expect(onDelete).toHaveBeenCalledWith(photos[0]);

    rerender(<PhotoCarousel photos={photos} onDelete={onDelete} />);
    expect(screen.queryByRole("button", { name: /delete/i })).toBeNull();
  });
});
