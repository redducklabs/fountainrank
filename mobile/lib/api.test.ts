import { describe, expect, it } from "vitest";

import { AuthSessionError } from "./auth/state";
import { ApiError, apiErrorStatus, buildAuthHeaders, createApiClient, unwrap } from "./api";

describe("buildAuthHeaders", () => {
  it("returns a Bearer Authorization header for a non-empty token", () => {
    expect(buildAuthHeaders("abc123")).toEqual({ Authorization: "Bearer abc123" });
  });

  it("returns no headers when the token is missing/empty", () => {
    expect(buildAuthHeaders(null)).toEqual({});
    expect(buildAuthHeaders(undefined)).toEqual({});
    expect(buildAuthHeaders("")).toEqual({});
  });

  it("NEVER emits any X-Dev-* dev-auth header (spec section 14)", () => {
    for (const token of ["abc123", "", null, undefined] as const) {
      const headers = buildAuthHeaders(token);
      const keys = Object.keys(headers).map((k) => k.toLowerCase());
      expect(keys.some((k) => k.startsWith("x-dev"))).toBe(false);
    }
  });
});

describe("unwrap", () => {
  const ok = { ok: true, status: 200 } as unknown as Response;
  const notFound = { ok: false, status: 404 } as unknown as Response;

  it("returns data on a successful response", () => {
    expect(unwrap({ data: { status: "ok" }, response: ok })).toEqual({ status: "ok" });
  });

  it("throws ApiError carrying the status on an HTTP error", () => {
    try {
      unwrap({ error: { detail: "nope" }, response: notFound });
      throw new Error("expected unwrap to throw");
    } catch (e) {
      expect(e).toBeInstanceOf(ApiError);
      expect((e as ApiError).status).toBe(404);
    }
  });
});

describe("createApiClient", () => {
  it("builds a client exposing typed request methods", () => {
    const client = createApiClient("https://api.fountainrank.com");
    expect(typeof client.GET).toBe("function");
  });

  it("sends NO X-Dev-* header on a default request (spec section 14)", async () => {
    let sentKeys: string[] = [];
    const fetchMock: typeof fetch = async (input) => {
      const req = input instanceof Request ? input : new Request(String(input));
      sentKeys = [...req.headers.keys()].map((k) => k.toLowerCase());
      return new Response(JSON.stringify({ status: "ok" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    };
    const client = createApiClient("https://api.fountainrank.com", { fetch: fetchMock });
    await client.GET("/healthz");
    expect(sentKeys.some((k) => k.startsWith("x-dev"))).toBe(false);
  });

  it("STRIPS an X-Dev-* header a caller passes to a generated operation (spec section 14 enforcement)", async () => {
    let sentKeys: string[] = [];
    const fetchMock: typeof fetch = async (input) => {
      const req = input instanceof Request ? input : new Request(String(input));
      sentKeys = [...req.headers.keys()].map((k) => k.toLowerCase());
      return new Response(JSON.stringify({}), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    };
    const client = createApiClient("https://api.fountainrank.com", { fetch: fetchMock });
    // GET /api/v1/me IS a generated operation that exposes X-Dev-* header params.
    // Deliberately try to send them and prove the wrapper's middleware strips them
    // before the request leaves the client (Authorization, if any, is untouched).
    await client.GET("/api/v1/me", {
      params: {
        header: {
          "X-Dev-User": "evil",
          "X-Dev-Email": "evil@example.com",
          "X-Dev-Name": "Evil",
        },
      },
    });
    expect(sentKeys.some((k) => k.startsWith("x-dev"))).toBe(false);
  });

  it("STRIPS an X-Dev-* header added by per-request middleware (non-bypassable, spec section 14)", async () => {
    let sentKeys: string[] = [];
    const fetchMock: typeof fetch = async (input) => {
      const req = input instanceof Request ? input : new Request(String(input));
      sentKeys = [...req.headers.keys()].map((k) => k.toLowerCase());
      return new Response(JSON.stringify({ status: "ok" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    };
    const client = createApiClient("https://api.fountainrank.com", { fetch: fetchMock });
    // Attempt the bypass: inject middleware that re-adds X-Dev-* AFTER any
    // client-level handling. The sanitizing fetch (which runs last) and the
    // facade's stripping of the per-request `middleware` key both defeat it.
    await client.GET("/healthz", {
      middleware: [
        {
          onRequest({ request }) {
            request.headers.set("X-Dev-User", "evil");
            return request;
          },
        },
      ],
    });
    expect(sentKeys.some((k) => k.startsWith("x-dev"))).toBe(false);
  });

  it("ignores a per-request fetch override so it cannot bypass the sanitizer (spec section 14)", async () => {
    let safeFetchUsed = false;
    let unsafeFetchUsed = false;
    const ok = () =>
      new Response(JSON.stringify({ status: "ok" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    const safeFetch: typeof fetch = async () => {
      safeFetchUsed = true;
      return ok();
    };
    const unsafeFetch: typeof fetch = async () => {
      unsafeFetchUsed = true;
      return ok();
    };
    const client = createApiClient("https://api.fountainrank.com", { fetch: safeFetch });
    // The facade strips the per-request `fetch`, so the configured (sanitizing)
    // fetch is used and the caller's override is ignored.
    await client.GET("/healthz", { fetch: unsafeFetch });
    expect(safeFetchUsed).toBe(true);
    expect(unsafeFetchUsed).toBe(false);
  });

  it("does not expose openapi-fetch middleware hooks (no use/eject)", () => {
    const client = createApiClient("https://api.fountainrank.com");
    expect("use" in client).toBe(false);
    expect("eject" in client).toBe(false);
  });

  it("attaches a Bearer token from the token provider", async () => {
    let authorization: string | null = null;
    const fetchMock: typeof fetch = async (input) => {
      const req = input instanceof Request ? input : new Request(String(input));
      authorization = req.headers.get("authorization");
      return new Response(JSON.stringify({ status: "ok" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    };
    const client = createApiClient("https://api.fountainrank.com", {
      fetch: fetchMock,
      getAccessToken: async () => "token123",
    });
    await client.GET("/healthz");
    expect(authorization).toBe("Bearer token123");
  });

  it("omits Authorization when the token provider returns no token", async () => {
    let authorization: string | null = "unexpected";
    const fetchMock: typeof fetch = async (input) => {
      const req = input instanceof Request ? input : new Request(String(input));
      authorization = req.headers.get("authorization");
      return new Response(JSON.stringify({ status: "ok" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    };
    const client = createApiClient("https://api.fountainrank.com", {
      fetch: fetchMock,
      getAccessToken: async () => null,
    });
    await client.GET("/healthz");
    expect(authorization).toBeNull();
  });

  it("rejects token-provider failures as auth/session errors, not ApiError/offline", async () => {
    const client = createApiClient("https://api.fountainrank.com", {
      getAccessToken: async () => {
        throw new Error("expired");
      },
    });
    await expect(client.GET("/healthz")).rejects.toBeInstanceOf(AuthSessionError);
  });

  it("keeps stripping X-Dev-* headers when auth is enabled", async () => {
    let sentKeys: string[] = [];
    let authorization: string | null = null;
    const fetchMock: typeof fetch = async (input) => {
      const req = input instanceof Request ? input : new Request(String(input));
      sentKeys = [...req.headers.keys()].map((k) => k.toLowerCase());
      authorization = req.headers.get("authorization");
      return new Response(JSON.stringify({}), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    };
    const client = createApiClient("https://api.fountainrank.com", {
      fetch: fetchMock,
      getAccessToken: async () => "token123",
    });
    await client.GET("/api/v1/me", {
      params: { header: { "X-Dev-User": "evil" } },
    });
    expect(authorization).toBe("Bearer token123");
    expect(sentKeys.some((k) => k.startsWith("x-dev"))).toBe(false);
  });

  it("rejects with a non-ApiError (no HTTP status) when the network fails - the offline path", async () => {
    const fetchMock: typeof fetch = async () => {
      throw new TypeError("Network request failed");
    };
    const client = createApiClient("https://api.fountainrank.com", { fetch: fetchMock });
    // A thrown rejection with no numeric `.status` is what resolveViewState maps
    // to "offline" (vs an ApiError's "error"). Asserting "not ApiError" is robust
    // regardless of whether openapi-fetch rethrows or wraps the network error.
    await expect(client.GET("/healthz")).rejects.not.toBeInstanceOf(ApiError);
  });

  it("unwraps a 5xx from the real client as ApiError(status) - the error path", async () => {
    const fetchMock: typeof fetch = async () => new Response("boom", { status: 500 });
    const client = createApiClient("https://api.fountainrank.com", { fetch: fetchMock });
    const result = await client.GET("/healthz");
    try {
      unwrap(result);
      throw new Error("expected unwrap to throw");
    } catch (e) {
      expect(e).toBeInstanceOf(ApiError);
      expect((e as ApiError).status).toBe(500);
    }
  });
});

describe("apiErrorStatus", () => {
  it("returns the numeric status of an ApiError", () => {
    expect(apiErrorStatus(new ApiError(404))).toBe(404);
    expect(apiErrorStatus(new ApiError(500))).toBe(500);
  });
  it("returns null for a non-ApiError (network error / arbitrary value)", () => {
    expect(apiErrorStatus(new Error("boom"))).toBeNull();
    expect(apiErrorStatus(null)).toBeNull();
    expect(apiErrorStatus({ status: 404 })).toBeNull();
  });
});
