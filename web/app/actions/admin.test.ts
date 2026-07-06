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
  adminDeleteFountain,
  adminDeletePhoto,
  adminDismissReport,
  adminHidePhoto,
  adminSetFountainHidden,
  adminSetNoteHidden,
  fetchPendingReportCount,
} from "./admin";

const PHOTO_ID = "11111111-1111-1111-1111-111111111111";
const NOTE_ID = "22222222-2222-2222-2222-222222222222";
const FOUNTAIN_ID = "33333333-3333-3333-3333-333333333333";

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

describe("adminDismissReport", () => {
  it.each(["photo", "note", "fountain"] as const)(
    "POSTs the generalized dismiss for %s and revalidates the queue",
    async (contentType) => {
      POST.mockResolvedValue({ response: { status: 204 } });
      const res = await adminDismissReport(contentType, PHOTO_ID);
      expect(res).toEqual({ ok: true });
      expect(POST).toHaveBeenCalledWith(
        "/api/v1/admin/reports/dismiss",
        expect.objectContaining({ body: { content_type: contentType, content_id: PHOTO_ID } }),
      );
      expect(revalidatePath).toHaveBeenCalledWith("/admin/reports");
    },
  );

  it("rejects an unknown content type without an API call", async () => {
    expect(await adminDismissReport("rating" as never, PHOTO_ID)).toEqual({
      ok: false,
      error: "validation",
    });
    expect(getClient).not.toHaveBeenCalled();
  });

  it("validates the content id", async () => {
    expect(await adminDismissReport("photo", "nope")).toEqual({ ok: false, error: "validation" });
    expect(getClient).not.toHaveBeenCalled();
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

// Note/fountain actions are reused from the inline fountain-detail controls, but when invoked
// from the moderation queue they must ALSO revalidate /admin/reports (#12).
describe("adminSetNoteHidden revalidates the queue", () => {
  it("PATCHes the note and revalidates both the fountain page and the queue", async () => {
    PATCH.mockResolvedValue({ response: { status: 200 } });
    const res = await adminSetNoteHidden(NOTE_ID, true, FOUNTAIN_ID);
    expect(res).toEqual({ ok: true });
    expect(PATCH).toHaveBeenCalledWith(
      "/api/v1/admin/notes/{note_id}",
      expect.objectContaining({
        params: { path: { note_id: NOTE_ID } },
        body: { is_hidden: true },
      }),
    );
    expect(revalidatePath).toHaveBeenCalledWith(`/fountains/${FOUNTAIN_ID}`);
    expect(revalidatePath).toHaveBeenCalledWith("/admin/reports");
  });
});

describe("adminSetFountainHidden revalidates the queue", () => {
  it("PATCHes the fountain and revalidates the queue", async () => {
    PATCH.mockResolvedValue({ response: { status: 200 } });
    const res = await adminSetFountainHidden(FOUNTAIN_ID, true);
    expect(res).toEqual({ ok: true });
    expect(PATCH).toHaveBeenCalledWith(
      "/api/v1/admin/fountains/{fountain_id}",
      expect.objectContaining({
        params: { path: { fountain_id: FOUNTAIN_ID } },
        body: { is_hidden: true },
      }),
    );
    expect(revalidatePath).toHaveBeenCalledWith("/admin/reports");
  });
});

describe("adminDeleteFountain revalidates the queue", () => {
  it("DELETEs the fountain and revalidates both the fountain page and the queue", async () => {
    DELETE.mockResolvedValue({ response: { status: 204 } });
    const res = await adminDeleteFountain(FOUNTAIN_ID);
    expect(res).toEqual({ ok: true });
    expect(DELETE).toHaveBeenCalledWith(
      "/api/v1/admin/fountains/{fountain_id}",
      expect.objectContaining({ params: { path: { fountain_id: FOUNTAIN_ID } } }),
    );
    expect(revalidatePath).toHaveBeenCalledWith(`/fountains/${FOUNTAIN_ID}`);
    expect(revalidatePath).toHaveBeenCalledWith("/admin/reports");
  });
});

describe("fetchPendingReportCount", () => {
  it("returns the pending count (all report types) on success", async () => {
    GET.mockResolvedValue({
      data: { pending_count: 7 },
      response: { status: 200 },
    });
    expect(await fetchPendingReportCount()).toBe(7);
    expect(GET).toHaveBeenCalledWith("/api/v1/admin/reports/summary", {});
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
