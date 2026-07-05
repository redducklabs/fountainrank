"use server";
import { getAuthedApiClientForAction } from "../../lib/server/api";
import { getTotalPointsFromClient } from "../../lib/server/contributions";
import { log } from "../../lib/server/log";

export type ContributionStatsResult =
  { ok: true; totalPoints: number } | { ok: false; error: "unauthenticated" | "server" };

export async function getMyContributionStats(): Promise<ContributionStatsResult> {
  const requestId = crypto.randomUUID();
  let client: Awaited<ReturnType<typeof getAuthedApiClientForAction>>;
  try {
    client = await getAuthedApiClientForAction(requestId);
  } catch (err) {
    log("warn", "contribution-stats auth error", { requestId, reason: (err as Error).name });
    return { ok: false, error: "unauthenticated" };
  }
  const result = await getTotalPointsFromClient(client, requestId);
  if (result.ok) return { ok: true, totalPoints: result.totalPoints };
  if (result.status === 401) return { ok: false, error: "unauthenticated" };
  return { ok: false, error: "server" };
}
