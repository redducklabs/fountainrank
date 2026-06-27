import { describe, expect, it, vi } from "vitest";

import { syncProfileOnSignIn } from "./sync";

const API = "https://api.fountainrank.com";

describe("syncProfileOnSignIn", () => {
  it("skips without a network call when the resource token is missing", async () => {
    const fetchImpl = vi.fn();
    const result = await syncProfileOnSignIn({
      apiBaseUrl: API,
      resourceToken: null,
      userinfoToken: "opaque",
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    expect(result).toBe("skipped");
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("skips without a network call when the opaque (userinfo) token is missing", async () => {
    const fetchImpl = vi.fn();
    const result = await syncProfileOnSignIn({
      apiBaseUrl: API,
      resourceToken: "jwt",
      userinfoToken: "",
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    expect(result).toBe("skipped");
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("POSTs the opaque token to /api/v1/me/sync, authenticated with the resource JWT", async () => {
    let url: string | undefined;
    let init: RequestInit | undefined;
    const fetchImpl = (async (u: string, i: RequestInit) => {
      url = u;
      init = i;
      return new Response(JSON.stringify({}), { status: 200 });
    }) as unknown as typeof fetch;

    const result = await syncProfileOnSignIn({
      apiBaseUrl: API,
      resourceToken: "jwt-resource",
      userinfoToken: "opaque-xyz",
      fetchImpl,
    });

    expect(result).toBe("synced");
    expect(url).toBe("https://api.fountainrank.com/api/v1/me/sync");
    expect(init?.method).toBe("POST");
    const headers = (init?.headers ?? {}) as Record<string, string>;
    expect(headers.Authorization).toBe("Bearer jwt-resource");
    expect(JSON.parse(String(init?.body))).toEqual({ userinfo_token: "opaque-xyz" });
  });

  it("never emits an X-Dev-* header (spec section 14 parity)", async () => {
    let init: RequestInit | undefined;
    const fetchImpl = (async (_u: string, i: RequestInit) => {
      init = i;
      return new Response("{}", { status: 200 });
    }) as unknown as typeof fetch;

    await syncProfileOnSignIn({
      apiBaseUrl: API,
      resourceToken: "jwt",
      userinfoToken: "op",
      fetchImpl,
    });

    const headerKeys = Object.keys((init?.headers ?? {}) as Record<string, string>).map((k) =>
      k.toLowerCase(),
    );
    expect(headerKeys.some((k) => k.startsWith("x-dev"))).toBe(false);
  });

  it("returns 'failed' (does not throw) on a non-OK backend response", async () => {
    const fetchImpl = (async () =>
      new Response("nope", { status: 502 })) as unknown as typeof fetch;
    const result = await syncProfileOnSignIn({
      apiBaseUrl: API,
      resourceToken: "jwt",
      userinfoToken: "op",
      fetchImpl,
    });
    expect(result).toBe("failed");
  });

  it("returns 'failed' (never throws) when the network rejects", async () => {
    const fetchImpl = (async () => {
      throw new TypeError("Network request failed");
    }) as unknown as typeof fetch;
    const result = await syncProfileOnSignIn({
      apiBaseUrl: API,
      resourceToken: "jwt",
      userinfoToken: "op",
      fetchImpl,
    });
    expect(result).toBe("failed");
  });
});
