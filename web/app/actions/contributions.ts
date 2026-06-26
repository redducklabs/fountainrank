"use server";
import { getAuthedApiClientForAction } from "../../lib/server/api";
import { log } from "../../lib/server/log";

export type ContributionStatsResult =
  | { ok: true; totalPoints: number }
  | { ok: false; error: "unauthenticated" | "server" };

export async function getMyContributionStats(): Promise<ContributionStatsResult> {
  const requestId = crypto.randomUUID();
  let client: Awaited<ReturnType<typeof getAuthedApiClientForAction>>;
  try {
    client = await getAuthedApiClientForAction(requestId);
  } catch (err) {
    log("warn", "contribution-stats auth error", { requestId, reason: (err as Error).name });
    return { ok: false, error: "unauthenticated" };
  }
  try {
    const { data, response } = await client.GET("/api/v1/me/contributions");
    const status = response?.status ?? 0;
    if (data) return { ok: true, totalPoints: data.stats.total_points };
    if (status === 401) return { ok: false, error: "unauthenticated" };
    log("warn", "contribution-stats failed", { requestId, status });
    return { ok: false, error: "server" };
  } catch (err) {
    log("warn", "contribution-stats error", { requestId, reason: (err as Error).name });
    return { ok: false, error: "server" };
  }
}
