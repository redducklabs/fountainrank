import { afterEach, describe, expect, it, vi } from "vitest";

import { AuthSessionError } from "./auth/state";
import {
  ApiError,
  ApiTimeoutError,
  apiErrorStatus,
  buildAuthHeaders,
  createApiClient,
  isAuthenticatedApiRequest,
  READ_TIMEOUT_MS,
  unwrap,
  WRITE_TIMEOUT_MS,
  type NativeFileUpload,
} from "./api";

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

  it("classifies authenticated API requests", () => {
    expect(isAuthenticatedApiRequest(new Request("https://api.fountainrank.com/api/v1/me"))).toBe(
      true,
    );
    expect(
      isAuthenticatedApiRequest(new Request("https://api.fountainrank.com/api/v1/fountains/bbox")),
    ).toBe(false);
    expect(
      isAuthenticatedApiRequest(
        new Request("https://api.fountainrank.com/api/v1/fountains", { method: "POST" }),
      ),
    ).toBe(true);
  });

  it("authenticates the GET fountain detail so the caller's own rating loads (#65)", () => {
    // /api/v1/fountains/{id} is public but enriches with `your_rating` when a token is
    // present, so a previously-rated fountain pre-fills the stars.
    expect(
      isAuthenticatedApiRequest(
        new Request(
          "https://api.fountainrank.com/api/v1/fountains/123e4567-e89b-12d3-a456-426614174000",
        ),
      ),
    ).toBe(true);
    // ...but not the sibling collection read (bbox), nor public sub-resources (notes).
    expect(
      isAuthenticatedApiRequest(new Request("https://api.fountainrank.com/api/v1/fountains/bbox")),
    ).toBe(false);
    expect(
      isAuthenticatedApiRequest(
        new Request("https://api.fountainrank.com/api/v1/fountains/abc/notes"),
      ),
    ).toBe(false);
  });

  it("force-authenticates the entire admin subtree, boundary-safely", () => {
    // Every /api/v1/admin/* endpoint is guarded by require_admin, so the whole subtree must carry
    // a token — the admin fountain detail (and any subresource), the moderation queue, the
    // contributor history, and the admin leaderboard the signed-in admin board fetches (#271).
    for (const path of [
      "/api/v1/admin/fountains/123e4567-e89b-12d3-a456-426614174000",
      "/api/v1/admin/fountains/123e4567-e89b-12d3-a456-426614174000/notes",
      "/api/v1/admin/leaderboard/contributors",
      "/api/v1/admin/contributors/123e4567-e89b-12d3-a456-426614174000/contributions",
    ]) {
      expect(isAuthenticatedApiRequest(new Request(`https://api.fountainrank.com${path}`))).toBe(
        true,
      );
    }
    // ...but a sibling that merely shares the `admin` prefix is NOT the admin subtree.
    for (const path of ["/api/v1/administrators", "/api/v1/admin-extra"]) {
      expect(isAuthenticatedApiRequest(new Request(`https://api.fountainrank.com${path}`))).toBe(
        false,
      );
    }
  });

  it("authenticates the GET /api/v1/me/* subtree (issue #88: contributions, badges)", () => {
    // These carried no bearer token under the old exact `=== "/api/v1/me"` gate,
    // so the backend 401'd and the map chip + Account points fell back to 0.
    expect(
      isAuthenticatedApiRequest(
        new Request("https://api.fountainrank.com/api/v1/me/contributions"),
      ),
    ).toBe(true);
    expect(
      isAuthenticatedApiRequest(new Request("https://api.fountainrank.com/api/v1/me/badges")),
    ).toBe(true);
    // A query string must not defeat the gate.
    expect(
      isAuthenticatedApiRequest(
        new Request("https://api.fountainrank.com/api/v1/me/contributions?limit=20"),
      ),
    ).toBe(true);
  });

  it("treats GET /api/v1/geocode as public/unauthenticated (spec section 8.1)", () => {
    // The geocode proxy is a public, unauthenticated endpoint (browsing/search
    // must not require sign-in). This guards against a future classifier
    // change accidentally attaching a bearer token to LocationIQ searches.
    expect(
      isAuthenticatedApiRequest(
        new Request("https://api.fountainrank.com/api/v1/geocode?q=main%20st"),
      ),
    ).toBe(false);
  });

  it("does not over-match sibling paths that merely share the /me prefix", () => {
    // Boundary safety: only the exact /api/v1/me path or its /api/v1/me/ subtree
    // are the authenticated user's resources. A path like /api/v1/members must
    // NOT be force-authenticated by a naive prefix match.
    expect(
      isAuthenticatedApiRequest(new Request("https://api.fountainrank.com/api/v1/members")),
    ).toBe(false);
    expect(
      isAuthenticatedApiRequest(new Request("https://api.fountainrank.com/api/v1/me-extra")),
    ).toBe(false);
  });

  it("attaches a Bearer token from the token provider on authenticated requests", async () => {
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
    await client.GET("/api/v1/me");
    expect(authorization).toBe("Bearer token123");
  });

  it("attaches the Bearer token on GET /api/v1/me/contributions (issue #88)", async () => {
    let authorization: string | null = null;
    const fetchMock: typeof fetch = async (input) => {
      const req = input instanceof Request ? input : new Request(String(input));
      authorization = req.headers.get("authorization");
      return new Response(JSON.stringify({ items: [], total_points: 0 }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    };
    const client = createApiClient("https://api.fountainrank.com", {
      fetch: fetchMock,
      getAccessToken: async () => "token123",
    });
    await client.GET("/api/v1/me/contributions");
    expect(authorization).toBe("Bearer token123");
  });

  it("attaches the Bearer token on GET /api/v1/admin/leaderboard/contributors (#271 regression)", async () => {
    // #271 switched the signed-in ADMIN rankings board to this admin-only endpoint but did not
    // add it to the allow-list, so the request shipped tokenless -> backend require_admin 401 ->
    // "Couldn't load the leaderboard." Prove the token is attached now (the whole admin subtree is).
    let authorization: string | null = null;
    const fetchMock: typeof fetch = async (input) => {
      const req = input instanceof Request ? input : new Request(String(input));
      authorization = req.headers.get("authorization");
      return new Response(JSON.stringify({ rows: [] }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    };
    const client = createApiClient("https://api.fountainrank.com", {
      fetch: fetchMock,
      getAccessToken: async () => "token123",
    });
    await client.GET("/api/v1/admin/leaderboard/contributors", {
      params: { query: { sort: "total" } },
    });
    expect(authorization).toBe("Bearer token123");
  });

  it("does not call the token provider for public reads", async () => {
    let authorization: string | null = "unexpected";
    let tokenCalls = 0;
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
      getAccessToken: async () => {
        tokenCalls += 1;
        throw new Error("expired");
      },
    });
    await client.GET("/api/v1/fountains/bbox", {
      params: {
        query: {
          min_lat: 37,
          min_lng: -123,
          max_lat: 38,
          max_lng: -122,
        },
      },
    });
    expect(tokenCalls).toBe(0);
    expect(authorization).toBeNull();
  });

  it("sends no Authorization header on GET /api/v1/geocode even when a token provider is configured", async () => {
    // Guards spec section 8.1 (public geocode proxy): a signed-in user's
    // bearer token must never leak to the LocationIQ search calls.
    let authorization: string | null = "unexpected";
    let tokenCalls = 0;
    const fetchMock: typeof fetch = async (input) => {
      const req = input instanceof Request ? input : new Request(String(input));
      authorization = req.headers.get("authorization");
      return new Response(JSON.stringify({ results: [] }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    };
    const client = createApiClient("https://api.fountainrank.com", {
      fetch: fetchMock,
      getAccessToken: async () => {
        tokenCalls += 1;
        return "token123";
      },
    });
    await client.GET("/api/v1/geocode", { params: { query: { q: "main st" } } });
    expect(tokenCalls).toBe(0);
    expect(authorization).toBeNull();
  });

  it("omits Authorization on authenticated requests when the token provider returns no token", async () => {
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
    await client.GET("/api/v1/me");
    expect(authorization).toBeNull();
  });

  it("rejects protected token-provider failures as auth/session errors, not ApiError/offline", async () => {
    const client = createApiClient("https://api.fountainrank.com", {
      getAccessToken: async () => {
        throw new Error("expired");
      },
    });
    await expect(client.GET("/api/v1/me")).rejects.toBeInstanceOf(AuthSessionError);
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

describe("isAuthenticatedApiRequest - admin photo-reports + photo list", () => {
  it("force-authenticates the admin photo-reports queue and its summary", () => {
    expect(
      isAuthenticatedApiRequest(
        new Request("https://api.fountainrank.com/api/v1/admin/photo-reports"),
      ),
    ).toBe(true);
    expect(
      isAuthenticatedApiRequest(
        new Request("https://api.fountainrank.com/api/v1/admin/photo-reports/summary"),
      ),
    ).toBe(true);
  });

  it("force-authenticates the #12 unified moderation queue and its summary", () => {
    expect(
      isAuthenticatedApiRequest(new Request("https://api.fountainrank.com/api/v1/admin/reports")),
    ).toBe(true);
    expect(
      isAuthenticatedApiRequest(
        new Request("https://api.fountainrank.com/api/v1/admin/reports/summary"),
      ),
    ).toBe(true);
  });

  it("attaches a token to the per-fountain photo list so is_own is computed", () => {
    expect(
      isAuthenticatedApiRequest(
        new Request(
          "https://api.fountainrank.com/api/v1/fountains/123e4567-e89b-12d3-a456-426614174000/photos",
        ),
      ),
    ).toBe(true);
  });

  it("does not over-match a public route by prefix", () => {
    expect(
      isAuthenticatedApiRequest(new Request("https://api.fountainrank.com/api/v1/fountains/bbox")),
    ).toBe(false);
  });
});

describe("createApiClient.uploadMultipart", () => {
  it("delegates to the native uploader with the file uri, field name, mime type, and bearer token", async () => {
    // The upload goes through the injected native uploader (expo-file-system `uploadAsync`), NOT
    // `fetch`+`FormData`: React Native's New Architecture rejects the `{ uri, name, type }`
    // FormData file-part shape (`Error: Unsupported FormDataPart implementation`), throwing before
    // the request is sent. Assert the uploader receives the resolved URL, the raw file uri, the
    // "file" field name, the mime type, and the bearer token (with no Content-Type / x-dev*).
    const received: {
      url?: string;
      fileUri?: string;
      options?: Parameters<NativeFileUpload>[2];
    } = {};
    const uploadFile: NativeFileUpload = async (url, fileUri, options) => {
      received.url = url;
      received.fileUri = fileUri;
      received.options = options;
      return { status: 201, body: JSON.stringify({ id: "photo-1" }) };
    };
    const client = createApiClient("https://api.fountainrank.com", {
      uploadFile,
      getAccessToken: async () => "token123",
    });

    const result = await client.uploadMultipart(
      "/api/v1/fountains/123e4567-e89b-12d3-a456-426614174000/photos",
      { uri: "file:///cache/photo.jpg", type: "image/jpeg" },
    );

    // The success body is now parsed so the caller can read the award (#204).
    expect(result).toEqual({ status: 201, data: { id: "photo-1" } });
    expect(received.url).toBe(
      "https://api.fountainrank.com/api/v1/fountains/123e4567-e89b-12d3-a456-426614174000/photos",
    );
    expect(received.fileUri).toBe("file:///cache/photo.jpg");
    expect(received.options?.httpMethod).toBe("POST");
    expect(received.options?.fieldName).toBe("file");
    expect(received.options?.mimeType).toBe("image/jpeg");
    const headerKeys = Object.keys(received.options?.headers ?? {});
    expect(received.options?.headers.Authorization).toBe("Bearer token123");
    // The native uploader sets the multipart Content-Type/boundary itself; the client must not.
    expect(headerKeys.some((k) => k.toLowerCase() === "content-type")).toBe(false);
    expect(headerKeys.some((k) => k.toLowerCase().startsWith("x-dev"))).toBe(false);
  });

  it("parses the error body's detail field on a non-2xx native upload", async () => {
    // The two distinct 409 shapes (photo_limit_* vs display_name_required) are only
    // distinguishable via the response body's `detail`, so a non-2xx must surface it.
    const uploadFile: NativeFileUpload = async () => ({
      status: 409,
      body: JSON.stringify({ detail: "photo_limit_user" }),
    });
    const client = createApiClient("https://api.fountainrank.com", {
      uploadFile,
      getAccessToken: async () => "token123",
    });

    const result = await client.uploadMultipart(
      "/api/v1/fountains/123e4567-e89b-12d3-a456-426614174000/photos",
      { uri: "file:///cache/photo.jpg", type: "image/jpeg" },
    );
    expect(result).toEqual({ status: 409, detail: "photo_limit_user" });
  });

  it("does not call the native uploader when the token provider fails - raises AuthSessionError instead", async () => {
    let uploadCalled = false;
    const uploadFile: NativeFileUpload = async () => {
      uploadCalled = true;
      return { status: 200, body: "" };
    };
    const client = createApiClient("https://api.fountainrank.com", {
      uploadFile,
      getAccessToken: async () => {
        throw new Error("expired");
      },
    });

    await expect(
      client.uploadMultipart("/api/v1/fountains/123e4567-e89b-12d3-a456-426614174000/photos", {
        uri: "file:///cache/photo.jpg",
        type: "image/jpeg",
      }),
    ).rejects.toBeInstanceOf(AuthSessionError);
    expect(uploadCalled).toBe(false);
  });

  it("strips an x-dev* header on the shared sanitizing fetch that other verbs use", async () => {
    // uploadMultipart no longer shares `sanitizingFetch` (it builds its own headers
    // from scratch and so can never carry an x-dev* header), but every other verb
    // still routes through `sanitizingFetch`, which strips x-dev* from whatever
    // Request reaches it regardless of where the header came from (generated
    // params, middleware, ...). Exercise that shared path directly.
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

    await client.POST("/api/v1/fountains", {
      body: { latitude: 0, longitude: 0 } as never,
      params: { header: { "X-Dev-User": "evil" } } as never,
    });

    expect(sentKeys.some((k) => k.startsWith("x-dev"))).toBe(false);
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

describe("createApiClient — request deadlines (spec §1, Verification 1a–1i)", () => {
  const BASE = "https://api.fountainrank.com";
  const okJson = () =>
    new Response(JSON.stringify({ id: "f1" }), {
      status: 201,
      headers: { "content-type": "application/json" },
    });
  const writeBody = { latitude: 0, longitude: 0 } as never;
  // A fetch that rejects when its request's (composed) signal aborts — as a real fetch
  // does — so the "no unhandled late rejection" paths are actually exercised.
  const abortAwareFetch = () =>
    vi.fn(
      (req: Request) =>
        new Promise<Response>((_resolve, reject) => {
          req.signal.addEventListener("abort", () => {
            const e = new Error("aborted");
            e.name = "AbortError";
            reject(e);
          });
        }),
    );

  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it("(1a) bounds a hanging POST at WRITE_TIMEOUT_MS exactly, not the read ceiling", async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn(() => new Promise<Response>(() => {}));
    const client = createApiClient(BASE, { fetch: fetchMock as unknown as typeof fetch });
    let settled = false;
    const p = client.POST("/api/v1/fountains", { body: writeBody }).catch((e: unknown) => {
      settled = true;
      throw e;
    });
    const assertion = expect(p).rejects.toBeInstanceOf(ApiTimeoutError);
    await vi.advanceTimersByTimeAsync(WRITE_TIMEOUT_MS - 1);
    expect(settled).toBe(false); // still pending at 29_999ms (proves it is not the 15s read ceiling)
    await vi.advanceTimersByTimeAsync(1);
    expect(settled).toBe(true);
    await assertion;
  });

  it("(1a) bounds a hanging GET at READ_TIMEOUT_MS exactly", async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn(() => new Promise<Response>(() => {}));
    const client = createApiClient(BASE, { fetch: fetchMock as unknown as typeof fetch });
    let settled = false;
    const p = client.GET("/healthz").catch((e: unknown) => {
      settled = true;
      throw e;
    });
    const assertion = expect(p).rejects.toBeInstanceOf(ApiTimeoutError);
    await vi.advanceTimersByTimeAsync(READ_TIMEOUT_MS - 1);
    expect(settled).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(settled).toBe(true);
    await assertion;
  });

  it("(1b) clears the deadline timer and removes the inbound abort listener when the fetch settles first", async () => {
    // openapi-fetch links the caller's signal onto its own Request signal (it is not the
    // same object — see 1c/1d, where the caller's reason still surfaces), so the transport
    // adds/removes its abort listener on that linked signal. Spy at the EventTarget level to
    // assert the cleanup happened (both spies call through, so nothing is stubbed).
    const clearSpy = vi.spyOn(globalThis, "clearTimeout");
    const removeSpy = vi.spyOn(EventTarget.prototype, "removeEventListener");
    const inbound = new AbortController();
    const client = createApiClient(BASE, { fetch: async () => okJson() });
    await client.POST("/api/v1/fountains", { body: writeBody, signal: inbound.signal });
    expect(clearSpy).toHaveBeenCalled();
    expect(removeSpy).toHaveBeenCalledWith("abort", expect.any(Function));
  });

  it("(1c) surfaces the caller's abort reason (never ApiTimeoutError) on a mid-flight inbound abort", async () => {
    vi.useFakeTimers();
    const fetchMock = abortAwareFetch();
    const client = createApiClient(BASE, { fetch: fetchMock as unknown as typeof fetch });
    const inbound = new AbortController();
    const reason = new Error("caller cancelled");
    const p = client.GET("/healthz", { signal: inbound.signal });
    const assertion = expect(p).rejects.toBe(reason);
    await vi.advanceTimersByTimeAsync(1); // dispatch reaches baseFetch
    expect(fetchMock).toHaveBeenCalledTimes(1);
    inbound.abort(reason);
    await assertion;
  });

  it("(1d) rejects immediately without dispatching when the inbound signal is already aborted", async () => {
    const fetchMock = vi.fn(async () => okJson());
    const client = createApiClient(BASE, { fetch: fetchMock as unknown as typeof fetch });
    const inbound = new AbortController();
    const reason = new Error("already gone");
    inbound.abort(reason);
    await expect(client.GET("/healthz", { signal: inbound.signal })).rejects.toBe(reason);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("(1e) propagates an underlying network TypeError unchanged (never wrapped as a timeout)", async () => {
    const err = new TypeError("Network request failed");
    const client = createApiClient(BASE, {
      fetch: async () => {
        throw err;
      },
    });
    await expect(client.GET("/healthz")).rejects.toBe(err);
  });

  it("(1f) dispatches a request carrying the composed signal, injected Authorization, and no x-dev", async () => {
    let dispatched: Request | undefined;
    const inbound = new AbortController();
    const client = createApiClient(BASE, {
      fetch: async (input) => {
        dispatched = input as Request;
        return okJson();
      },
      getAccessToken: async () => "token123",
    });
    await client.POST("/api/v1/fountains", {
      body: writeBody,
      params: { header: { "X-Dev-User": "evil" } } as never,
      signal: inbound.signal,
    });
    expect(dispatched).toBeDefined();
    // Composed: the request carries a NEW controller signal (deadline + inbound funnel
    // into it), never the raw inbound signal.
    expect(dispatched!.signal).toBeInstanceOf(AbortSignal);
    expect(dispatched!.signal).not.toBe(inbound.signal);
    expect(dispatched!.headers.get("authorization")).toBe("Bearer token123");
    expect([...dispatched!.headers.keys()].some((k) => k.toLowerCase().startsWith("x-dev"))).toBe(
      false,
    );
  });

  it("(1g) logs one api_timeout line carrying method + path only — no query/token/body/coords", async () => {
    vi.useFakeTimers();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const client = createApiClient(BASE, {
      fetch: () => new Promise<Response>(() => {}),
      getAccessToken: async () => "token123",
    });
    const p = client.POST("/api/v1/fountains", {
      body: { latitude: 47.6, longitude: -122.3 } as never,
    });
    const assertion = expect(p).rejects.toBeInstanceOf(ApiTimeoutError);
    await vi.advanceTimersByTimeAsync(WRITE_TIMEOUT_MS);
    await assertion;
    expect(warn).toHaveBeenCalledTimes(1);
    const line = warn.mock.calls[0][0] as string;
    expect(JSON.parse(line)).toEqual({
      level: "warn",
      area: "api",
      event: "api_timeout",
      method: "POST",
      path: "/api/v1/fountains",
      timeout_ms: WRITE_TIMEOUT_MS,
      source: "deadline",
    });
    expect(line).not.toMatch(/token123/);
    expect(line).not.toMatch(/47\.6/);
    expect(line).not.toMatch(/authorization/i);
  });

  it("(1h) a never-settling token rejects with ApiTimeoutError at the deadline and never dispatches", async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn(async () => okJson());
    const client = createApiClient(BASE, {
      fetch: fetchMock as unknown as typeof fetch,
      getAccessToken: () => new Promise<string>(() => {}),
    });
    const p = client.POST("/api/v1/fountains", { body: writeBody });
    const assertion = expect(p).rejects.toBeInstanceOf(ApiTimeoutError);
    await vi.advanceTimersByTimeAsync(WRITE_TIMEOUT_MS);
    await assertion;
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("(1h) a token rejection surfaces AuthSessionError (unchanged), never a timeout", async () => {
    const fetchMock = vi.fn(async () => okJson());
    const client = createApiClient(BASE, {
      fetch: fetchMock as unknown as typeof fetch,
      getAccessToken: async () => {
        throw new Error("expired");
      },
    });
    await expect(client.POST("/api/v1/fountains", { body: writeBody })).rejects.toBeInstanceOf(
      AuthSessionError,
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("(1h) a token resolving AFTER the deadline dispatches nothing", async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn(async () => okJson());
    const client = createApiClient(BASE, {
      fetch: fetchMock as unknown as typeof fetch,
      getAccessToken: () =>
        new Promise<string>((resolve) =>
          setTimeout(() => resolve("late"), WRITE_TIMEOUT_MS + 10_000),
        ),
    });
    const p = client.POST("/api/v1/fountains", { body: writeBody });
    const assertion = expect(p).rejects.toBeInstanceOf(ApiTimeoutError);
    await vi.advanceTimersByTimeAsync(WRITE_TIMEOUT_MS);
    await assertion;
    await vi.advanceTimersByTimeAsync(10_000); // token resolves well after the deadline
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("(1i) inbound-abort-first yields the caller reason and logs nothing (no unhandled late rejection)", async () => {
    vi.useFakeTimers();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const fetchMock = abortAwareFetch();
    const client = createApiClient(BASE, { fetch: fetchMock as unknown as typeof fetch });
    const inbound = new AbortController();
    const reason = new Error("caller cancelled");
    const p = client.GET("/healthz", { signal: inbound.signal });
    const assertion = expect(p).rejects.toBe(reason);
    await vi.advanceTimersByTimeAsync(1);
    inbound.abort(reason);
    await assertion;
    await vi.advanceTimersByTimeAsync(0); // flush the late baseFetch abort-rejection
    expect(warn).not.toHaveBeenCalled();
  });

  it("(1i) deadline-first yields ApiTimeoutError, logs exactly once, and a later inbound abort is inert", async () => {
    vi.useFakeTimers();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const fetchMock = abortAwareFetch();
    const client = createApiClient(BASE, { fetch: fetchMock as unknown as typeof fetch });
    const inbound = new AbortController();
    const p = client.GET("/healthz", { signal: inbound.signal });
    const assertion = expect(p).rejects.toBeInstanceOf(ApiTimeoutError);
    await vi.advanceTimersByTimeAsync(READ_TIMEOUT_MS);
    await assertion;
    inbound.abort(new Error("late")); // must not produce a second rejection or log
    await vi.advanceTimersByTimeAsync(0);
    expect(warn).toHaveBeenCalledTimes(1);
  });
});
