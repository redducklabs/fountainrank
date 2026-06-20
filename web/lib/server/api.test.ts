import { afterEach, describe, expect, it, vi } from "vitest";

// vi.mock factories are hoisted above top-level consts, so the mock fns must come from
// vi.hoisted() (also hoisted) — a plain `const x = vi.fn()` would be undefined at mock time.
const { getAccessTokenRSC, makeClient } = vi.hoisted(() => ({
  getAccessTokenRSC: vi.fn(),
  makeClient: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("@logto/next/server-actions", () => ({ getAccessTokenRSC }));
vi.mock("@fountainrank/api-client", () => ({ makeClient }));

import { authedClientHeaders, getAuthedApiClient } from "./api";
import { API_RESOURCE } from "../logto";

const ENV = {
  LOGTO_ENDPOINT: "https://auth.fountainrank.com",
  LOGTO_APP_ID: "app123",
  LOGTO_APP_SECRET: "secret",
  LOGTO_BASE_URL: "https://fountainrank.com",
  LOGTO_COOKIE_SECRET: "x".repeat(32),
  NEXT_PUBLIC_API_BASE_URL: "https://api.fountainrank.com",
};

afterEach(() => {
  vi.unstubAllEnvs();
  vi.clearAllMocks();
});

describe("authedClientHeaders", () => {
  it("sets Bearer auth + request id", () => {
    expect(authedClientHeaders("tok-123", "rid-1")).toEqual({
      Authorization: "Bearer tok-123",
      "X-Request-ID": "rid-1",
    });
  });
});

describe("getAuthedApiClient", () => {
  it("mints an RSC token for the API resource and attaches it to the client", async () => {
    for (const [k, v] of Object.entries(ENV)) vi.stubEnv(k, v);
    getAccessTokenRSC.mockResolvedValue("tok-123");
    const sentinel = { GET: vi.fn() };
    makeClient.mockReturnValue(sentinel);

    const client = await getAuthedApiClient("rid-1");

    expect(getAccessTokenRSC).toHaveBeenCalledWith(
      expect.objectContaining({ resources: [API_RESOURCE] }),
      API_RESOURCE,
    );
    expect(makeClient).toHaveBeenCalledWith("https://api.fountainrank.com", {
      headers: { Authorization: "Bearer tok-123", "X-Request-ID": "rid-1" },
    });
    expect(client).toBe(sentinel);
  });
});
