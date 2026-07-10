import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { DELETE, PATCH, getClient, revalidatePath, log, signOut } = vi.hoisted(() => ({
  DELETE: vi.fn(),
  PATCH: vi.fn(),
  getClient: vi.fn(),
  revalidatePath: vi.fn(),
  log: vi.fn(),
  signOut: vi.fn(),
}));
vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath }));
vi.mock("@logto/next/server-actions", () => ({ signOut }));
vi.mock("../../lib/logto", () => ({
  getLogtoConfig: () => ({ baseUrl: "https://fountainrank.com" }),
}));
vi.mock("../../lib/server/api", () => ({ getAuthedApiClientForAction: getClient }));
vi.mock("../../lib/server/log", () => ({ log }));

import { deleteAccount, setDisplayName } from "./profile";

beforeEach(() => {
  getClient.mockImplementation(async () => ({ DELETE, PATCH }));
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

describe("deleteAccount", () => {
  it("DELETEs /me and signs out on success", async () => {
    DELETE.mockResolvedValue({ response: { status: 204 } });
    signOut.mockResolvedValue(undefined);

    await expect(deleteAccount()).resolves.toEqual({ ok: true });

    expect(DELETE).toHaveBeenCalledWith("/api/v1/me");
    expect(signOut).toHaveBeenCalledWith(
      { baseUrl: "https://fountainrank.com" },
      "https://fountainrank.com",
    );
  });

  it("does not catch the sign-out redirect after successful deletion", async () => {
    const redirect = new Error("NEXT_REDIRECT");
    DELETE.mockResolvedValue({ response: { status: 204 } });
    signOut.mockRejectedValueOnce(redirect);

    await expect(deleteAccount()).rejects.toThrow("NEXT_REDIRECT");
  });

  it("maps auth failures before the API call", async () => {
    getClient.mockRejectedValueOnce(new Error("no token"));
    await expect(deleteAccount()).resolves.toEqual({ ok: false, error: "unauthenticated" });
    expect(DELETE).not.toHaveBeenCalled();
  });

  it("maps backend delete status codes", async () => {
    DELETE.mockResolvedValue({ response: { status: 401 } });
    await expect(deleteAccount()).resolves.toEqual({ ok: false, error: "unauthenticated" });

    DELETE.mockResolvedValue({ response: { status: 500 } });
    await expect(deleteAccount()).resolves.toEqual({ ok: false, error: "server" });
  });
});
