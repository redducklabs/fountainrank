import type { components } from "@fountainrank/api-client";

type ReportedPhotoOut = components["schemas"]["ReportedPhotoOut"];

/** The label for the hide/unhide toggle button, driven by the photo's current
 *  `is_hidden` — mirrors the web/admin-fountain-detail pattern (`AdminControls`
 *  on `fountains/[id].tsx`) so the queue and the fountain detail read the same
 *  hidden-state affordance. */
export function hideToggleLabel(photo: Pick<ReportedPhotoOut, "is_hidden">): string {
  return photo.is_hidden ? "Unhide" : "Hide";
}

/** The `is_hidden` value to PATCH when the hide/unhide button is pressed — the
 *  inverse of the photo's current state. */
export function nextHiddenState(photo: Pick<ReportedPhotoOut, "is_hidden">): boolean {
  return !photo.is_hidden;
}

/** True once the reports queue query has resolved with zero rows — drives the
 *  "No pending reports" empty state (queue cleared, not an error/loading state). */
export function isQueueEmpty(photos: ReportedPhotoOut[] | undefined): boolean {
  return (photos?.length ?? 0) === 0;
}
