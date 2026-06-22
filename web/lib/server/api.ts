import "server-only";

import { getAccessToken, getAccessTokenRSC } from "@logto/next/server-actions";

import { makeClient, type ApiClient } from "@fountainrank/api-client";

import { resolveApiBaseUrl } from "../api";
import { API_RESOURCE, getLogtoConfig } from "../logto";

export function authedClientHeaders(token: string, requestId: string): Record<string, string> {
  return { Authorization: `Bearer ${token}`, "X-Request-ID": requestId };
}

// getAccessTokenRSC is the RSC-specific helper: a React Server Component has read-only
// cookies, so a refreshed token is not persisted here (acceptable for a per-request read).
// The token never leaves the server — `server-only` guards against any client-bundle import.
export async function getAuthedApiClient(requestId: string): Promise<ApiClient> {
  const token = await getAccessTokenRSC(getLogtoConfig(), API_RESOURCE);
  return makeClient(resolveApiBaseUrl(), { headers: authedClientHeaders(token, requestId) });
}

// Server-Action variant: getAccessToken can persist a refreshed token to the writable
// action cookie store (RSC cookies are read-only). Token never leaves the server.
export async function getAuthedApiClientForAction(requestId: string): Promise<ApiClient> {
  const token = await getAccessToken(getLogtoConfig(), API_RESOURCE);
  return makeClient(resolveApiBaseUrl(), { headers: authedClientHeaders(token, requestId) });
}
