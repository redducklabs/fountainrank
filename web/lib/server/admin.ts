import "server-only";

import { getAuthedApiClient } from "./api";
import { log } from "./log";

export async function getAdminFountainDetailServer(id: string, requestId: string) {
  try {
    const client = await getAuthedApiClient(requestId);
    const { data, response } = await client.GET("/api/v1/admin/fountains/{fountain_id}", {
      params: { path: { fountain_id: id } },
    });
    return { data, status: response?.status ?? 0 };
  } catch (err) {
    log("warn", "admin fountain detail error", {
      requestId,
      id,
      reason: (err as Error).name,
    });
    return { data: undefined, status: 0 };
  }
}
