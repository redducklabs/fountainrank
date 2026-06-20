import type { components } from "@fountainrank/api-client";
import { makeClient } from "@fountainrank/api-client";
import { getApiClient, resolveApiBaseUrl } from "./api";
import type { BboxParams } from "./map/bounds";

export type FountainPin = components["schemas"]["FountainPin"];
export type FountainDetail = components["schemas"]["FountainDetail"];
export type DimensionSummary = components["schemas"]["DimensionSummary"];

export async function fetchBbox(params: BboxParams, requestId?: string): Promise<FountainPin[]> {
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
  return data ?? [];
}

export async function getFountainDetailServer(id: string, requestId: string) {
  const client = makeClient(resolveApiBaseUrl(), { headers: { "X-Request-ID": requestId } });
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
