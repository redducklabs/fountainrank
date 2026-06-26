import "server-only";
import { getLogtoContext } from "@logto/next/server-actions";
import { getLogtoConfig } from "../logto";
import { getAuthedApiClient } from "./api";
import { log } from "./log";

export type Viewer =
  | { state: "anonymous" }
  | { state: "authed"; displayName: string; avatarUrl: string | null; isAdmin: boolean }
  | { state: "error" };

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
  // /me fetch: a throw or non-2xx here indicates a backend/network problem → error.
  try {
    const { data, response } = await client.GET("/api/v1/me");
    const status = response?.status ?? 0;
    if (data) {
      return {
        state: "authed",
        displayName: data.display_name,
        avatarUrl: data.avatar_url,
        isAdmin: data.is_admin,
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

export async function getViewerTotalPoints(requestId: string): Promise<number> {
  let client: Awaited<ReturnType<typeof getAuthedApiClient>>;
  try {
    client = await getAuthedApiClient(requestId);
  } catch {
    return 0;
  }
  try {
    const { data, response } = await client.GET("/api/v1/me/contributions");
    if (data) return data.stats.total_points;
    log("warn", "viewer /me/contributions failed", {
      requestId,
      status: response?.status ?? 0,
    });
    return 0;
  } catch (err) {
    log("warn", "viewer /me/contributions error", { requestId, reason: (err as Error).name });
    return 0;
  }
}
