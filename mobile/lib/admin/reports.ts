import type { components } from "@fountainrank/api-client";

type ReportedContentOut = components["schemas"]["ReportedContentOut"];

/** The label for the hide/unhide toggle button, driven by the item's current
 *  `is_hidden` — mirrors the web/admin-fountain-detail pattern (`AdminControls`
 *  on `fountains/[id].tsx`) so the queue and the fountain detail read the same
 *  hidden-state affordance. Works for any reported content type. */
export function hideToggleLabel(item: Pick<ReportedContentOut, "is_hidden">): string {
  return item.is_hidden ? "Unhide" : "Hide";
}

/** The `is_hidden` value to PATCH when the hide/unhide button is pressed — the
 *  inverse of the item's current state. */
export function nextHiddenState(item: Pick<ReportedContentOut, "is_hidden">): boolean {
  return !item.is_hidden;
}

/** True once the reports queue query has resolved with zero rows — drives the
 *  "No pending reports" empty state (queue cleared, not an error/loading state). */
export function isQueueEmpty(items: ReportedContentOut[] | undefined): boolean {
  return (items?.length ?? 0) === 0;
}

/** Whether a reported content type offers a hard Delete in the moderation queue (#12):
 *  photos and fountains do; a note's removal is a Hide (no note hard-delete), so notes don't. */
export function contentSupportsDelete(contentType: string): boolean {
  return contentType === "photo" || contentType === "fountain";
}

/** Whether the pending-report badge (profile tab icon / avatar overlay) should render —
 *  never for an undefined/zero count (no empty badge, no "0"; style guide "Pending-report
 *  badge"). */
export function shouldShowBadge(pendingCount: number | undefined): boolean {
  return (pendingCount ?? 0) > 0;
}

/** Format a pending-report count for the badge glyph: the raw count for 1-9, "9+" above
 *  that — the badge never needs to fit more than two glyphs (style guide "Count
 *  formatting"). Mirrors `web/components/admin/ReportBadge.tsx`'s formatting exactly. */
export function formatBadgeCount(pendingCount: number): string {
  return pendingCount > 9 ? "9+" : String(pendingCount);
}
