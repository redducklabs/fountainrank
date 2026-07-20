import type { components } from "@fountainrank/api-client";
import { makeClient } from "@fountainrank/api-client";
import { getApiClient, resolveApiBaseUrl } from "./api";
import type { BboxParams } from "./map/bounds";

export type FountainPin = components["schemas"]["FountainPin"];
export type FountainDetail = components["schemas"]["FountainDetail"];
export type DimensionSummary = components["schemas"]["DimensionSummary"];
export type NoteOut = components["schemas"]["NoteOut"];
export type PhotoOut = components["schemas"]["PhotoOut"];
export type BboxResult = { pins: FountainPin[]; truncated: boolean };

export type PublicFountainResult =
  | { kind: "found"; fountain: FountainDetail }
  | { kind: "not-found" }
  | { kind: "error"; status: number };

/** Anonymous browser lookup used only to resolve an exact public focused-map pin. */
export async function fetchPublicFountain(
  id: string,
  requestId?: string,
): Promise<PublicFountainResult> {
  const client = requestId
    ? makeClient(resolveApiBaseUrl(), { headers: { "X-Request-ID": requestId } })
    : getApiClient();
  try {
    const { data, response } = await client.GET("/api/v1/fountains/{fountain_id}", {
      params: { path: { fountain_id: id } },
    });
    const status = response?.status ?? 0;
    if (status === 404) return { kind: "not-found" };
    if (!data || !response?.ok) return { kind: "error", status };
    return { kind: "found", fountain: data };
  } catch {
    return { kind: "error", status: 0 };
  }
}

export async function fetchBbox(params: BboxParams, requestId?: string): Promise<BboxResult> {
  const client = requestId
    ? makeClient(resolveApiBaseUrl(), { headers: { "X-Request-ID": requestId } })
    : getApiClient();
  const { data, error, response } = await client.GET("/api/v1/fountains/bbox", {
    params: { query: params },
  });
  if (error !== undefined || (response && !response.ok)) {
    const status = response?.status ?? 0;
    throw new Error(`bbox request failed (status ${status})`);
  }
  return {
    pins: data ?? [],
    truncated: response?.headers.get("x-fountainrank-truncated") === "true",
  };
}

// `token` (the viewer's backend access token, when signed in) enriches the detail with
// the caller's own rating (#65 `your_rating`). It is passed in by the server page — this
// module is client-bundled, so it must never fetch the token itself (server-only). A
// null/absent token yields the anonymous response unchanged.
export async function getFountainDetailServer(
  id: string,
  requestId: string,
  token?: string | null,
) {
  const headers: Record<string, string> = { "X-Request-ID": requestId };
  if (token) headers.Authorization = `Bearer ${token}`;
  const client = makeClient(resolveApiBaseUrl(), { headers });
  try {
    const { data, response } = await client.GET("/api/v1/fountains/{fountain_id}", {
      params: { path: { fountain_id: id } },
    });
    return { data, status: response?.status ?? 0 };
  } catch {
    // status 0 = no HTTP response (network error / backend down / DNS failure)
    return { data: undefined, status: 0 };
  }
}

export async function getFountainNotesServer(id: string, requestId: string) {
  const client = makeClient(resolveApiBaseUrl(), { headers: { "X-Request-ID": requestId } });
  try {
    const { data, response } = await client.GET("/api/v1/fountains/{fountain_id}/notes", {
      params: { path: { fountain_id: id } },
    });
    return { data, status: response?.status ?? 0 };
  } catch {
    // status 0 = no HTTP response (network error / backend down / DNS failure)
    return { data: undefined, status: 0 };
  }
}

// `token` (the viewer's backend access token, when signed in) enriches each photo with
// `is_own` (the per-viewer ownership flag the web carousel uses to gate the Delete button —
// see `PhotoGallery`/`PhotoCarousel`). Mirrors `getFountainDetailServer`'s token plumbing; a
// null/absent token yields the anonymous response (every `is_own` false) unchanged. The list
// endpoint responds `Cache-Control: private, no-store` precisely because the response now
// varies per viewer.
export async function getFountainPhotosServer(
  id: string,
  requestId: string,
  token?: string | null,
) {
  const headers: Record<string, string> = { "X-Request-ID": requestId };
  if (token) headers.Authorization = `Bearer ${token}`;
  const client = makeClient(resolveApiBaseUrl(), { headers });
  try {
    const { data, response } = await client.GET("/api/v1/fountains/{fountain_id}/photos", {
      params: { path: { fountain_id: id } },
    });
    return { data, status: response?.status ?? 0 };
  } catch {
    // status 0 = no HTTP response (network error / backend down / DNS failure)
    return { data: undefined, status: 0 };
  }
}
