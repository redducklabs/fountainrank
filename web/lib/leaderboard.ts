import type { components } from "@fountainrank/api-client";
import { makeClient } from "@fountainrank/api-client";
import { resolveApiBaseUrl } from "./api";

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

// Chip labels for the category control.
export const SORT_LABELS: Record<LeaderboardSort, string> = {
  total: "Total",
  fountains: "Fountains",
  ratings: "Ratings",
  verifications: "Verifications",
  conditions: "Conditions",
  attributes: "Attributes",
  notes: "Notes",
};

// The noun shown next to a row's primary count when a category sort is active
// (e.g. "42 fountains added"). `points` is always labelled "pts" and never "category points".
export const CATEGORY_NOUN: Record<LeaderboardCategory, string> = {
  fountains: "fountains added",
  ratings: "ratings",
  verifications: "verifications",
  conditions: "conditions reported",
  attributes: "attributes observed",
  notes: "notes",
};

export type LeaderboardScope = "global" | "near";
export type LatLng = { lat: number; lng: number };
export type LeaderboardQuery = { sort: LeaderboardSort; near: LatLng | null };

export type ParsedLeaderboard = {
  query: LeaderboardQuery;
  scope: LeaderboardScope;
  // The map center carried in the URL, regardless of scope — its presence enables the
  // "Near here" toggle even while the user is currently viewing the global board.
  center: LatLng | null;
  sort: LeaderboardSort;
};

type RawParams = Record<string, string | string[] | undefined>;

function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

function isSort(value: string | undefined): value is LeaderboardSort {
  return value !== undefined && (LEADERBOARD_SORTS as readonly string[]).includes(value);
}

function parseCenter(sp: RawParams): LatLng | null {
  const lat = Number(first(sp.lat));
  const lng = Number(first(sp.lng));
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  if (lat < -90 || lat > 90 || lng < -180 || lng > 180) return null;
  return { lat, lng };
}

// Pure: turn Next.js searchParams into the resolved board state. "Near here" is only honoured
// when a valid center is present (so a stale ?scope=near without coordinates falls back to global).
export function parseLeaderboardParams(sp: RawParams): ParsedLeaderboard {
  const raw = first(sp.sort);
  const sort: LeaderboardSort = isSort(raw) ? raw : "total";
  const center = parseCenter(sp);
  const scope: LeaderboardScope = first(sp.scope) === "near" && center ? "near" : "global";
  return { query: { sort, near: scope === "near" ? center : null }, scope, center, sort };
}

// Pure: the backend query params for a resolved board state.
export function toApiQuery(q: LeaderboardQuery): Record<string, string | number> {
  return q.near ? { sort: q.sort, near_lat: q.near.lat, near_lng: q.near.lng } : { sort: q.sort };
}

// Pure: a control link that preserves the current center + applies one override (sort or scope).
// Default sort=total / global scope omit their params so the canonical URL stays clean.
export function leaderboardControlHref(
  current: ParsedLeaderboard,
  override: { sort?: LeaderboardSort; scope?: LeaderboardScope },
): string {
  const sort = override.sort ?? current.sort;
  const scope = override.scope ?? current.scope;
  const p = new URLSearchParams();
  if (sort !== "total") p.set("sort", sort);
  if (current.center) {
    p.set("lat", String(current.center.lat));
    p.set("lng", String(current.center.lng));
  }
  if (scope === "near" && current.center) p.set("scope", "near");
  const qs = p.toString();
  return qs ? `/leaderboard?${qs}` : "/leaderboard";
}

// Pure: the big number on the right of a row — the category count in category mode, else points.
export function rowPrimaryValue(
  points: number,
  categoryCount: number | null | undefined,
  sort: LeaderboardSort,
): number {
  return sort === "total" ? points : (categoryCount ?? 0);
}

// Pure: the caption under the primary value. `points` is always labelled "pts" (it is the user's
// TOTAL points, which can include bonuses) — never "category points".
export function rowMetricCaption(points: number, sort: LeaderboardSort): string {
  return sort === "total" ? "pts" : `${CATEGORY_NOUN[sort]} · ${points.toLocaleString()} pts`;
}

// `token` (the viewer's backend access token, when signed in) lets the response carry the caller's
// own standing (`you`, #117). This module is client-bundled, so it never fetches the token itself
// (server-only); the server page passes it in. A null/absent token yields the anonymous response.
export async function getLeaderboardServer(
  q: LeaderboardQuery,
  requestId: string,
  token?: string | null,
): Promise<{ data: LeaderboardOut | undefined; status: number }> {
  const headers: Record<string, string> = { "X-Request-ID": requestId };
  if (token) headers.Authorization = `Bearer ${token}`;
  const client = makeClient(resolveApiBaseUrl(), { headers });
  try {
    const { data, response } = await client.GET("/api/v1/leaderboard/contributors", {
      params: { query: toApiQuery(q) },
    });
    return { data, status: response?.status ?? 0 };
  } catch {
    // status 0 = no HTTP response (network error / backend down)
    return { data: undefined, status: 0 };
  }
}

export async function getAdminLeaderboardServer(
  q: LeaderboardQuery,
  requestId: string,
  token: string,
): Promise<{ data: AdminLeaderboardOut | undefined; status: number }> {
  const client = makeClient(resolveApiBaseUrl(), {
    headers: { Authorization: `Bearer ${token}`, "X-Request-ID": requestId },
  });
  try {
    const { data, response } = await client.GET("/api/v1/admin/leaderboard/contributors", {
      params: { query: toApiQuery(q) },
    });
    return { data, status: response?.status ?? 0 };
  } catch {
    return { data: undefined, status: 0 };
  }
}
