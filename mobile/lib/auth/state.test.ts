import { describe, expect, it, vi } from "vitest";

import {
  AuthSessionError,
  isAuthSessionError,
  isSignInCancel,
  resolveAuthStatus,
  runSignIn,
  shouldEnableProfileQuery,
  shouldRetryProfileQuery,
} from "./state";

describe("runSignIn", () => {
  it("does not call the SDK when auth is unconfigured", async () => {
    const signIn = vi.fn();
    await expect(runSignIn(false, "app://callback", signIn)).resolves.toEqual({
      status: "unconfigured",
    });
    expect(signIn).not.toHaveBeenCalled();
  });

  it("calls the SDK string overload with the exact redirect URI", async () => {
    const signIn = vi.fn<(redirectUri: string) => Promise<void>>().mockResolvedValue(undefined);
    await expect(runSignIn(true, "app://callback", signIn)).resolves.toEqual({
      status: "success",
    });
    expect(signIn).toHaveBeenCalledWith("app://callback");
  });

  it("classifies browser cancellation separately from SDK errors", async () => {
    await expect(
      runSignIn(true, "app://callback", vi.fn().mockRejectedValue({ code: "auth_session_failed" })),
    ).resolves.toEqual({ status: "cancelled" });

    const error = new Error("bad verifier");
    await expect(
      runSignIn(true, "app://callback", vi.fn().mockRejectedValue(error)),
    ).resolves.toEqual({ status: "error", error });
  });
});

describe("auth state helpers", () => {
  it("resolves configured and session states in priority order", () => {
    expect(
      resolveAuthStatus({
        isConfigured: false,
        isInitialized: true,
        isAuthenticated: true,
        isSigningIn: false,
        reauthRequired: false,
      }),
    ).toBe("unconfigured");
    expect(
      resolveAuthStatus({
        isConfigured: true,
        isInitialized: true,
        isAuthenticated: true,
        isSigningIn: false,
        reauthRequired: true,
      }),
    ).toBe("reauthRequired");
    expect(
      resolveAuthStatus({
        isConfigured: true,
        isInitialized: true,
        isAuthenticated: false,
        isSigningIn: true,
        reauthRequired: false,
      }),
    ).toBe("signingIn");
    expect(
      resolveAuthStatus({
        isConfigured: true,
        isInitialized: false,
        isAuthenticated: false,
        isSigningIn: false,
        reauthRequired: false,
      }),
    ).toBe("initializing");
    expect(
      resolveAuthStatus({
        isConfigured: true,
        isInitialized: true,
        isAuthenticated: true,
        isSigningIn: false,
        reauthRequired: false,
      }),
    ).toBe("authenticated");
  });

  it("enables profile reads only for usable authenticated sessions", () => {
    expect(shouldEnableProfileQuery("authenticated")).toBe(true);
    expect(shouldEnableProfileQuery("reauthRequired")).toBe(false);
    expect(shouldEnableProfileQuery("signedOut")).toBe(false);
  });

  it("does not retry auth/session failures as network failures", () => {
    expect(shouldRetryProfileQuery(new AuthSessionError("token_unavailable"), 0)).toBe(false);
    expect(shouldRetryProfileQuery({ status: 401 }, 0)).toBe(false);
    expect(shouldRetryProfileQuery(new Error("offline"), 0)).toBe(true);
    expect(shouldRetryProfileQuery(new Error("offline"), 1)).toBe(false);
  });

  it("recognizes auth session errors and cancellation-shaped errors", () => {
    expect(isAuthSessionError(new AuthSessionError("reauth_required"))).toBe(true);
    expect(isSignInCancel({ message: "User dismissed browser" })).toBe(true);
    expect(isSignInCancel(new Error("invalid state"))).toBe(false);
  });
});
