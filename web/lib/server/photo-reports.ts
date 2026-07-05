import "server-only";

import { getAuthedApiClient } from "./api";
import { log } from "./log";

export async function getPhotoReportsServer(
  requestId: string,
  params?: { limit?: number; offset?: number },
) {
  try {
    const client = await getAuthedApiClient(requestId);
    const { data, response } = await client.GET("/api/v1/admin/photo-reports", {
      params: { query: params },
    });
    return { data, status: response?.status ?? 0 };
  } catch (err) {
    log("warn", "admin photo reports error", {
      requestId,
      reason: (err as Error).name,
    });
    return { data: undefined, status: 0 };
  }
}
