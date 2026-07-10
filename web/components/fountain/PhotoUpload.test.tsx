// @vitest-environment jsdom
import { useEffect } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

const { uploadPhoto, submitRating, refresh } = vi.hoisted(() => ({
  uploadPhoto: vi.fn(),
  submitRating: vi.fn(),
  refresh: vi.fn(),
}));
vi.mock("../../app/actions/contribute", () => ({ uploadPhoto, submitRating }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));

import { PhotoUpload } from "./PhotoUpload";
import { RatingDraftProvider, useRatingDraft } from "./RatingDraftContext";

type Dimension = { rating_type_id: number; name: string; your_rating: number | null };
const DIMS: Dimension[] = [{ rating_type_id: 1, name: "Clarity", your_rating: null }];

// Seeds a star edit into the draft context so PhotoUpload sees a dirty draft.
function SeedEdit({ ratingTypeId, value }: { ratingTypeId: number; value: number }) {
  const { setEdit } = useRatingDraft();
  useEffect(() => {
    setEdit(ratingTypeId, value);
  }, [ratingTypeId, value, setEdit]);
  return null;
}

function renderUpload(
  dimensions: Dimension[] = [],
  seed?: { ratingTypeId: number; value: number },
) {
  return render(
    <RatingDraftProvider dimensions={dimensions}>
      {seed ? <SeedEdit {...seed} /> : null}
      <PhotoUpload fountainId="fid" />
    </RatingDraftProvider>,
  );
}

function selectFile(input: HTMLInputElement, file: File) {
  Object.defineProperty(input, "files", { value: [file], configurable: true });
  fireEvent.change(input);
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("PhotoUpload", () => {
  it("calls uploadPhoto with a FormData carrying the selected file on change", async () => {
    uploadPhoto.mockResolvedValue({ ok: true });
    renderUpload();
    const input = screen.getByLabelText(/add a photo/i) as HTMLInputElement;
    const file = new File(["bytes"], "photo.jpg", { type: "image/jpeg" });
    selectFile(input, file);
    await waitFor(() => expect(uploadPhoto).toHaveBeenCalledTimes(1));
    const [fountainId, formData] = uploadPhoto.mock.calls[0];
    expect(fountainId).toBe("fid");
    expect(formData.get("file")).toBe(file);
  });

  it("does NOT submit a rating when the draft is clean", async () => {
    uploadPhoto.mockResolvedValue({ ok: true });
    renderUpload(DIMS); // no seeded edit -> clean
    selectFile(screen.getByLabelText(/add a photo/i) as HTMLInputElement, new File(["b"], "a.jpg"));
    await waitFor(() => expect(uploadPhoto).toHaveBeenCalledTimes(1));
    expect(submitRating).not.toHaveBeenCalled();
  });

  it("flushes a dirty rating BEFORE uploading (#1)", async () => {
    const order: string[] = [];
    submitRating.mockImplementation(async () => {
      order.push("rate");
      return { ok: true };
    });
    uploadPhoto.mockImplementation(async () => {
      order.push("upload");
      return { ok: true };
    });
    renderUpload(DIMS, { ratingTypeId: 1, value: 5 });
    selectFile(screen.getByLabelText(/add a photo/i) as HTMLInputElement, new File(["b"], "a.jpg"));
    await waitFor(() => expect(uploadPhoto).toHaveBeenCalledTimes(1));
    expect(submitRating).toHaveBeenCalledWith("fid", [{ rating_type_id: 1, stars: 5 }], undefined);
    expect(order).toEqual(["rate", "upload"]);
  });

  it("still uploads the photo when the rating is rejected as too_far (#1)", async () => {
    submitRating.mockResolvedValue({ ok: false, error: "too_far" });
    uploadPhoto.mockResolvedValue({ ok: true });
    renderUpload(DIMS, { ratingTypeId: 1, value: 5 });
    selectFile(screen.getByLabelText(/add a photo/i) as HTMLInputElement, new File(["b"], "a.jpg"));
    await waitFor(() => expect(uploadPhoto).toHaveBeenCalledTimes(1));
    await waitFor(() =>
      expect(screen.getByRole("status")).toHaveTextContent(/too far from this fountain/i),
    );
    expect(refresh).toHaveBeenCalled();
  });

  it("success shows a confirmation and refreshes the route", async () => {
    uploadPhoto.mockResolvedValue({ ok: true });
    renderUpload();
    selectFile(
      screen.getByLabelText(/add a photo/i) as HTMLInputElement,
      new File(["bytes"], "photo.jpg", { type: "image/jpeg" }),
    );
    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent(/photo uploaded/i));
    expect(refresh).toHaveBeenCalled();
  });

  it("maps photo_limit / rate_limited / file_invalid to friendly messages", async () => {
    renderUpload();
    const input = screen.getByLabelText(/add a photo/i) as HTMLInputElement;

    uploadPhoto.mockResolvedValueOnce({ ok: false, error: "photo_limit" });
    selectFile(input, new File(["bytes"], "a.jpg", { type: "image/jpeg" }));
    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent(/photo limit/i));

    uploadPhoto.mockResolvedValueOnce({ ok: false, error: "rate_limited" });
    selectFile(input, new File(["bytes"], "b.jpg", { type: "image/jpeg" }));
    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent(/doing that a lot/i));

    uploadPhoto.mockResolvedValueOnce({ ok: false, error: "file_invalid" });
    selectFile(input, new File(["bytes"], "c.jpg", { type: "image/jpeg" }));
    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent(/supported photo/i));
  });

  it("resets the input value after each attempt so re-selecting the same file re-fires", async () => {
    uploadPhoto.mockResolvedValue({ ok: true });
    renderUpload();
    const input = screen.getByLabelText(/add a photo/i) as HTMLInputElement;
    selectFile(input, new File(["bytes"], "photo.jpg", { type: "image/jpeg" }));
    await waitFor(() => expect(uploadPhoto).toHaveBeenCalledTimes(1));
    expect(input.value).toBe("");
  });
});
