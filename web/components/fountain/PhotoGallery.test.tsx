// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { PhotoOut } from "../../lib/fountains";

const { deleteOwnPhoto, refresh } = vi.hoisted(() => ({
  deleteOwnPhoto: vi.fn(),
  refresh: vi.fn(),
}));
vi.mock("../../app/actions/contribute", () => ({ deleteOwnPhoto }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));

import { PhotoGallery } from "./PhotoGallery";

function makePhoto(overrides: Partial<PhotoOut> = {}): PhotoOut {
  const id = overrides.id ?? "p1";
  return {
    id,
    url: `/api/v1/photos/${id}`,
    thumbnail_url: `/api/v1/photos/${id}/thumb`,
    width: 800,
    height: 600,
    uploaded_by: "Sam",
    created_at: "2026-07-01T00:00:00Z",
    is_own: false,
    ...overrides,
  };
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("PhotoGallery", () => {
  it("renders nothing for an empty photo list", () => {
    const { container } = render(
      <PhotoGallery fountainId="fid" photos={[]} isAuthenticated={false} />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it("no report/delete affordances for a signed-out viewer", () => {
    render(<PhotoGallery fountainId="fid" photos={[makePhoto()]} isAuthenticated={false} />);
    expect(screen.queryByRole("button", { name: /report/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /delete/i })).not.toBeInTheDocument();
  });

  it("signed-in non-owner sees Report but not Delete", () => {
    render(
      <PhotoGallery
        fountainId="fid"
        photos={[makePhoto({ uploaded_by: "Someone Else", is_own: false })]}
        isAuthenticated={true}
      />,
    );
    expect(screen.getByRole("button", { name: /report this photo/i })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /delete this photo/i })).not.toBeInTheDocument();
  });

  it("signed-in owner (is_own) sees Delete and it calls deleteOwnPhoto", async () => {
    vi.spyOn(window, "confirm").mockReturnValue(true);
    deleteOwnPhoto.mockResolvedValue({ ok: true });
    render(
      <PhotoGallery
        fountainId="fid"
        photos={[makePhoto({ id: "p1", uploaded_by: "Sam", is_own: true })]}
        isAuthenticated={true}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /delete this photo/i }));
    await waitFor(() => expect(deleteOwnPhoto).toHaveBeenCalledWith("fid", "p1"));
    await waitFor(() => expect(refresh).toHaveBeenCalled());
  });

  it("does not show Delete for a non-own photo even when another photo in the gallery is_own", () => {
    render(
      <PhotoGallery
        fountainId="fid"
        photos={[makePhoto({ id: "p1", uploaded_by: "Someone Else", is_own: false })]}
        isAuthenticated={true}
      />,
    );
    expect(screen.queryByRole("button", { name: /delete this photo/i })).not.toBeInTheDocument();
  });

  it("clicking Report opens the dialog for that photo", () => {
    render(
      <PhotoGallery fountainId="fid" photos={[makePhoto({ id: "p1" })]} isAuthenticated={true} />,
    );
    fireEvent.click(screen.getByRole("button", { name: /report this photo/i }));
    expect(screen.getByRole("dialog", { name: /report photo/i })).toBeInTheDocument();
  });
});
