import { makeClient, type ApiClient } from "@fountainrank/api-client";

import { AuthSessionError } from "./auth/state";

/**
 * Build the auth headers for an authenticated mobile request.
 *
 * SECURITY (spec section 14): the mobile app authenticates ONLY with a Logto
 * bearer token. This builder is structurally incapable of emitting the dev-auth
 * seam headers (X-Dev-User / X-Dev-Email / X-Dev-Name) in any build profile. The
 * 6e-5 Logto integration attaches the result via openapi-fetch middleware and
 * must never add an X-Dev-* header.
 */
export function buildAuthHeaders(token: string | null | undefined): Record<string, string> {
  if (typeof token !== "string" || token.length === 0) {
    return {};
  }
  return { Authorization: `Bearer ${token}` };
}

/**
 * An HTTP-level API error carrying the response status. Network failures are
 * NOT instances of this - they reject inside openapi-fetch as the underlying
 * fetch error (no status), so `resolveViewState` can distinguish "offline"
 * (no status) from "server error" (has status).
 */
export class ApiError extends Error {
  constructor(
    public readonly status: number,
    message?: string,
  ) {
    super(message ?? `Request failed with status ${status}`);
    this.name = "ApiError";
  }
}

/**
 * The numeric HTTP status of an `ApiError`, or `null` for anything else
 * (network/offline errors have no status; a bare `{ status }` object is NOT an
 * ApiError). Use for value-specific branching (e.g. 404 -> "not found"). See
 * `resolveViewState` for the structural offline-vs-error classification this
 * complements.
 */
export function apiErrorStatus(error: unknown): number | null {
  return error instanceof ApiError ? error.status : null;
}

type FetchResult<T> = { data?: T; error?: unknown; response: Response };

/**
 * Unwrap an openapi-fetch result: return `data` on success, or throw
 * `ApiError(status)` on an HTTP error. (A network-level failure rejects inside
 * openapi-fetch before this runs, surfacing as a non-ApiError to the caller.)
 */
export function unwrap<T>(result: FetchResult<T>): T {
  const { data, error, response } = result;
  if (!response.ok || error !== undefined) {
    throw new ApiError(response.status);
  }
  return data as T;
}

/**
 * The mobile-safe API surface: only the HTTP verbs the app uses, with NO access
 * to openapi-fetch's `use`/`eject` middleware hooks.
 */
export type MobileApiClient = Pick<ApiClient, "GET" | "POST" | "PUT" | "PATCH" | "DELETE"> & {
  /**
   * Multipart upload (e.g. fountain photos). openapi-fetch's typed client doesn't
   * fit multipart/form-data bodies, AND React Native's fetch only streams a file
   * FormData when it is passed directly as `fetch(url, { body: formData })` - not
   * wrapped in a `new Request(...)` - so this method cannot reuse `sanitizingFetch`
   * (every other verb's shared path) without breaking the upload. It instead builds
   * its own headers using the SAME `getAccessToken`/`buildAuthHeaders` auth path (no
   * second, unaudited auth mechanism) and calls the raw fetch directly. Do not set
   * `Content-Type`; React Native sets the multipart boundary itself.
   */
  uploadMultipart(path: string, formData: FormData): Promise<{ status: number; detail?: unknown }>;
};

type MakeClientOptions = Parameters<typeof makeClient>[1];
export type CreateApiClientOptions = MakeClientOptions & {
  getAccessToken?: () => Promise<string | null | undefined>;
  shouldAttachAuth?: (request: Request) => boolean;
};

function requestPath(input: Request): string {
  const withoutOrigin = input.url.replace(/^[a-z][a-z\d+.-]*:\/\/[^/]+/i, "");
  return withoutOrigin.split(/[?#]/, 1)[0] || "/";
}

export function isAuthenticatedApiRequest(input: Request): boolean {
  if (input.method.toUpperCase() !== "GET") {
    return true;
  }
  // The authenticated user's own resources are exactly `/api/v1/me` and its
  // subtree (`/api/v1/me/contributions`, `/api/v1/me/badges`, ...). The previous
  // exact match left those subtree reads tokenless -> backend 401 -> points
  // showed 0 (issue #88). Match the subtree, but boundary-safely: a sibling like
  // `/api/v1/members` shares the `me` prefix yet is NOT the current-user subtree.
  const path = requestPath(input);
  if (path === "/api/v1/me" || path.startsWith("/api/v1/me/")) {
    return true;
  }
  // The public fountain DETAIL GET (/api/v1/fountains/{id}) is enrichable with the
  // caller's own rating (#65): attach the token when signed in so `your_rating` comes
  // back. Signed-out users send no token (getBackendAccessToken -> null -> buildAuthHeaders
  // emits no header) and still get the anonymous response. Exclude the sibling collection
  // read /fountains/bbox and sub-resources like /fountains/{id}/notes (single segment only).
  if (path !== "/api/v1/fountains/bbox" && /^\/api\/v1\/fountains\/[^/]+$/.test(path)) {
    return true;
  }
  // Admin fountain detail exposes hidden notes/fountain state and is never public. Match
  // only the single-id route, boundary-safely, so future admin subresources are not
  // accidentally force-authenticated by a loose prefix.
  if (/^\/api\/v1\/admin\/fountains\/[^/]+$/.test(path)) {
    return true;
  }
  // The admin moderation queue and its unread-count summary are staff-only surfaces
  // (moderation queue + badge count) and must always carry a token. Both the #12 unified routes
  // and the pre-#12 photo-only routes (still called by older app builds) are force-authenticated.
  if (
    path === "/api/v1/admin/reports" ||
    path === "/api/v1/admin/reports/summary" ||
    path === "/api/v1/admin/photo-reports" ||
    path === "/api/v1/admin/photo-reports/summary"
  ) {
    return true;
  }
  // The per-fountain photo list is public, but attach the token when signed in so the
  // backend can compute the caller's own `is_own` flag on each photo (needed for the
  // mobile per-photo delete gating). Boundary-safe: matches only the list route itself,
  // not sibling sub-resources.
  if (/^\/api\/v1\/fountains\/[^/]+\/photos$/.test(path)) {
    return true;
  }
  return false;
}

/**
 * Build the mobile API client from validated config. Auth-unavailable mode
 * (slice 6e-2): no token provider, so requests carry no auth header at all.
 *
 * SECURITY (spec section 14) - ENFORCED and NON-BYPASSABLE: the generated client
 * exposes X-Dev-User/Email/Name header params on write/auth operations (e.g.
 * GET /api/v1/me, POST /api/v1/fountains, POST /api/v1/me/sync). Two layers
 * guarantee the mobile app can never emit the dev-auth seam, in any build
 * profile:
 *   1. A sanitizing `fetch` wraps the configured fetch and deletes ANY x-dev*
 *      header immediately before the network call. Because openapi-fetch invokes
 *      the configured fetch AFTER every middleware (global and per-request), this
 *      catches x-dev headers from generated params OR from any middleware.
 *   2. A narrowed facade re-exposes only GET/POST/PUT/PATCH/DELETE and strips the
 *      per-request `fetch`/`middleware` escape hatches from each call's init, so a
 *      caller cannot swap in a fetch/middleware that bypasses layer 1. `use`/
 *      `eject` are not exposed at all.
 *
 * The optional `options` pass-through (typed off `makeClient`) lets tests inject
 * a `fetch`. It is NOT a middleware hook; slice 6e-5 extends this factory with a
 * Logto token-provider path using `buildAuthHeaders`, keeping the sanitizer.
 */
export function createApiClient(
  baseUrl: string,
  options?: CreateApiClientOptions,
): MobileApiClient {
  const {
    getAccessToken,
    shouldAttachAuth = isAuthenticatedApiRequest,
    ...clientOptions
  } = options ?? {};
  const baseFetch = clientOptions.fetch ?? ((input: Request) => globalThis.fetch(input));
  const sanitizingFetch = async (input: Request): Promise<Response> => {
    if (getAccessToken && shouldAttachAuth(input)) {
      let token: string | null | undefined;
      try {
        token = await getAccessToken();
      } catch (error) {
        throw new AuthSessionError("token_unavailable", { cause: error });
      }
      const authHeaders = buildAuthHeaders(token);
      for (const [key, value] of Object.entries(authHeaders)) {
        input.headers.set(key, value);
      }
    }
    for (const key of [...input.headers.keys()]) {
      if (key.toLowerCase().startsWith("x-dev")) {
        input.headers.delete(key);
      }
    }
    return baseFetch(input);
  };

  const client = makeClient(baseUrl, { ...clientOptions, fetch: sanitizingFetch });

  const guard = <V extends "GET" | "POST" | "PUT" | "PATCH" | "DELETE">(verb: V): ApiClient[V] => {
    const method = client[verb] as unknown as (path: unknown, init?: unknown) => unknown;
    const wrapped = (path: unknown, init?: unknown) => {
      let safeInit = init;
      if (init && typeof init === "object") {
        safeInit = { ...(init as Record<string, unknown>) };
        // Strip the escape hatches so a caller cannot bypass `sanitizingFetch`.
        delete (safeInit as Record<string, unknown>).fetch;
        delete (safeInit as Record<string, unknown>).middleware;
      }
      return method(path, safeInit);
    };
    return wrapped as unknown as ApiClient[V];
  };

  const uploadMultipart = async (
    path: string,
    formData: FormData,
  ): Promise<{ status: number; detail?: unknown }> => {
    const url = `${baseUrl}${path}`;
    // React Native's fetch only streams a multipart file FormData (the
    // `{ uri, name, type }` file-part shape) when the FormData is passed DIRECTLY
    // as `fetch(url, { body: formData })`. Wrapping the FormData in a `new
    // Request(...)` (as every other verb does via `sanitizingFetch`) breaks RN's
    // native multipart handling: the file body is silently dropped and the
    // request never leaves the device. So this method builds its own headers
    // (mirroring `sanitizingFetch`'s auth-attach + x-dev-strip behavior) and
    // calls the raw fetch in the `(url, init)` form instead of going through
    // `sanitizingFetch`/`new Request`. Do not "simplify" this back to
    // `sanitizingFetch` - that reintroduces the bug.
    const headers: Record<string, string> = {};
    if (getAccessToken && shouldAttachAuth(new Request(url, { method: "POST" }))) {
      let token: string | null | undefined;
      try {
        token = await getAccessToken();
      } catch (error) {
        throw new AuthSessionError("token_unavailable", { cause: error });
      }
      Object.assign(headers, buildAuthHeaders(token));
    }
    // No x-dev-strip step is needed here: this method builds `headers` itself
    // from scratch (only ever an Authorization header), so an x-dev* header can
    // never appear - there is no caller-supplied header channel to sanitize.
    // Do NOT set Content-Type; React Native derives the multipart boundary from
    // the FormData itself.
    // `clientOptions.fetch` is typed narrowly (`(input: Request) => Promise<Response>`)
    // to match openapi-fetch's `ClientOptions`, but the value actually configured
    // (real `globalThis.fetch`, or a test mock standing in for it) always supports
    // the standard `(url, init)` calling form - it is only ever used that way here.
    const rawFetch = (clientOptions.fetch as typeof fetch | undefined) ?? globalThis.fetch;
    const res = await rawFetch(url, { method: "POST", body: formData, headers });
    if (res.ok) {
      return { status: res.status };
    }
    // On failure, best-effort read the JSON body's `detail` field (e.g. the upload
    // endpoint's two distinct 409 shapes - `display_name_required` vs
    // `photo_limit_fountain`/`photo_limit_user` - are only distinguishable this way; see
    // `mapPhotoUploadError`). A non-JSON or empty error body must never throw here.
    let detail: unknown;
    try {
      const body: unknown = await res.json();
      detail = (body as { detail?: unknown } | null)?.detail;
    } catch {
      detail = undefined;
    }
    return { status: res.status, detail };
  };

  return {
    GET: guard("GET"),
    POST: guard("POST"),
    PUT: guard("PUT"),
    PATCH: guard("PATCH"),
    DELETE: guard("DELETE"),
    uploadMultipart,
  };
}
