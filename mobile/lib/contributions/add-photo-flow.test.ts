import { describe, expect, it, vi } from "vitest";

import { flushRatingThenUpload, singleFlight } from "./add-photo-flow";

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

describe("singleFlight (#1)", () => {
  it("ignores a second call while the first is in flight", async () => {
    let resolve!: () => void;
    const action = vi.fn(() => new Promise<void>((r) => (resolve = r)));
    const guarded = singleFlight(action);

    const first = guarded();
    guarded(); // second tap during the flush — must be ignored
    expect(action).toHaveBeenCalledTimes(1);

    resolve();
    await first;
    expect(action).toHaveBeenCalledTimes(1);
  });

  it("allows a new call once the previous one settles", async () => {
    const action = vi.fn().mockResolvedValue(undefined);
    const guarded = singleFlight(action);
    await guarded();
    await guarded();
    expect(action).toHaveBeenCalledTimes(2);
  });

  it("clears the in-flight flag even when the action throws", async () => {
    const action = vi.fn().mockRejectedValueOnce(new Error("boom")).mockResolvedValue(undefined);
    const guarded = singleFlight(action);
    await expect(guarded()).rejects.toThrow("boom");
    await guarded(); // not stuck after the throw
    expect(action).toHaveBeenCalledTimes(2);
  });
});
