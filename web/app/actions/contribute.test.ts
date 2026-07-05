import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { POST, DELETE, getClient, getActionAccessToken, revalidatePath, log, fetchMock } =
  vi.hoisted(() => ({
    POST: vi.fn(),
    DELETE: vi.fn(),
    getClient: vi.fn(),
    getActionAccessToken: vi.fn(),
    revalidatePath: vi.fn(),
    log: vi.fn(),
    fetchMock: vi.fn(),
  }));
vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath }));
vi.mock("../../lib/server/api", () => ({
  getAuthedApiClientForAction: getClient,
  getActionAccessToken,
}));
vi.mock("../../lib/server/log", () => ({ log }));
vi.mock("../../lib/api", () => ({ resolveApiBaseUrl: () => "https://api.test" }));
vi.stubGlobal("fetch", fetchMock);

import {
  submitAttributes,
  submitRating,
  submitCondition,
  submitNote,
  uploadPhoto,
  reportPhoto,
  deleteOwnPhoto,
} from "./contribute";

const FID = "123e4567-e89b-12d3-a456-426614174000";
const PID = "223e4567-e89b-12d3-a456-426614174000";
beforeEach(() => {
  getClient.mockImplementation(async () => ({ POST, DELETE }));
  getActionAccessToken.mockResolvedValue("test-token");
});
afterEach(() => vi.clearAllMocks());

describe("submitRating", () => {
  it("validation fails BEFORE any API call for empty ratings", async () => {
    const res = await submitRating(FID, []);
    expect(res).toEqual({ ok: false, error: "validation" });
    expect(getClient).not.toHaveBeenCalled();
  });
  it("rejects out-of-range stars and a bad fountain id (hostile input)", async () => {
    expect(await submitRating(FID, [{ rating_type_id: 1, stars: 9 }])).toEqual({
      ok: false,
      error: "validation",
    });
    expect(await submitRating("not-a-uuid", [{ rating_type_id: 1, stars: 3 }])).toEqual({
      ok: false,
      error: "validation",
    });
  });
  it("posts and revalidates on success", async () => {
    POST.mockResolvedValue({ response: { status: 200 } });
    const res = await submitRating(FID, [{ rating_type_id: 1, stars: 4 }]);
    expect(res).toEqual({ ok: true });
    expect(POST).toHaveBeenCalledWith(
      "/api/v1/fountains/{fountain_id}/ratings",
      expect.objectContaining({
        params: { path: { fountain_id: FID } },
        body: { ratings: [{ rating_type_id: 1, stars: 4 }] },
      }),
    );
    expect(revalidatePath).toHaveBeenCalledWith(`/fountains/${FID}`);
  });
  it("maps status codes to errors", async () => {
    POST.mockResolvedValue({ response: { status: 401 } });
    expect(await submitRating(FID, [{ rating_type_id: 1, stars: 4 }])).toEqual({
      ok: false,
      error: "unauthenticated",
    });
    POST.mockResolvedValue({ response: { status: 404 } });
    expect(await submitRating(FID, [{ rating_type_id: 1, stars: 4 }])).toEqual({
      ok: false,
      error: "not_found",
    });
    POST.mockResolvedValue({ response: { status: 503 } });
    expect(await submitRating(FID, [{ rating_type_id: 1, stars: 4 }])).toEqual({
      ok: false,
      error: "server",
    });
    // 409 on a rating is unambiguously the name gate.
    POST.mockResolvedValue({ response: { status: 409 } });
    expect(await submitRating(FID, [{ rating_type_id: 1, stars: 4 }])).toEqual({
      ok: false,
      error: "needs_name",
    });
  });
  it("treats a thrown token error as unauthenticated", async () => {
    getClient.mockRejectedValueOnce(new Error("no token"));
    expect(await submitRating(FID, [{ rating_type_id: 1, stars: 4 }])).toEqual({
      ok: false,
      error: "unauthenticated",
    });
  });
  it("maps a POST/network throw to server (NOT unauthenticated)", async () => {
    POST.mockRejectedValueOnce(new Error("ECONNREFUSED"));
    expect(await submitRating(FID, [{ rating_type_id: 1, stars: 4 }])).toEqual({
      ok: false,
      error: "server",
    });
  });
  it("rejects a non-positive rating_type_id (hostile input)", async () => {
    expect(await submitRating(FID, [{ rating_type_id: 0, stars: 4 }])).toEqual({
      ok: false,
      error: "validation",
    });
    expect(getClient).not.toHaveBeenCalled();
  });
});

describe("submitCondition", () => {
  it("rejects an unknown status", async () => {
    // @ts-expect-error hostile input
    expect(await submitCondition(FID, "explode")).toEqual({ ok: false, error: "validation" });
  });
  it("posts is_proximate:false", async () => {
    POST.mockResolvedValue({ response: { status: 200 } });
    await submitCondition(FID, "working");
    expect(POST).toHaveBeenCalledWith(
      "/api/v1/fountains/{fountain_id}/conditions",
      expect.objectContaining({ body: { status: "working", is_proximate: false } }),
    );
  });
});

describe("submitNote", () => {
  it("rejects empty/whitespace and >1000 chars", async () => {
    expect(await submitNote(FID, "   ")).toEqual({ ok: false, error: "validation" });
    expect(await submitNote(FID, "a".repeat(1001))).toEqual({ ok: false, error: "validation" });
    expect(getClient).not.toHaveBeenCalled();
  });
  it("trims and posts", async () => {
    POST.mockResolvedValue({ response: { status: 200 } });
    await submitNote(FID, "  hi  ");
    expect(POST).toHaveBeenCalledWith(
      "/api/v1/fountains/{fountain_id}/notes",
      expect.objectContaining({ body: { body: "hi" } }),
    );
  });
});

describe("submitAttributes", () => {
  it("rejects empty observations and invalid ids", async () => {
    expect(await submitAttributes(FID, [])).toEqual({ ok: false, error: "validation" });
    expect(await submitAttributes(FID, [{ attribute_type_id: 0, value: "yes" }])).toEqual({
      ok: false,
      error: "validation",
    });
    expect(getClient).not.toHaveBeenCalled();
  });

  it("trims and posts observations", async () => {
    POST.mockResolvedValue({ response: { status: 200 } });
    await submitAttributes(FID, [{ attribute_type_id: 2, value: " yes " }]);
    expect(POST).toHaveBeenCalledWith(
      "/api/v1/fountains/{fountain_id}/attributes",
      expect.objectContaining({
        params: { path: { fountain_id: FID } },
        body: { observations: [{ attribute_type_id: 2, value: "yes" }] },
      }),
    );
  });
});

describe("uploadPhoto", () => {
  const FORM = new FormData();

  it("rejects a bad fountain id before touching the token/fetch", async () => {
    expect(await uploadPhoto("not-a-uuid", FORM)).toEqual({ ok: false, error: "validation" });
    expect(getActionAccessToken).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("treats a thrown token error as unauthenticated", async () => {
    getActionAccessToken.mockRejectedValueOnce(new Error("no token"));
    expect(await uploadPhoto(FID, FORM)).toEqual({ ok: false, error: "unauthenticated" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("posts multipart with a bearer token and no explicit Content-Type, and revalidates on 201", async () => {
    fetchMock.mockResolvedValue({ status: 201, json: async () => ({}) });
    const res = await uploadPhoto(FID, FORM);
    expect(res).toEqual({ ok: true });
    expect(fetchMock).toHaveBeenCalledWith(
      `https://api.test/api/v1/fountains/${FID}/photos`,
      expect.objectContaining({
        method: "POST",
        body: FORM,
        headers: expect.objectContaining({ Authorization: "Bearer test-token" }),
      }),
    );
    const [, init] = fetchMock.mock.calls[0];
    expect(Object.keys(init.headers)).not.toContain("Content-Type");
    expect(revalidatePath).toHaveBeenCalledWith(`/fountains/${FID}`);
    expect(revalidatePath).toHaveBeenCalledWith("/");
  });

  it("maps a network throw to server", async () => {
    fetchMock.mockRejectedValueOnce(new Error("ECONNREFUSED"));
    expect(await uploadPhoto(FID, FORM)).toEqual({ ok: false, error: "server" });
  });

  it("maps 413/415 to file_invalid and 429 to rate_limited", async () => {
    fetchMock.mockResolvedValue({ status: 413, json: async () => ({}) });
    expect(await uploadPhoto(FID, FORM)).toEqual({ ok: false, error: "file_invalid" });
    fetchMock.mockResolvedValue({ status: 415, json: async () => ({}) });
    expect(await uploadPhoto(FID, FORM)).toEqual({ ok: false, error: "file_invalid" });
    fetchMock.mockResolvedValue({ status: 429, json: async () => ({}) });
    expect(await uploadPhoto(FID, FORM)).toEqual({ ok: false, error: "rate_limited" });
  });

  it("distinguishes the two 409 shapes by body detail", async () => {
    fetchMock.mockResolvedValue({
      status: 409,
      json: async () => ({ detail: "display_name_required" }),
    });
    expect(await uploadPhoto(FID, FORM)).toEqual({ ok: false, error: "needs_name" });

    fetchMock.mockResolvedValue({
      status: 409,
      json: async () => ({ detail: "photo_limit_fountain" }),
    });
    expect(await uploadPhoto(FID, FORM)).toEqual({ ok: false, error: "photo_limit" });

    fetchMock.mockResolvedValue({
      status: 409,
      json: async () => ({ detail: "photo_limit_user" }),
    });
    expect(await uploadPhoto(FID, FORM)).toEqual({ ok: false, error: "photo_limit" });
  });

  it("falls back to needs_name if the 409 body cannot be parsed", async () => {
    fetchMock.mockResolvedValue({
      status: 409,
      json: async () => {
        throw new Error("bad json");
      },
    });
    expect(await uploadPhoto(FID, FORM)).toEqual({ ok: false, error: "needs_name" });
  });
});

describe("reportPhoto", () => {
  it("rejects bad ids and an unknown category before any API call", async () => {
    expect(await reportPhoto("not-a-uuid", PID, "spam")).toEqual({
      ok: false,
      error: "validation",
    });
    expect(await reportPhoto(FID, "not-a-uuid", "spam")).toEqual({
      ok: false,
      error: "validation",
    });
    // @ts-expect-error hostile input
    expect(await reportPhoto(FID, PID, "explode")).toEqual({ ok: false, error: "validation" });
    expect(getClient).not.toHaveBeenCalled();
  });

  it("posts the category and trimmed note", async () => {
    POST.mockResolvedValue({ response: { status: 204 } });
    await reportPhoto(FID, PID, "spam", "  looks fake  ");
    expect(POST).toHaveBeenCalledWith(
      "/api/v1/fountains/{fountain_id}/photos/{photo_id}/report",
      expect.objectContaining({
        params: { path: { fountain_id: FID, photo_id: PID } },
        body: { category: "spam", note: "looks fake" },
      }),
    );
  });

  it("maps 429 to rate_limited", async () => {
    POST.mockResolvedValue({ response: { status: 429 } });
    expect(await reportPhoto(FID, PID, "spam")).toEqual({ ok: false, error: "rate_limited" });
  });
});

describe("deleteOwnPhoto", () => {
  it("rejects bad ids before any API call", async () => {
    expect(await deleteOwnPhoto("not-a-uuid", PID)).toEqual({ ok: false, error: "validation" });
    expect(getClient).not.toHaveBeenCalled();
  });

  it("deletes and revalidates on success", async () => {
    DELETE.mockResolvedValue({ response: { status: 204 } });
    const res = await deleteOwnPhoto(FID, PID);
    expect(res).toEqual({ ok: true });
    expect(DELETE).toHaveBeenCalledWith(
      "/api/v1/fountains/{fountain_id}/photos/{photo_id}",
      expect.objectContaining({ params: { path: { fountain_id: FID, photo_id: PID } } }),
    );
    expect(revalidatePath).toHaveBeenCalledWith(`/fountains/${FID}`);
  });
});
