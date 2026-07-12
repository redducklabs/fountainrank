import type { AwardedPoints } from "@fountainrank/contributions";

// The client-side "a contribution succeeded" signal. Carries the points the SERVER actually
// awarded (#204), so a listener can celebrate only a real award.
export const CONTRIBUTION_EVENT = "fountainrank:contribution";

export type ContributionEventDetail = { points: AwardedPoints };

/**
 * Dispatch the contribution event.
 *
 * `points` is REQUIRED and branded: it can only come from the server, via `awardedPoints()` in the
 * action layer. A client-computed number (`chosen.length * CONTRIBUTION_POINTS.rate`) is a TYPE
 * ERROR here — that expression is exactly what made every re-rate pop a fake "+4 points" (#204).
 *
 * Listeners celebrate only when the award is > 0. A saved-but-unearned contribution is silent.
 */
export function dispatchContribution(points: AwardedPoints): void {
  window.dispatchEvent(
    new CustomEvent<ContributionEventDetail>(CONTRIBUTION_EVENT, { detail: { points } }),
  );
}

/** Read the awarded points off a contribution event. Defensive: a bare `Event` yields 0, which
 *  suppresses the celebration — never celebrate what we cannot verify. */
export function contributionPoints(e: Event): number {
  return (e as CustomEvent<Partial<ContributionEventDetail>>).detail?.points ?? 0;
}
