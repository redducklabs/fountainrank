import { readFileSync } from "node:fs";

import { afterEach, describe, expect, it, vi } from "vitest";

const { getAccessTokenRSC, getAccessToken } = vi.hoisted(() => ({
  getAccessTokenRSC: vi.fn(),
  getAccessToken: vi.fn(),
}));
vi.mock("server-only", () => ({}));
vi.mock("@logto/next/server-actions", () => ({ getAccessTokenRSC, getAccessToken }));

import { syncProfile, syncProfileForRoute } from "./sync";

const ENV = {
  LOGTO_ENDPOINT: "https://auth.fountainrank.com",
  LOGTO_APP_ID: "app123",
  LOGTO_APP_SECRET: "secret",
  LOGTO_BASE_URL: "https://fountainrank.com",
  LOGTO_COOKIE_SECRET: "x".repeat(32),
  NEXT_PUBLIC_API_BASE_URL: "https://api.fountainrank.com",
};

function stubEnv() {
  for (const [k, v] of Object.entries(ENV)) vi.stubEnv(k, v);
}

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  vi.clearAllMocks();
});

describe("sync helper", () => {
  it("is guarded with server-only", () => {
    expect(readFileSync("lib/server/sync.ts", "utf8").trimStart()).toMatch(/^import "server-only"/);
  });

  it("POSTs the userinfo token to /api/v1/me/sync with the resource bearer", async () => {
    stubEnv();
    getAccessTokenRSC.mockImplementation(async (_c: unknown, resource?: string) =>
      resource ? "resource-tok" : "opaque-tok",
    );
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200 });
    vi.stubGlobal("fetch", fetchMock);

    await syncProfile("rid-1");

    expect(fetchMock).toHaveBeenCalledWith(
      "https://api.fountainrank.com/api/v1/me/sync",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          Authorization: "Bearer resource-tok",
          "X-Request-ID": "rid-1",
        }),
        body: JSON.stringify({ userinfo_token: "opaque-tok" }),
      }),
    );
  });

  it("logs redacted warning on non-200 (no token in output)", async () => {
    stubEnv();
    getAccessTokenRSC.mockImplementation(async (_c: unknown, resource?: string) =>
      resource ? "resource-tok" : "opaque-tok",
    );
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 502 }));
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});

    await syncProfile("rid-2");

    const out = spy.mock.calls.map((c) => String(c[0])).join("");
    expect(out).not.toContain("resource-tok");
    expect(out).not.toContain("opaque-tok");
  });

  it.each([429, 502])(
    "keeps account sync best-effort on %i without retrying or clearing the session",
    async (status) => {
      stubEnv();
      getAccessTokenRSC.mockImplementation(async (_c: unknown, resource?: string) =>
        resource ? "resource-tok" : "opaque-tok",
      );
      const fetchMock = vi.fn().mockResolvedValue({ ok: false, status });
      vi.stubGlobal("fetch", fetchMock);
      const spy = vi.spyOn(console, "error").mockImplementation(() => {});

      await expect(syncProfile(`rid-${status}`)).resolves.toBeUndefined();

      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(getAccessTokenRSC).toHaveBeenCalledTimes(2);
      expect(spy).toHaveBeenCalledTimes(1);
    },
  );

  it("swallows errors (best-effort, never throws; no token logged)", async () => {
    stubEnv();
    getAccessTokenRSC.mockRejectedValue(new Error("boom"));
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    await expect(syncProfile("rid-3")).resolves.toBeUndefined();
    const out = spy.mock.calls.map((c) => String(c[0])).join("");
    expect(out).not.toContain("resource-tok");
    expect(out).not.toContain("opaque-tok");
  });

  it("keeps tokens hidden when fetch throws AFTER both tokens are acquired", async () => {
    stubEnv();
    getAccessTokenRSC.mockImplementation(async (_c: unknown, resource?: string) =>
      resource ? "resource-tok" : "opaque-tok",
    );
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("network down")));
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    await expect(syncProfile("rid-4")).resolves.toBeUndefined();
    const out = spy.mock.calls.map((c) => String(c[0])).join("");
    expect(out).not.toContain("resource-tok");
    expect(out).not.toContain("opaque-tok");
  });
});

describe("syncProfileForRoute", () => {
  it("POSTs to /api/v1/me/sync using getAccessToken (route variant)", async () => {
    stubEnv();
    getAccessToken.mockImplementation(async (_c: unknown, resource?: string) =>
      resource ? "route-resource-tok" : "route-opaque-tok",
    );
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200 });
    vi.stubGlobal("fetch", fetchMock);

    await syncProfileForRoute("rid-r1");

    expect(fetchMock).toHaveBeenCalledWith(
      "https://api.fountainrank.com/api/v1/me/sync",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          Authorization: "Bearer route-resource-tok",
          "X-Request-ID": "rid-r1",
        }),
        body: JSON.stringify({ userinfo_token: "route-opaque-tok" }),
      }),
    );
  });

  it("never throws when getAccessToken rejects (best-effort)", async () => {
    stubEnv();
    getAccessToken.mockRejectedValue(new Error("token-error"));
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    await expect(syncProfileForRoute("rid-r2")).resolves.toBeUndefined();
    const out = spy.mock.calls.map((c) => String(c[0])).join("");
    expect(out).not.toContain("route-resource-tok");
    expect(out).not.toContain("route-opaque-tok");
  });

  it("never throws when fetch rejects after tokens are acquired (best-effort)", async () => {
    stubEnv();
    getAccessToken.mockImplementation(async (_c: unknown, resource?: string) =>
      resource ? "route-resource-tok" : "route-opaque-tok",
    );
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("network down")));
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    await expect(syncProfileForRoute("rid-r3")).resolves.toBeUndefined();
    const out = spy.mock.calls.map((c) => String(c[0])).join("");
    expect(out).not.toContain("route-resource-tok");
    expect(out).not.toContain("route-opaque-tok");
  });

  it("never throws on non-200 response", async () => {
    stubEnv();
    getAccessToken.mockImplementation(async (_c: unknown, resource?: string) =>
      resource ? "route-resource-tok" : "route-opaque-tok",
    );
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 503 }));
    await expect(syncProfileForRoute("rid-r4")).resolves.toBeUndefined();
  });

  it.each([429, 502])(
    "keeps callback sync best-effort on %i without retrying or clearing the session",
    async (status) => {
      stubEnv();
      getAccessToken.mockImplementation(async (_c: unknown, resource?: string) =>
        resource ? "route-resource-tok" : "route-opaque-tok",
      );
      const fetchMock = vi.fn().mockResolvedValue({ ok: false, status });
      vi.stubGlobal("fetch", fetchMock);
      const spy = vi.spyOn(console, "error").mockImplementation(() => {});

      await expect(syncProfileForRoute(`rid-route-${status}`)).resolves.toBeUndefined();

      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(getAccessToken).toHaveBeenCalledTimes(2);
      expect(spy).toHaveBeenCalledTimes(1);
    },
  );
});
