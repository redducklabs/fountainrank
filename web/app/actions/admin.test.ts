import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { GET, PATCH, POST, DELETE, getClient, revalidatePath, log } = vi.hoisted(() => ({
  GET: vi.fn(),
  PATCH: vi.fn(),
  POST: vi.fn(),
  DELETE: vi.fn(),
  getClient: vi.fn(),
  revalidatePath: vi.fn(),
  log: vi.fn(),
}));
vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath }));
vi.mock("../../lib/server/api", () => ({ getAuthedApiClientForAction: getClient }));
vi.mock("../../lib/server/log", () => ({ log }));

import {
  adminDeletePhoto,
  adminDismissPhotoReports,
  adminHidePhoto,
  fetchPendingReportCount,
} from "./admin";

const PHOTO_ID = "11111111-1111-1111-1111-111111111111";

beforeEach(() => {
  getClient.mockImplementation(async () => ({ GET, PATCH, POST, DELETE }));
});
afterEach(() => vi.clearAllMocks());

describe("adminHidePhoto", () => {
  it("PATCHes and revalidates the reports queue on success", async () => {
    PATCH.mockResolvedValue({ response: { status: 200 } });
    const res = await adminHidePhoto(PHOTO_ID, true);
    expect(res).toEqual({ ok: true });
    expect(PATCH).toHaveBeenCalledWith(
      "/api/v1/admin/photos/{photo_id}",
      expect.objectContaining({
        params: { path: { photo_id: PHOTO_ID } },
        body: { is_hidden: true },
      }),
    );
    expect(revalidatePath).toHaveBeenCalledWith("/admin/reports");
  });

  it("validates the photo id before any API call", async () => {
    expect(await adminHidePhoto("not-a-uuid", true)).toEqual({ ok: false, error: "validation" });
    expect(getClient).not.toHaveBeenCalled();
  });
});

describe("adminDismissPhotoReports", () => {
  it("POSTs dismiss-reports and revalidates on success", async () => {
    POST.mockResolvedValue({ response: { status: 204 } });
    const res = await adminDismissPhotoReports(PHOTO_ID);
    expect(res).toEqual({ ok: true });
    expect(POST).toHaveBeenCalledWith(
      "/api/v1/admin/photos/{photo_id}/dismiss-reports",
      expect.objectContaining({ params: { path: { photo_id: PHOTO_ID } } }),
    );
    expect(revalidatePath).toHaveBeenCalledWith("/admin/reports");
  });
});

describe("adminDeletePhoto", () => {
  it("DELETEs and revalidates on success", async () => {
    DELETE.mockResolvedValue({ response: { status: 204 } });
    const res = await adminDeletePhoto(PHOTO_ID);
    expect(res).toEqual({ ok: true });
    expect(DELETE).toHaveBeenCalledWith(
      "/api/v1/admin/photos/{photo_id}",
      expect.objectContaining({ params: { path: { photo_id: PHOTO_ID } } }),
    );
    expect(revalidatePath).toHaveBeenCalledWith("/admin/reports");
  });
});

describe("fetchPendingReportCount", () => {
  it("returns the pending count on success", async () => {
    GET.mockResolvedValue({
      data: { pending_photo_count: 7 },
      response: { status: 200 },
    });
    expect(await fetchPendingReportCount()).toBe(7);
  });

  it("returns 0 on a 403 (non-admin poll degrades quietly, no noisy log)", async () => {
    GET.mockResolvedValue({ data: undefined, response: { status: 403 } });
    expect(await fetchPendingReportCount()).toBe(0);
    expect(log).not.toHaveBeenCalled();
  });

  it("returns 0 on a 401", async () => {
    GET.mockResolvedValue({ data: undefined, response: { status: 401 } });
    expect(await fetchPendingReportCount()).toBe(0);
  });

  it("returns 0 on a server error", async () => {
    GET.mockResolvedValue({ data: undefined, response: { status: 500 } });
    expect(await fetchPendingReportCount()).toBe(0);
  });

  it("returns 0 when the token fetch throws", async () => {
    getClient.mockRejectedValueOnce(new Error("no token"));
    expect(await fetchPendingReportCount()).toBe(0);
  });

  it("returns 0 when the GET call throws", async () => {
    GET.mockRejectedValueOnce(new Error("ECONNREFUSED"));
    expect(await fetchPendingReportCount()).toBe(0);
  });
});
