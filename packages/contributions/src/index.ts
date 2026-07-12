export const CONTRIBUTION_POINTS = {
  add_fountain: 10,
  first_fountain_bonus: 5,
  first_in_area_bonus: 15,
  rate: 2,
  observe_attribute: 2,
  verify_working: 3,
  report_condition: 2,
  add_note: 2,
  // The backend has awarded this all along (POINTS["photo_first"]); it was simply missing here,
  // which is why the photo path could only celebrate without a number (#204).
  photo_first: 5,
} as const;

export type PointsLine = { label: string; points: number; conditional?: boolean };

declare const AWARDED: unique symbol;
/**
 * Points the SERVER said it awarded (#204).
 *
 * Minted ONLY by the response-parsing layer — `web/app/actions/awarded.ts` (behind `server-only`)
 * and `mobile/lib/awarded-points.ts` (whose parameter is the generated response union). A brand
 * gates ASSIGNMENT, not provenance, so the LOCALITY of the constructor is what stops a
 * client-invented number reaching the celebration.
 *
 * Do NOT add a constructor here: exporting one from the shared package would let any component
 * mint a fake award and defeat the whole mechanism.
 */
export type AwardedPoints = number & { readonly [AWARDED]: true };

/**
 * Mirrors the backend `ViewerAwardState` — what the viewer can still EARN on a fountain, per the
 * contribution dedup ledger. Null/undefined for anonymous viewers (they have earned nothing yet).
 *
 * An as-of-read hint: the server's `points_awarded` on the write response is authoritative.
 */
export type ViewerAwardStateT = {
  unrated_rating_type_ids: number[];
  unobserved_attribute_type_ids: number[];
  note_earnable: boolean;
  photo_first_earnable: boolean;
};

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

/**
 * Pre-submit previews (#204). Each counts only what the viewer can ACTUALLY still earn, per the
 * ledger-derived `ViewerAwardState` — re-rating a dimension you've already been awarded for earns
 * nothing, so promising "+2 possible points" for it is the lie this fixes.
 *
 * A null/undefined state means an anonymous viewer: they have earned nothing yet, so show the full
 * possible award.
 *
 * The conditional bonuses (first_rating_bonus etc.) are deliberately excluded, so a preview can
 * only ever UNDER-promise. Under-promising resolves as a pleasant surprise in the authoritative
 * post-submit number; over-promising is the bug.
 */
export function ratingEarnablePoints(
  state: ViewerAwardStateT | null | undefined,
  chosenRatingTypeIds: number[],
): PointsLine[] {
  const earnable = state
    ? chosenRatingTypeIds.filter((id) => state.unrated_rating_type_ids.includes(id))
    : chosenRatingTypeIds;
  return countedLine("Ratings", earnable.length, CONTRIBUTION_POINTS.rate);
}

export function attributeEarnablePoints(
  state: ViewerAwardStateT | null | undefined,
  chosenAttributeTypeIds: number[],
): PointsLine[] {
  const earnable = state
    ? chosenAttributeTypeIds.filter((id) => state.unobserved_attribute_type_ids.includes(id))
    : chosenAttributeTypeIds;
  return countedLine("Details", earnable.length, CONTRIBUTION_POINTS.observe_attribute);
}

/** `hasComment` still gates the line (an empty box previews nothing); the state gates the AWARD. */
export function notePointsPreview(
  state: ViewerAwardStateT | null | undefined,
  hasComment: boolean,
): PointsLine[] {
  if (!hasComment) return [];
  return !state || state.note_earnable
    ? [{ label: "Comment", points: CONTRIBUTION_POINTS.add_note }]
    : [];
}

/** `photo_first` is per-FOUNTAIN (anyone's first photo spends it), not per-user. */
export function photoEarnablePoints(state: ViewerAwardStateT | null | undefined): PointsLine[] {
  return !state || state.photo_first_earnable
    ? [{ label: "First photo bonus", points: CONTRIBUTION_POINTS.photo_first }]
    : [];
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
export function conditionPointsBlocked(eligibleAt: string | null | undefined, now: Date): boolean {
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

/**
 * True when the rating draft has at least one star edit that differs from the viewer's saved
 * rating for that dimension (#1). Used to decide whether "Add photo" should first flush an unsaved
 * rating. An edit equal to the saved value, or no edit at all, is not dirty. A `your_rating` of null
 * (never rated) is treated as 0, so any positive edit on it is dirty.
 */
export function isRatingDraftDirty(
  dimensions: { rating_type_id: number; your_rating?: number | null }[],
  edits: Record<number, number>,
): boolean {
  return dimensions.some((d) => {
    const edit = edits[d.rating_type_id];
    if (edit == null) return false;
    return edit !== (d.your_rating ?? 0);
  });
}
