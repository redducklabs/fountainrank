import "server-only";
import type { AwardedPoints } from "@fountainrank/contributions";

/**
 * Web's ONLY place that mints `AwardedPoints` (#204).
 *
 * `server-only` is the barrier: importing this module from a client component is a BUILD ERROR, so
 * UI code physically cannot mint an award. Components receive an already-minted value through an
 * `ActionResult` and have no constructor to forge one with. Both `contribute.ts` and
 * `add-fountain.ts` parse raw write responses, so they share this one implementation — the legacy
 * fallback below must never drift between them.
 *
 * PRESENCE, not nullishness: the canonical `points_awarded` wins whenever the KEY EXISTS, including
 * when it is `null` (which means "this server reported no award" -> 0). The deprecated
 * `condition_points_awarded` is consulted ONLY when the canonical key is absent — an older server
 * during the deploy window. Writing `d.points_awarded ?? d.condition_points_awarded` would
 * celebrate a stale condition award on a null canonical field.
 *
 * Never celebrate what we cannot verify: anything unparseable resolves to 0.
 */
export const NO_AWARD = 0 as AwardedPoints;

export function awardedPoints(data: unknown): AwardedPoints {
  if (!data || typeof data !== "object") return NO_AWARD;
  const d = data as { points_awarded?: unknown; condition_points_awarded?: unknown };
  const value = "points_awarded" in d ? d.points_awarded : d.condition_points_awarded;
  return (typeof value === "number" && value > 0 ? value : NO_AWARD) as AwardedPoints;
}
