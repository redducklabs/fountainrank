type RatingResult = { ok: true } | { ok: false; error: string };

/**
 * "Add photo" flushes an unsaved rating first, then uploads — but the rating NEVER blocks the upload
 * (#1, spec §4.1). Photos are not distance-gated, so even a rating rejected by the proximity guard
 * (`too_far`) must not stop the photo. The two contributions are independent: the rating is attempted
 * first only so a photo failure can't lose it, and its outcome is reported back for the caller to
 * clear/retain the draft.
 */
export async function flushRatingThenUpload({
  isDirty,
  submitRating,
  uploadPhoto,
}: {
  isDirty: boolean;
  submitRating: () => Promise<RatingResult>;
  uploadPhoto: () => Promise<void>;
}): Promise<{ ratingOutcome: "skipped" | "ok" | "failed"; uploaded: boolean }> {
  let ratingOutcome: "skipped" | "ok" | "failed" = "skipped";
  if (isDirty) {
    const res = await submitRating();
    ratingOutcome = res.ok ? "ok" : "failed";
  }
  await uploadPhoto();
  return { ratingOutcome, uploaded: true };
}
