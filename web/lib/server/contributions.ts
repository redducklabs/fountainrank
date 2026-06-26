import "server-only";

import type { ApiClient } from "@fountainrank/api-client";

import { log } from "./log";

export async function getTotalPointsFromClient(
  client: ApiClient,
  requestId: string,
): Promise<{ ok: true; totalPoints: number } | { ok: false; status: number }> {
  try {
    const { data, response } = await client.GET("/api/v1/me/contributions");
    if (data) return { ok: true, totalPoints: data.stats.total_points };
    const status = response?.status ?? 0;
    log("warn", "contribution-stats failed", { requestId, status });
    return { ok: false, status };
  } catch (err) {
    log("warn", "contribution-stats error", { requestId, reason: (err as Error).name });
    return { ok: false, status: 0 };
  }
}
