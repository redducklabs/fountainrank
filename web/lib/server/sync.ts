import "server-only";

import { getAccessTokenRSC } from "@logto/next/server-actions";

import { resolveApiBaseUrl } from "../api";
import { API_RESOURCE, getLogtoConfig } from "../logto";
import { log } from "./log";

// Best-effort profile sync from the /account RSC: forward the OPAQUE access token to the
// backend, which calls Logto userinfo. Never throws — a sync failure must not break /account.
// `server-only` guarantees the tokens cannot leak into a client bundle. Tokens are fetched
// sequentially (the SDK reads/refreshes session-cookie state).
export async function syncProfile(requestId: string): Promise<void> {
  try {
    const config = getLogtoConfig();
    const resourceToken = await getAccessTokenRSC(config, API_RESOURCE);
    const opaqueToken = await getAccessTokenRSC(config);
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
  } catch (err) {
    log("warn", "profile sync error", {
      requestId,
      reason: err instanceof Error ? err.name : "unknown",
    });
  }
}
