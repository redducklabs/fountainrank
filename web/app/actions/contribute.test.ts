import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { POST, getClient, revalidatePath, log } = vi.hoisted(() => ({
  POST: vi.fn(),
  getClient: vi.fn(),
  revalidatePath: vi.fn(),
  log: vi.fn(),
}));
vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath }));
vi.mock("../../lib/server/api", () => ({ getAuthedApiClientForAction: getClient }));
vi.mock("../../lib/server/log", () => ({ log }));

import { submitAttributes, submitRating, submitCondition, submitNote } from "./contribute";

const FID = "123e4567-e89b-12d3-a456-426614174000";
beforeEach(() => {
  getClient.mockImplementation(async () => ({ POST }));
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
