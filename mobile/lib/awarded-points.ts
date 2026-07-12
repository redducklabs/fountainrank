import type { components } from "@fountainrank/api-client";
import type { AwardedPoints } from "@fountainrank/contributions";

/**
 * The only responses that can carry an award. Deliberately the GENERATED response types, not a
 * structural `{ points_awarded?: number }` — an ad-hoc `{ points_awarded: myGuess }` literal will
 * not typecheck against these, because they carry many required fields.
 *
 * TypeScript is structural, so this is a HIGH-FRICTION barrier, not a nominal one: someone holding
 * a real `detail` could still write `awardedPoints({ ...detail, points_awarded: guess })`. That is
 * accepted — the goal is to stop the ACCIDENTAL re-introduction of client-guessed points (which
 * happened on five separate paths, #204), not to defeat a determined author. The
 * `@ts-expect-error` test in awarded-points.test.ts is what pins the barrier in place.
 */
type WriteResponse =
  | components["schemas"]["FountainDetail"]
  | components["schemas"]["NoteOut"]
  | components["schemas"]["PhotoOut"];

/**
 * Mobile's ONLY place that mints `AwardedPoints` (#204).
 *
 * PRESENCE, not nullishness: the canonical `points_awarded` wins whenever the KEY EXISTS, including
 * when it is `null` (which means "this server reported no award" -> 0). The deprecated
 * `condition_points_awarded` is consulted ONLY when the canonical key is absent — an older server.
 * Writing `data?.points_awarded ?? data?.condition_points_awarded` would celebrate a stale
 * condition award on a null canonical field.
 *
 * Never celebrate what we cannot verify: anything unknown resolves to 0, and the celebration is
 * gated on > 0.
 */
export function awardedPoints(data: WriteResponse | undefined): AwardedPoints {
  const zero = 0 as AwardedPoints;
  if (!data) return zero;
  const value =
    "points_awarded" in data
      ? data.points_awarded
      : (data as { condition_points_awarded?: number | null }).condition_points_awarded;
  return (typeof value === "number" && value > 0 ? value : zero) as AwardedPoints;
}
