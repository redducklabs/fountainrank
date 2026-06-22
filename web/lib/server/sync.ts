import "server-only";

import { getAccessToken, getAccessTokenRSC } from "@logto/next/server-actions";

import { resolveApiBaseUrl } from "../api";
import { API_RESOURCE, getLogtoConfig } from "../logto";
import { log } from "./log";

// Core POST to /me/sync — shared by both callers.
// resourceToken: JWT scoped to API_RESOURCE; opaqueToken: opaque Logto access token.
// Best-effort: never throws, logs only requestId and status.
async function postProfileSync(
  requestId: string,
  resourceToken: string,
  opaqueToken: string,
): Promise<void> {
  const res = await fetch(`${resolveApiBaseUrl()}/api/v1/me/sync`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${resourceToken}`,
      "Content-Type": "application/json",
      "X-Request-ID": requestId,
    },
    body: JSON.stringify({ userinfo_token: opaqueToken }),
  });
  if (res.ok) {
    log("debug", "profile synced", { requestId, status: res.status });
  } else {
    log("warn", "profile sync failed", { requestId, status: res.status });
  }
}

// Best-effort profile sync from the /account RSC: forward the OPAQUE access token to the
// backend, which calls Logto userinfo. Never throws — a sync failure must not break /account.
// `server-only` guarantees the tokens cannot leak into a client bundle. Tokens are fetched
// sequentially (the SDK reads/refreshes session-cookie state).
export async function syncProfile(requestId: string): Promise<void> {
  try {
    const config = getLogtoConfig();
    const resourceToken = await getAccessTokenRSC(config, API_RESOURCE);
    const opaqueToken = await getAccessTokenRSC(config);
    await postProfileSync(requestId, resourceToken, opaqueToken);
  } catch (err) {
    log("warn", "profile sync error", {
      requestId,
      reason: err instanceof Error ? err.name : "unknown",
    });
  }
}

// Best-effort profile sync for route handlers (e.g., the sign-in callback). Uses
// getAccessToken (the route/action variant) instead of getAccessTokenRSC, since RSC-only
// helpers are not available in route handler context. Never throws — a sync failure must
// never break sign-in.
export async function syncProfileForRoute(requestId: string): Promise<void> {
  try {
    const config = getLogtoConfig();
    const resourceToken = await getAccessToken(config, API_RESOURCE);
    const opaqueToken = await getAccessToken(config);
    await postProfileSync(requestId, resourceToken, opaqueToken);
  } catch (err) {
    log("warn", "profile sync error (route)", {
      requestId,
      reason: err instanceof Error ? err.name : "unknown",
    });
  }
}
