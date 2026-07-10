type RatingResult = { ok: true } | { ok: false; error: string };

/**
 * Wrap an async action so a second invocation is IGNORED while the first is still running (#1). The
 * mobile "Add photo" flow submits the rating and fetches location before the upload mutation flips to
 * pending, so without this a second tap in that window could double-submit the rating and upload two
 * photos. The wrapper keeps one in-flight flag for the whole lifecycle (pick → coords → rating →
 * upload) and clears it in `finally`, so the next tap after it settles runs normally.
 */
export function singleFlight<A extends unknown[]>(
  action: (...args: A) => Promise<void>,
): (...args: A) => Promise<void> {
  let inFlight = false;
  return async (...args: A) => {
    if (inFlight) return;
    inFlight = true;
    try {
      await action(...args);
    } finally {
      inFlight = false;
    }
  };
}

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
