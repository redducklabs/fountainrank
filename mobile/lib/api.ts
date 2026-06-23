import { makeClient, type ApiClient } from "@fountainrank/api-client";

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
export type MobileApiClient = Pick<ApiClient, "GET" | "POST" | "PUT" | "PATCH" | "DELETE">;

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
  options?: Parameters<typeof makeClient>[1],
): MobileApiClient {
  const baseFetch = options?.fetch ?? ((input: Request) => globalThis.fetch(input));
  const sanitizingFetch = async (input: Request): Promise<Response> => {
    for (const key of [...input.headers.keys()]) {
      if (key.toLowerCase().startsWith("x-dev")) {
        input.headers.delete(key);
      }
    }
    return baseFetch(input);
  };

  const client = makeClient(baseUrl, { ...options, fetch: sanitizingFetch });

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

  return {
    GET: guard("GET"),
    POST: guard("POST"),
    PUT: guard("PUT"),
    PATCH: guard("PATCH"),
    DELETE: guard("DELETE"),
  };
}
