export const CONTRIBUTION_POINTS = {
  add_fountain: 10,
  first_fountain_bonus: 5,
  first_in_area_bonus: 15,
  rate: 2,
  observe_attribute: 2,
  verify_working: 3,
  report_condition: 2,
  add_note: 2,
} as const;

export type PointsLine = { label: string; points: number; conditional?: boolean };

export function addFountainPointsPreview(input: {
  ratingsCount: number;
  observationsCount: number;
  hasComment: boolean;
}): PointsLine[] {
  return [
    { label: "Add fountain", points: CONTRIBUTION_POINTS.add_fountain },
    {
      label: "First fountain bonus",
      points: CONTRIBUTION_POINTS.first_fountain_bonus,
      conditional: true,
    },
    {
      label: "First nearby fountain bonus",
      points: CONTRIBUTION_POINTS.first_in_area_bonus,
      conditional: true,
    },
    ...countedLine("Ratings", input.ratingsCount, CONTRIBUTION_POINTS.rate),
    ...countedLine("Details", input.observationsCount, CONTRIBUTION_POINTS.observe_attribute),
    ...(input.hasComment ? [{ label: "Comment", points: CONTRIBUTION_POINTS.add_note }] : []),
  ];
}

export function ratingPointsPreview(selectedRatingCount: number): PointsLine[] {
  return countedLine("Ratings", selectedRatingCount, CONTRIBUTION_POINTS.rate);
}

export function attributePointsPreview(selectedObservationCount: number): PointsLine[] {
  return countedLine("Details", selectedObservationCount, CONTRIBUTION_POINTS.observe_attribute);
}

export function notePointsPreview(hasComment: boolean): PointsLine[] {
  return hasComment ? [{ label: "Comment", points: CONTRIBUTION_POINTS.add_note }] : [];
}

export function conditionPointsPreview(status: "working" | "problem"): PointsLine[] {
  return [
    {
      label: status === "working" ? "Working verification" : "Condition report",
      points:
        status === "working"
          ? CONTRIBUTION_POINTS.verify_working
          : CONTRIBUTION_POINTS.report_condition,
    },
  ];
}

export function totalPreviewPoints(lines: PointsLine[]): number {
  return lines.reduce((sum, line) => sum + line.points, 0);
}

/**
 * Pre-submit hint (#124): true when the viewer already earned condition points on this
 * fountain within the last 24h, so a new condition report will earn 0. Best-effort — the
 * server is authoritative for the actual award (condition_points_awarded on the POST).
 */
export function conditionPointsBlocked(
  eligibleAt: string | null | undefined,
  now: Date,
): boolean {
  return eligibleAt != null && new Date(eligibleAt).getTime() > now.getTime();
}

/**
 * Human-readable "how long until condition points can be earned again" for the #124 warning
 * (e.g. "about 5 hours", "about 1 minute"). Returns null when already eligible (no future time).
 * Rounded + coarse on purpose — it's a best-effort pre-submit hint, not a countdown.
 */
export function conditionPointsEligibleInText(
  eligibleAt: string | null | undefined,
  now: Date,
): string | null {
  if (eligibleAt == null) return null;
  const ms = new Date(eligibleAt).getTime() - now.getTime();
  if (ms <= 0) return null;
  const hours = Math.round(ms / 3_600_000);
  if (hours >= 1) return `about ${hours} ${hours === 1 ? "hour" : "hours"}`;
  const mins = Math.max(1, Math.round(ms / 60_000));
  return `about ${mins} ${mins === 1 ? "minute" : "minutes"}`;
}

function countedLine(label: string, count: number, pointsEach: number): PointsLine[] {
  return count > 0 ? [{ label, points: count * pointsEach }] : [];
}
