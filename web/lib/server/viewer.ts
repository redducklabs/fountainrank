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
  try {
    const client = await getAuthedApiClient(requestId);
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
