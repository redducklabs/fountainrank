import { describe, expect, it, vi } from "vitest";

import { flushRatingThenUpload } from "./add-photo-flow";

describe("flushRatingThenUpload (#1)", () => {
  it("clean draft: rating skipped, photo uploaded", async () => {
    const submitRating = vi.fn();
    const uploadPhoto = vi.fn().mockResolvedValue(undefined);
    const r = await flushRatingThenUpload({ isDirty: false, submitRating, uploadPhoto });
    expect(submitRating).not.toHaveBeenCalled();
    expect(uploadPhoto).toHaveBeenCalledOnce();
    expect(r).toEqual({ ratingOutcome: "skipped", uploaded: true });
  });

  it("dirty draft: rating submitted BEFORE upload; both happen", async () => {
    const order: string[] = [];
    const submitRating = vi.fn(async () => {
      order.push("rate");
      return { ok: true as const };
    });
    const uploadPhoto = vi.fn(async () => {
      order.push("upload");
    });
    const r = await flushRatingThenUpload({ isDirty: true, submitRating, uploadPhoto });
    expect(order).toEqual(["rate", "upload"]);
    expect(r).toEqual({ ratingOutcome: "ok", uploaded: true });
  });

  it("rating fails (e.g. too_far): photo STILL uploads", async () => {
    const submitRating = vi.fn(async () => ({ ok: false as const, error: "too_far" }));
    const uploadPhoto = vi.fn().mockResolvedValue(undefined);
    const r = await flushRatingThenUpload({ isDirty: true, submitRating, uploadPhoto });
    expect(uploadPhoto).toHaveBeenCalledOnce();
    expect(r).toEqual({ ratingOutcome: "failed", uploaded: true });
  });
});
