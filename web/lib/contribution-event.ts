// The client-side "a contribution succeeded" signal. Carries the awarded point count when the
// dispatcher knows it, so the celebration can show "+N points" and the header can refresh (#2, #5).
export const CONTRIBUTION_EVENT = "fountainrank:contribution";

export type ContributionEventDetail = { points?: number };

/** Dispatch the contribution event. Pass `points` when known; omit when the award is unknown
 *  (e.g. photo upload, add-fountain) — listeners then render no number. */
export function dispatchContribution(points?: number): void {
  window.dispatchEvent(
    new CustomEvent<ContributionEventDetail>(CONTRIBUTION_EVENT, { detail: { points } }),
  );
}

/** Read the awarded points off a contribution event. Defensive: a bare `Event` (no `detail`) or a
 *  dispatch that omitted points yields `undefined`. */
export function contributionPoints(e: Event): number | undefined {
  return (e as CustomEvent<Partial<ContributionEventDetail>>).detail?.points;
}
