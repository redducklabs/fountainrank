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
    is_own: false,
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

  it("renders a delete button only when the current photo is_own is true, and calls onDelete", () => {
    const onDelete = vi.fn();
    const photos = [makePhoto({ id: "p1", is_own: true }), makePhoto({ id: "p2", is_own: false })];
    render(<PhotoCarousel photos={photos} onDelete={onDelete} />);
    fireEvent.click(screen.getByRole("button", { name: /delete/i }));
    expect(onDelete).toHaveBeenCalledWith(photos[0]);
  });

  it("hides the delete button once navigating to a photo the viewer doesn't own", () => {
    const onDelete = vi.fn();
    const photos = [makePhoto({ id: "p1", is_own: true }), makePhoto({ id: "p2", is_own: false })];
    render(<PhotoCarousel photos={photos} onDelete={onDelete} />);
    expect(screen.getByRole("button", { name: /delete/i })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Next photo" }));
    expect(screen.queryByRole("button", { name: /delete/i })).toBeNull();
  });

  it("never renders a delete button when onDelete is not provided, even for an is_own photo", () => {
    const photos = [makePhoto({ id: "p1", is_own: true })];
    render(<PhotoCarousel photos={photos} />);
    expect(screen.queryByRole("button", { name: /delete/i })).toBeNull();
  });

  // Regression: after a `router.refresh()` (e.g. following an owner delete or an admin
  // hide), Next.js re-renders this client component with a shorter `photos` prop while
  // preserving its existing `index` state. If `index` still pointed at the old last photo,
  // `photos[index]` used to be `undefined` and the render crashed dereferencing
  // `current.url`/`current.is_own`.
  it("does not crash and clamps to the last photo when photos shrinks while on the last photo", () => {
    const onDelete = vi.fn();
    const onReport = vi.fn();
    const photos = [
      makePhoto({ id: "p1", is_own: false }),
      makePhoto({ id: "p2", is_own: false }),
      makePhoto({ id: "p3", is_own: true }),
    ];
    const { container, rerender } = render(
      <PhotoCarousel photos={photos} onDelete={onDelete} onReport={onReport} />,
    );

    // Navigate to the last photo (p3), which is the one about to be "deleted".
    const next = screen.getByRole("button", { name: "Next photo" });
    fireEvent.click(next);
    fireEvent.click(next);
    expect(currentImg(container).src).toContain("/api/v1/photos/p3");

    // Simulate the owner deleting p3 and router.refresh() handing back a shorter list,
    // with p2 now is_own so the delete gating can be observed on the new current photo.
    const shrunk = [
      makePhoto({ id: "p1", is_own: false }),
      makePhoto({ id: "p2", is_own: true }),
    ];
    expect(() => rerender(<PhotoCarousel photos={shrunk} onDelete={onDelete} onReport={onReport} />)).not.toThrow();

    // Clamped to the new last photo (p2) rather than crashing on the stale index.
    expect(currentImg(container).src).toContain("/api/v1/photos/p2");
    expect(container.querySelectorAll("[data-dot]").length).toBe(2);

    fireEvent.click(screen.getByRole("button", { name: /delete/i }));
    expect(onDelete).toHaveBeenCalledWith(shrunk[1]);

    // Subsequent navigation still works correctly against the clamped, now-persisted state.
    fireEvent.click(screen.getByRole("button", { name: "Next photo" }));
    expect(currentImg(container).src).toContain("/api/v1/photos/p1");
  });

  it("does not crash and clamps to index 0 when photos shrinks to a single photo", () => {
    const onDelete = vi.fn();
    const photos = [
      makePhoto({ id: "p1", is_own: false }),
      makePhoto({ id: "p2", is_own: false }),
      makePhoto({ id: "p3", is_own: true }),
    ];
    const { container, rerender } = render(<PhotoCarousel photos={photos} onDelete={onDelete} />);

    const next = screen.getByRole("button", { name: "Next photo" });
    fireEvent.click(next);
    fireEvent.click(next);
    expect(currentImg(container).src).toContain("/api/v1/photos/p3");

    const shrunk = [makePhoto({ id: "p1", is_own: true })];
    expect(() => rerender(<PhotoCarousel photos={shrunk} onDelete={onDelete} />)).not.toThrow();

    expect(currentImg(container).src).toContain("/api/v1/photos/p1");
    // A single photo hides the nav/dots entirely.
    expect(screen.queryByRole("button", { name: "Next photo" })).toBeNull();
    expect(container.querySelectorAll("[data-dot]").length).toBe(0);

    fireEvent.click(screen.getByRole("button", { name: /delete/i }));
    expect(onDelete).toHaveBeenCalledWith(shrunk[0]);
  });
});
