import { afterEach, describe, expect, it, vi } from "vitest";

const { signIn, cookieSet, cookieDelete } = vi.hoisted(() => ({
  signIn: vi.fn(),
  cookieSet: vi.fn(),
  cookieDelete: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("@logto/next/server-actions", () => ({ signIn, signOut: vi.fn() }));
vi.mock("next/headers", () => ({
  cookies: async () => ({ set: cookieSet, delete: cookieDelete }),
}));
vi.mock("../../lib/logto", () => ({
  getLogtoConfig: () => ({ baseUrl: "https://fountainrank.com" }),
}));

import { signInWithReturn } from "./auth";

afterEach(() => vi.clearAllMocks());

describe("signInWithReturn", () => {
  it("sets the return cookie for a safe path then signs in", async () => {
    await signInWithReturn("/fountains/123e4567-e89b-12d3-a456-426614174000");
    expect(cookieSet).toHaveBeenCalledWith(
      "fr_return_to",
      "/fountains/123e4567-e89b-12d3-a456-426614174000",
      expect.objectContaining({ httpOnly: true, sameSite: "lax", path: "/", maxAge: 600 }),
    );
    expect(cookieDelete).not.toHaveBeenCalled();
    expect(signIn).toHaveBeenCalledWith(expect.anything(), "https://fountainrank.com/callback");
  });

  it("deletes any stale return cookie for an unsafe path and still signs in", async () => {
    await signInWithReturn("//evil.com");
    expect(cookieSet).not.toHaveBeenCalled();
    expect(cookieDelete).toHaveBeenCalledWith({ name: "fr_return_to", path: "/" });
    expect(signIn).toHaveBeenCalled();
  });
});
