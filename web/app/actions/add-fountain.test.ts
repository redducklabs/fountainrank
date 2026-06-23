import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { POST, getClient, log } = vi.hoisted(() => ({
  POST: vi.fn(),
  getClient: vi.fn(),
  log: vi.fn(),
}));
vi.mock("server-only", () => ({}));
vi.mock("../../lib/server/api", () => ({ getAuthedApiClientForAction: getClient }));
vi.mock("../../lib/server/log", () => ({ log }));

import { addFountain } from "./add-fountain";
import type { AddFountainInput } from "../../lib/add-fountain";

const NEW_ID = "123e4567-e89b-12d3-a456-426614174000";
const DUP_ID = "223e4567-e89b-12d3-a456-426614174000";
const input: AddFountainInput = {
  location: { latitude: 47.6, longitude: -122.3 },
  is_working: true,
};

beforeEach(() => getClient.mockImplementation(async () => ({ POST })));
afterEach(() => vi.clearAllMocks());

describe("addFountain", () => {
  it("rejects hostile/malformed payloads BEFORE any API call", async () => {
    const hostile: unknown[] = [
      null,
      [],
      { is_working: true },
      { location: { latitude: 999, longitude: 0 }, is_working: true },
      { location: { latitude: 1, longitude: 1 }, is_working: "x" },
      { location: { latitude: 1, longitude: 1 }, is_working: true, ratings: "nope" },
      { location: { latitude: 1, longitude: 1 }, is_working: true, comments: "x".repeat(1001) },
    ];
    for (const bad of hostile) {
      expect(await addFountain(bad as AddFountainInput)).toEqual({
        ok: false,
        error: "validation",
      });
    }
    expect(getClient).not.toHaveBeenCalled();
  });

  it("returns the new id on 201 and posts the expected body", async () => {
    POST.mockResolvedValue({ data: { id: NEW_ID }, error: undefined, response: { status: 201 } });
    expect(await addFountain(input)).toEqual({ ok: true, fountainId: NEW_ID });
    expect(POST).toHaveBeenCalledWith(
      "/api/v1/fountains",
      expect.objectContaining({ body: { location: input.location, is_working: true } }),
    );
  });

  it("reads the duplicate id from the error side on 409", async () => {
    POST.mockResolvedValue({
      data: undefined,
      error: { detail: "duplicate_fountain", fountain_id: DUP_ID },
      response: { status: 409 },
    });
    expect(await addFountain(input)).toEqual({ ok: false, error: "duplicate", fountainId: DUP_ID });
  });

  it("treats a malformed 409 body as server (never a duplicate with an undefined route)", async () => {
    POST.mockResolvedValue({ data: undefined, error: { detail: "x" }, response: { status: 409 } });
    expect(await addFountain(input)).toEqual({ ok: false, error: "server" });
  });

  it("maps 401/422/5xx (each HTTP non-success status logs a warn with status)", async () => {
    POST.mockResolvedValue({ error: {}, response: { status: 401 } });
    expect(await addFountain(input)).toEqual({ ok: false, error: "unauthenticated" });
    POST.mockResolvedValue({ error: {}, response: { status: 422 } });
    expect(await addFountain(input)).toEqual({ ok: false, error: "validation" });
    POST.mockResolvedValue({ error: {}, response: { status: 503 } });
    expect(await addFountain(input)).toEqual({ ok: false, error: "server" });
    // every non-success branch logged with a status field
    expect(log.mock.calls.every((c) => c[0] === "warn")).toBe(true);
    expect(log.mock.calls.some((c) => c[2]?.status === 401)).toBe(true);
  });

  it("treats a thrown token error as unauthenticated and a POST throw as server", async () => {
    getClient.mockRejectedValueOnce(new Error("no token"));
    expect(await addFountain(input)).toEqual({ ok: false, error: "unauthenticated" });
    POST.mockRejectedValueOnce(new Error("ECONNREFUSED"));
    expect(await addFountain(input)).toEqual({ ok: false, error: "server" });
  });

  it("never logs coordinates, comments, or placement notes", async () => {
    POST.mockResolvedValue({ data: { id: NEW_ID }, response: { status: 201 } });
    await addFountain({ ...input, comments: "secret comment", placement_note: "by the gate" });
    const logged = JSON.stringify(log.mock.calls);
    expect(logged).not.toContain("secret comment");
    expect(logged).not.toContain("by the gate");
    expect(logged).not.toContain("47.6");
  });
});
