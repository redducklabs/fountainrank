import { describe, expect, it } from "vitest";

import { ApiError, ApiTimeoutError } from "./api";
import { AuthSessionError } from "./auth/state";
import { resolveViewState } from "./view-state";

describe("resolveViewState", () => {
  it("is loading while the query is pending", () => {
    expect(resolveViewState({ isLoading: true, isError: false })).toBe("loading");
  });

  it("is offline for a network error with no HTTP status", () => {
    const err = new TypeError("Network request failed");
    expect(resolveViewState({ isLoading: false, isError: true, error: err })).toBe("offline");
  });

  it("is offline for a client-side request timeout (ApiTimeoutError has no HTTP status)", () => {
    const err = new ApiTimeoutError("POST", "/api/v1/fountains", 30_000);
    expect(resolveViewState({ isLoading: false, isError: true, error: err })).toBe("offline");
  });

  it("is error for an HTTP error carrying a status (ApiError)", () => {
    expect(resolveViewState({ isLoading: false, isError: true, error: new ApiError(500) })).toBe(
      "error",
    );
  });

  it("is error for an auth/session failure, not offline", () => {
    expect(
      resolveViewState({
        isLoading: false,
        isError: true,
        error: new AuthSessionError("token_unavailable"),
      }),
    ).toBe("error");
  });

  it("is empty when the result set is empty", () => {
    expect(resolveViewState({ isLoading: false, isError: false, isEmpty: true })).toBe("empty");
  });

  it("is ready when data is present", () => {
    expect(resolveViewState({ isLoading: false, isError: false, isEmpty: false })).toBe("ready");
  });

  it("treats loading as taking precedence over a stale error", () => {
    expect(resolveViewState({ isLoading: true, isError: true, error: new ApiError(500) })).toBe(
      "loading",
    );
  });
});
