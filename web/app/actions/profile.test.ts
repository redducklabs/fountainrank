import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { PATCH, getClient, revalidatePath, log } = vi.hoisted(() => ({
  PATCH: vi.fn(),
  getClient: vi.fn(),
  revalidatePath: vi.fn(),
  log: vi.fn(),
}));
vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath }));
vi.mock("../../lib/server/api", () => ({ getAuthedApiClientForAction: getClient }));
vi.mock("../../lib/server/log", () => ({ log }));

import { setDisplayName } from "./profile";

beforeEach(() => {
  getClient.mockImplementation(async () => ({ PATCH }));
});
afterEach(() => vi.clearAllMocks());

describe("setDisplayName", () => {
  it("validates BEFORE any API call (blank, too long)", async () => {
    expect(await setDisplayName("   ")).toEqual({ ok: false, error: "validation" });
    expect(await setDisplayName("x".repeat(81))).toEqual({ ok: false, error: "validation" });
    expect(getClient).not.toHaveBeenCalled();
  });

  it("trims and PATCHes /me, revalidating on success", async () => {
    PATCH.mockResolvedValue({ response: { status: 200 } });
    const res = await setDisplayName("  Aron  ");
    expect(res).toEqual({ ok: true });
    expect(PATCH).toHaveBeenCalledWith(
      "/api/v1/me",
      expect.objectContaining({ body: { display_name: "Aron" } }),
    );
    expect(revalidatePath).toHaveBeenCalledWith("/account");
    expect(revalidatePath).toHaveBeenCalledWith("/leaderboard");
  });

  it("maps status codes to errors", async () => {
    PATCH.mockResolvedValue({ response: { status: 401 } });
    expect(await setDisplayName("Aron")).toEqual({ ok: false, error: "unauthenticated" });
    PATCH.mockResolvedValue({ response: { status: 422 } });
    expect(await setDisplayName("Aron")).toEqual({ ok: false, error: "validation" });
    PATCH.mockResolvedValue({ response: { status: 500 } });
    expect(await setDisplayName("Aron")).toEqual({ ok: false, error: "server" });
  });

  it("treats a thrown token error as unauthenticated", async () => {
    getClient.mockRejectedValueOnce(new Error("no token"));
    expect(await setDisplayName("Aron")).toEqual({ ok: false, error: "unauthenticated" });
  });

  it("maps a PATCH/network throw to server (NOT unauthenticated)", async () => {
    PATCH.mockRejectedValueOnce(new Error("ECONNREFUSED"));
    expect(await setDisplayName("Aron")).toEqual({ ok: false, error: "server" });
  });
});
