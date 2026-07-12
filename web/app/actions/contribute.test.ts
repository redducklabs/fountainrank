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
  reportContent,
  deleteOwnPhoto,
} from "./contribute";

const FID = "123e4567-e89b-12d3-a456-426614174000";
const PID = "223e4567-e89b-12d3-a456-426614174000";
const NID = "323e4567-e89b-12d3-a456-426614174000";
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
    // pointsAwarded is now always present and server-derived (#204). This mock returns no body,
    // so the award is an unverifiable 0 — which is exactly what suppresses the celebration.
    expect(res).toEqual({ ok: true, pointsAwarded: 0 });
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
    // 403 = outside the 50 mi rating radius (#3).
    POST.mockResolvedValue({ response: { status: 403 } });
    expect(await submitRating(FID, [{ rating_type_id: 1, stars: 4 }])).toEqual({
      ok: false,
      error: "too_far",
    });
  });
  it("passes coordinates through to the body when supplied (#3)", async () => {
    POST.mockResolvedValue({ response: { status: 200 } });
    await submitRating(FID, [{ rating_type_id: 1, stars: 4 }], { latitude: 40, longitude: -73 });
    expect(POST).toHaveBeenCalledWith(
      "/api/v1/fountains/{fountain_id}/ratings",
      expect.objectContaining({
        body: { ratings: [{ rating_type_id: 1, stars: 4 }], latitude: 40, longitude: -73 },
      }),
    );
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
  it("posts status only when no coordinates are supplied (is_proximate is server-derived, #3)", async () => {
    POST.mockResolvedValue({ response: { status: 200 } });
    await submitCondition(FID, "working");
    expect(POST).toHaveBeenCalledWith(
      "/api/v1/fountains/{fountain_id}/conditions",
      expect.objectContaining({ body: { status: "working" } }),
    );
  });
  it("passes coordinates through when supplied (#3)", async () => {
    POST.mockResolvedValue({ response: { status: 200 } });
    await submitCondition(FID, "working", { latitude: 5, longitude: 6 });
    expect(POST).toHaveBeenCalledWith(
      "/api/v1/fountains/{fountain_id}/conditions",
      expect.objectContaining({ body: { status: "working", latitude: 5, longitude: 6 } }),
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
    expect(res).toEqual({ ok: true, pointsAwarded: 0 });
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

describe("reportContent", () => {
  it("rejects bad ids and a per-type-invalid category before any API call", async () => {
    expect(await reportContent("photo", "not-a-uuid", PID, "spam")).toEqual({
      ok: false,
      error: "validation",
    });
    expect(await reportContent("photo", FID, "not-a-uuid", "spam")).toEqual({
      ok: false,
      error: "validation",
    });
    // `abuse` is valid for a note but NOT for a photo (per-type sets, spec §6).
    expect(await reportContent("photo", FID, PID, "abuse")).toEqual({
      ok: false,
      error: "validation",
    });
    // @ts-expect-error hostile content type
    expect(await reportContent("rating", FID, PID, "spam")).toEqual({
      ok: false,
      error: "validation",
    });
    expect(getClient).not.toHaveBeenCalled();
  });

  it("photo -> POSTs the nested photo report endpoint with trimmed note", async () => {
    POST.mockResolvedValue({ response: { status: 204 } });
    await reportContent("photo", FID, PID, "spam", "  looks fake  ");
    expect(POST).toHaveBeenCalledWith(
      "/api/v1/fountains/{fountain_id}/photos/{photo_id}/report",
      expect.objectContaining({
        params: { path: { fountain_id: FID, photo_id: PID } },
        body: { category: "spam", note: "looks fake" },
      }),
    );
  });

  it("note -> POSTs the nested note report endpoint", async () => {
    POST.mockResolvedValue({ response: { status: 204 } });
    await reportContent("note", FID, NID, "abuse", "  bad  ");
    expect(POST).toHaveBeenCalledWith(
      "/api/v1/fountains/{fountain_id}/notes/{note_id}/report",
      expect.objectContaining({
        params: { path: { fountain_id: FID, note_id: NID } },
        body: { category: "abuse", note: "bad" },
      }),
    );
  });

  it("fountain -> POSTs the fountain report endpoint (no separate content-id param)", async () => {
    POST.mockResolvedValue({ response: { status: 204 } });
    await reportContent("fountain", FID, FID, "not_a_fountain");
    expect(POST).toHaveBeenCalledWith(
      "/api/v1/fountains/{fountain_id}/report",
      expect.objectContaining({
        params: { path: { fountain_id: FID } },
        body: { category: "not_a_fountain", note: undefined },
      }),
    );
  });

  it("maps 429 to rate_limited", async () => {
    POST.mockResolvedValue({ response: { status: 429 } });
    expect(await reportContent("photo", FID, PID, "spam")).toEqual({
      ok: false,
      error: "rate_limited",
    });
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
    expect(res).toEqual({ ok: true, pointsAwarded: 0 }); // a delete never awards
    expect(DELETE).toHaveBeenCalledWith(
      "/api/v1/fountains/{fountain_id}/photos/{photo_id}",
      expect.objectContaining({ params: { path: { fountain_id: FID, photo_id: PID } } }),
    );
    expect(revalidatePath).toHaveBeenCalledWith(`/fountains/${FID}`);
  });
});

describe("pointsAwarded (server-authoritative, #204)", () => {
  it("reads the canonical points_awarded off the response body", async () => {
    POST.mockResolvedValue({ response: { status: 200 }, data: { points_awarded: 9 } });
    const res = await submitRating(FID, [{ rating_type_id: 1, stars: 4 }]);
    expect(res).toEqual({ ok: true, pointsAwarded: 9 });
  });

  it("reports 0 when the write deduped — the case that used to fake a full award", async () => {
    POST.mockResolvedValue({ response: { status: 200 }, data: { points_awarded: 0 } });
    const res = await submitRating(FID, [{ rating_type_id: 1, stars: 4 }]);
    expect(res).toEqual({ ok: true, pointsAwarded: 0 });
  });

  it("falls back to the deprecated condition field only when the canonical key is ABSENT", async () => {
    POST.mockResolvedValue({ response: { status: 200 }, data: { condition_points_awarded: 3 } });
    const res = await submitCondition(FID, "working");
    expect(res).toEqual({ ok: true, pointsAwarded: 3 });
  });

  it("treats a NULL canonical field as 0 — it does NOT fall through to the legacy field", async () => {
    // The case a `??` implementation gets wrong: it would celebrate 3. Presence, not nullishness.
    POST.mockResolvedValue({
      response: { status: 200 },
      data: { points_awarded: null, condition_points_awarded: 3 },
    });
    const res = await submitCondition(FID, "working");
    expect(res).toEqual({ ok: true, pointsAwarded: 0 });
  });
});
