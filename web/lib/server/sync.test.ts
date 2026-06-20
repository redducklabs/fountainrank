import { readFileSync } from "node:fs";

import { afterEach, describe, expect, it, vi } from "vitest";

const { getAccessTokenRSC } = vi.hoisted(() => ({ getAccessTokenRSC: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("@logto/next/server-actions", () => ({ getAccessTokenRSC }));

import { syncProfile } from "./sync";

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
