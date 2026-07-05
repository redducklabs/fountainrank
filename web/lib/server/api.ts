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

// Raw Logto access token via the Server-Action variant (can persist a refreshed token to
// the writable action cookie store, unlike the RSC variant). Needed by callers that issue
// a raw `fetch` themselves (e.g. multipart photo upload) instead of going through the
// generated api-client. Token never leaves the server — `server-only` guards this file.
export async function getActionAccessToken(requestId: string): Promise<string> {
  void requestId;
  return getAccessToken(getLogtoConfig(), API_RESOURCE);
}

// The viewer's backend access token for enriching a PUBLIC read with their identity
// (e.g. #65 `your_rating` on the fountain detail), or null when anonymous / on any
// session-or-token error. RSC-only (read-only cookies; no refresh persisted). Callers
// pass the result into a client-bundled fetch helper and fall back to the anonymous
// response when null, so public pages never break. `server-only` keeps it off the client.
export async function getViewerAccessToken(): Promise<string | null> {
  try {
    const token = await getAccessTokenRSC(getLogtoConfig(), API_RESOURCE);
    return token || null;
  } catch {
    return null;
  }
}
