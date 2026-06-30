import "server-only";
import { getLogtoContext } from "@logto/next/server-actions";
import { getLogtoConfig } from "../logto";
import { getAuthedApiClient, getAuthedApiClientForAction } from "./api";
import { getTotalPointsFromClient } from "./contributions";
import { log } from "./log";

export type Viewer =
  | { state: "anonymous" }
  | {
      state: "authed";
      displayName: string;
      avatarUrl: string | null;
      isAdmin: boolean;
      // True when the account still resolves to "Anonymous" (kill Anonymous): the header shows a
      // "finish setup" prompt and the sign-in callback routes to the /account name gate. The API
      // sends displayName="" in this state, so the raw Logto subject never reaches the header.
      needsName: boolean;
    }
  | { state: "error" };

// Shared /me read + mapping. `getViewer` (RSC) and `getViewerForRoute` (route handler) differ only
// in how they acquire the authed client — they map the response identically.
async function viewerFromMe(
  client: Awaited<ReturnType<typeof getAuthedApiClient>>,
  requestId: string,
): Promise<Viewer> {
  try {
    const { data, response } = await client.GET("/api/v1/me");
    const status = response?.status ?? 0;
    if (data) {
      return {
        state: "authed",
        displayName: data.display_name,
        avatarUrl: data.avatar_url,
        isAdmin: data.is_admin,
        needsName: data.needs_name,
      };
    }
    if (status === 401) return { state: "anonymous" }; // session no longer usable
    log("warn", "viewer /me failed", { requestId, status });
    return { state: "error" };
  } catch (err) {
    log("error", "viewer /me error", { requestId, reason: (err as Error).name });
    return { state: "error" };
  }
}

export async function getViewer(requestId: string): Promise<Viewer> {
  // A broken/expired/malformed session cookie can make getLogtoContext throw — that means
  // the session is no longer usable, so treat it as anonymous (offer sign-in), never crash
  // the header/page.
  let isAuthenticated = false;
  try {
    ({ isAuthenticated } = await getLogtoContext(getLogtoConfig(), { fetchUserInfo: false }));
  } catch {
    return { state: "anonymous" };
  }
  if (!isAuthenticated) return { state: "anonymous" };
  // Token/session acquisition: a throw here means the session is no longer usable,
  // so treat as anonymous (offer sign-in) rather than a backend error.
  let client: Awaited<ReturnType<typeof getAuthedApiClient>>;
  try {
    client = await getAuthedApiClient(requestId);
  } catch {
    return { state: "anonymous" };
  }
  return viewerFromMe(client, requestId);
}

// Route-handler-safe variant (e.g. the sign-in callback): uses getAccessToken (writable-cookie)
// via getAuthedApiClientForAction, since RSC-only token helpers are unavailable in a route handler.
// After sign-in the session is authenticated, so a token/`/me` failure resolves to anonymous (no
// gate; the user can retry) rather than throwing during the callback redirect.
export async function getViewerForRoute(requestId: string): Promise<Viewer> {
  let client: Awaited<ReturnType<typeof getAuthedApiClientForAction>>;
  try {
    client = await getAuthedApiClientForAction(requestId);
  } catch {
    return { state: "anonymous" };
  }
  return viewerFromMe(client, requestId);
}

export async function getViewerTotalPoints(requestId: string): Promise<number> {
  let client: Awaited<ReturnType<typeof getAuthedApiClient>>;
  try {
    client = await getAuthedApiClient(requestId);
  } catch {
    return 0;
  }
  const result = await getTotalPointsFromClient(client, requestId);
  return result.ok ? result.totalPoints : 0;
}
