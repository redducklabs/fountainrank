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

// RSC-safe read for the header badge's server-rendered initial count (W8): uses the
// RSC-only client (read-only cookies — no token refresh persisted, acceptable for a
// per-request read), unlike the polling server action which needs the writable action
// client. Degrades to 0 on any error/non-2xx so a broken read never blocks header render.
export async function getPendingReportCountServer(requestId: string): Promise<number> {
  try {
    const client = await getAuthedApiClient(requestId);
    const { data, response } = await client.GET("/api/v1/admin/photo-reports/summary", {});
    const status = response?.status ?? 0;
    if (status < 200 || status >= 300 || !data) {
      if (status !== 401 && status !== 403) {
        log("warn", "pending report count (initial) non-2xx", { requestId, status });
      }
      return 0;
    }
    return data.pending_photo_count;
  } catch (err) {
    log("warn", "pending report count (initial) error", {
      requestId,
      reason: (err as Error).name,
    });
    return 0;
  }
}
