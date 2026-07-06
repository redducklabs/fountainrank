import type { components } from "@fountainrank/api-client";

import { unwrap, type MobileApiClient } from "../api";

/** The polymorphic content kinds a signed-in user can report (#11, spec §7). */
export type ReportContentType = "photo" | "note" | "fountain";

type ReportContentRequest = components["schemas"]["ReportContentRequest"];

export type ReportCategoryOption = { value: string; label: string };

/**
 * The per-content-type report reason subsets (spec §6). The backend chokepoint
 * (`app/reports.py`) is the authority and 422s a category outside the type's set;
 * the UI offers exactly the allowed subset. First entry is the default selection.
 */
export const REPORT_CATEGORIES: Record<ReportContentType, readonly ReportCategoryOption[]> = {
  photo: [
    { value: "inappropriate", label: "Inappropriate" },
    { value: "not_a_fountain", label: "Not a fountain" },
    { value: "spam", label: "Spam" },
    { value: "other", label: "Other" },
  ],
  note: [
    { value: "spam", label: "Spam" },
    { value: "abuse", label: "Abuse" },
    { value: "inappropriate", label: "Inappropriate" },
    { value: "inaccurate", label: "Inaccurate" },
    { value: "other", label: "Other" },
  ],
  fountain: [
    { value: "not_a_fountain", label: "Not a fountain" },
    { value: "spam", label: "Spam" },
    { value: "inappropriate", label: "Inappropriate" },
    { value: "inaccurate", label: "Inaccurate" },
    { value: "other", label: "Other" },
  ],
};

/** The modal title / success-toast noun for each content type. */
export const REPORT_CONTENT_NOUN: Record<ReportContentType, string> = {
  photo: "photo",
  note: "note",
  fountain: "fountain",
};

export type ReportContentArgs = {
  contentType: ReportContentType;
  fountainId: string;
  /** The reported row's id. For a fountain report this equals `fountainId`. */
  contentId: string;
  category: string;
  note: string | undefined;
};

/**
 * POST a content report to the matching nested endpoint (spec §7), generalizing the
 * former inline photo-report call. `unwrap` throws `ApiError(status)` on an HTTP error
 * (401/404/422/429/…) so the caller can map it via `mapContributionError`, exactly like
 * the other detail mutations. A 204 (including the idempotent duplicate no-op) resolves
 * to `void`. An omitted `note` is left off the JSON body (absent == null for the backend).
 */
export async function reportContent(
  client: Pick<MobileApiClient, "POST">,
  { contentType, fountainId, contentId, category, note }: ReportContentArgs,
): Promise<void> {
  const body: ReportContentRequest = { category, note };
  switch (contentType) {
    case "photo":
      unwrap(
        await client.POST("/api/v1/fountains/{fountain_id}/photos/{photo_id}/report", {
          params: { path: { fountain_id: fountainId, photo_id: contentId } },
          body,
        }),
      );
      return;
    case "note":
      unwrap(
        await client.POST("/api/v1/fountains/{fountain_id}/notes/{note_id}/report", {
          params: { path: { fountain_id: fountainId, note_id: contentId } },
          body,
        }),
      );
      return;
    case "fountain":
      unwrap(
        await client.POST("/api/v1/fountains/{fountain_id}/report", {
          params: { path: { fountain_id: fountainId } },
          body,
        }),
      );
      return;
  }
}
