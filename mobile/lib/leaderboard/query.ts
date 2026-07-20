import type { components } from "@fountainrank/api-client";

export type LeaderboardOut = components["schemas"]["LeaderboardOut"];
export type ContributorRow = components["schemas"]["ContributorRow"];
export type AdminContributorRow = components["schemas"]["AdminContributorRow"];
export type AdminLeaderboardOut = components["schemas"]["AdminLeaderboardOut"];
export type YourStanding = components["schemas"]["YourStanding"];

export const LEADERBOARD_SORTS = [
  "total",
  "fountains",
  "ratings",
  "verifications",
  "conditions",
  "attributes",
  "notes",
] as const;
export type LeaderboardSort = (typeof LEADERBOARD_SORTS)[number];
export type LeaderboardCategory = Exclude<LeaderboardSort, "total">;
export type LeaderboardScope = "global" | "near";
export type LatLng = { lat: number; lng: number };

export const SORT_LABELS: Record<LeaderboardSort, string> = {
  total: "Total",
  fountains: "Fountains",
  ratings: "Ratings",
  verifications: "Verifications",
  conditions: "Conditions",
  attributes: "Attributes",
  notes: "Notes",
};

// The noun next to a row's primary count in category mode (e.g. "42 fountains added"). `points`
// is always shown as total "pts" — never as "category points".
export const CATEGORY_NOUN: Record<LeaderboardCategory, string> = {
  fountains: "fountains added",
  ratings: "ratings",
  verifications: "verifications",
  conditions: "conditions reported",
  attributes: "attributes observed",
  notes: "notes",
};

function firstParam(value?: string | string[]): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

// Parse the lat/lng route params (passed by the Map screen) into a center, or null when absent /
// invalid — in which case only the global board is reachable (no stale/zero coordinates).
export function parseCenterParam(lat?: string | string[], lng?: string | string[]): LatLng | null {
  const la = Number(firstParam(lat));
  const ln = Number(firstParam(lng));
  if (!Number.isFinite(la) || !Number.isFinite(ln)) return null;
  if (la < -90 || la > 90 || ln < -180 || ln > 180) return null;
  return { lat: la, lng: ln };
}

// The backend query params for the active scope + sort. "Near here" requires a center; without one
// it degrades to the global board.
export function buildLeaderboardQuery(
  scope: LeaderboardScope,
  sort: LeaderboardSort,
  center: LatLng | null,
): Record<string, string | number> {
  return scope === "near" && center
    ? { sort, near_lat: center.lat, near_lng: center.lng }
    : { sort };
}

// The big number on the right of a row: the category count in category mode, else points.
export function rowPrimaryValue(
  points: number,
  categoryCount: number | null | undefined,
  sort: LeaderboardSort,
): number {
  return sort === "total" ? points : (categoryCount ?? 0);
}

// The caption under the primary value. `points` is the user's TOTAL points (may include bonuses).
export function rowMetricCaption(points: number, sort: LeaderboardSort): string {
  return sort === "total" ? "pts" : `${CATEGORY_NOUN[sort]} · ${points.toLocaleString()} pts`;
}

export function contributorHistoryUserId(
  row: ContributorRow | AdminContributorRow,
  isAdmin: boolean,
): string | null {
  return isAdmin && "user_id" in row ? row.user_id : null;
}
