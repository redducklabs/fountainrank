import { makeClient, type ApiClient } from "@fountainrank/api-client";

import { AuthSessionError } from "./auth/state";
import { logEvent } from "./log";

/**
 * Per-request deadlines (spec §1). React Native's `fetch` has no default timeout, so a
 * socket that stalls mid-flight (cell handoff while moving) leaves a request pending
 * forever. Reads are bounded tighter than writes; both are exported for tests.
 */
export const READ_TIMEOUT_MS = 15_000;
export const WRITE_TIMEOUT_MS = 30_000;

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
 * A request that exceeded its client-side deadline (spec §1). Deliberately NOT an
 * `ApiError` (it has no HTTP status): the server outcome is UNKNOWN, so the add flow
 * recovers by reconciliation rather than treating it as a definitive failure, and
 * `resolveViewState` maps it to the offline/network shape (no numeric `status`). Carries
 * the method + URL path (never the query) + the elapsed deadline for diagnostics.
 */
export class ApiTimeoutError extends Error {
  constructor(
    public readonly method: string,
    public readonly path: string,
    public readonly timeoutMs: number,
  ) {
    super(`Request ${method} ${path} exceeded its ${timeoutMs}ms deadline`);
    this.name = "ApiTimeoutError";
  }
}

/**
 * The reason an `AbortSignal` fired: the caller's own `reason` when present (preserving
 * TanStack cancellation / screen-teardown semantics), else a synthesized `AbortError`
 * (`signal.reason` is not guaranteed on every Hermes runtime).
 */
function abortReason(signal: AbortSignal): unknown {
  const reason = (signal as { reason?: unknown }).reason;
  if (reason !== undefined) {
    return reason;
  }
  const error = new Error("The operation was aborted.");
  error.name = "AbortError";
  return error;
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
   * Multipart file upload (e.g. fountain photos). openapi-fetch's typed client doesn't fit
   * multipart/form-data bodies, AND React Native's New Architecture rejects the `{ uri, name,
   * type }` FormData file-part shape at request time (`Error: Unsupported FormDataPart
   * implementation`), so a `fetch(url, { body: formData })` upload throws before the request ever
   * leaves the device. This method instead delegates to a NATIVE multipart uploader
   * (`expo-file-system`'s `uploadAsync`, injected as `uploadFile` by the provider), which streams
   * the file from its `uri` without going through RN's FormData/Blob layer. It builds its own
   * headers using the SAME `getAccessToken`/`buildAuthHeaders` auth path (no second, unaudited
   * auth mechanism). Do not set `Content-Type`; the native uploader sets the multipart boundary.
   */
  uploadMultipart(
    path: string,
    file: { uri: string; type: string },
  ): Promise<{ status: number; data?: unknown; detail?: unknown }>;
};

type MakeClientOptions = Parameters<typeof makeClient>[1];

/**
 * A native multipart file uploader (e.g. `expo-file-system`'s `uploadAsync`), injected by the
 * provider so `lib/api.ts` stays free of native-module imports and remains unit-testable in Node.
 * Performs a `multipart/form-data` POST with the file at `fileUri` as one part (named `fieldName`)
 * and resolves with the HTTP status + raw response body. Used instead of `fetch`+`FormData`
 * because React Native's New Architecture rejects the `{ uri, name, type }` FormData file-part
 * shape (`Error: Unsupported FormDataPart implementation`), throwing before the request is sent.
 */
export type NativeFileUpload = (
  url: string,
  fileUri: string,
  options: {
    httpMethod: "POST";
    fieldName: string;
    mimeType?: string;
    headers: Record<string, string>;
  },
) => Promise<{ status: number; body: string }>;

export type CreateApiClientOptions = MakeClientOptions & {
  getAccessToken?: () => Promise<string | null | undefined>;
  shouldAttachAuth?: (request: Request) => boolean;
  uploadFile?: NativeFileUpload;
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
    uploadFile,
    ...clientOptions
  } = options ?? {};
  const baseFetch = clientOptions.fetch ?? ((input: Request) => globalThis.fetch(input));
  const sanitizingFetch = async (input: Request): Promise<Response> => {
    // A Request always carries a signal (a default, never-aborting one when the caller
    // passed none); when the caller DID pass one (TanStack cancellation / screen
    // teardown), it is that signal.
    const inbound: AbortSignal | null = input.signal ?? null;
    // Pre-aborted inbound signal: reject immediately with the caller's reason and
    // dispatch nothing (never build/send the request).
    if (inbound?.aborted) {
      throw abortReason(inbound);
    }

    const method = input.method.toUpperCase();
    const timeoutMs = method === "GET" ? READ_TIMEOUT_MS : WRITE_TIMEOUT_MS;
    const path = requestPath(input);

    // The composed controller: the deadline and an inbound abort both funnel into it, so
    // the request actually dispatched is cancelled at the network layer either way.
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    let onInboundAbort: (() => void) | undefined;
    // Single-winner guard between the deadline and an inbound abort — gates the one-time
    // `api_timeout` log and ensures exactly one terminal rejection identity.
    let outcome: "pending" | "deadline" | "inbound" = "pending";

    // Rejects on whichever ceiling fires first. This covers the WHOLE pipeline, including
    // token acquisition, because `dispatch()` awaits the token before it is raced here.
    const deadline = new Promise<never>((_resolve, reject) => {
      timer = setTimeout(() => {
        if (outcome !== "pending") return;
        outcome = "deadline";
        controller.abort();
        // Diagnostics: method + URL path only — never the query, headers, body, token, or
        // coordinates (spec §1). Caller aborts are routine and are NOT logged.
        logEvent({ event: "api_timeout", method, path, timeout_ms: timeoutMs, source: "deadline" });
        reject(new ApiTimeoutError(method, path, timeoutMs));
      }, timeoutMs);
      if (inbound) {
        onInboundAbort = () => {
          if (outcome !== "pending") return;
          outcome = "inbound";
          controller.abort();
          // Preserve the caller's cancellation reason — NEVER convert it to a timeout.
          reject(abortReason(inbound));
        };
        inbound.addEventListener("abort", onInboundAbort);
      }
    });

    const dispatch = async (): Promise<Response> => {
      // A signal cannot be retrofitted onto an existing Request, so the request actually
      // sent is rebuilt from `input` + the composed controller signal; auth injection and
      // the x-dev sanitizer below run against THIS request — the bytes on the wire.
      const request = new Request(input, { signal: controller.signal });
      if (getAccessToken && shouldAttachAuth(request)) {
        let token: string | null | undefined;
        try {
          token = await getAccessToken();
        } catch (error) {
          throw new AuthSessionError("token_unavailable", { cause: error });
        }
        const authHeaders = buildAuthHeaders(token);
        for (const [key, value] of Object.entries(authHeaders)) {
          request.headers.set(key, value);
        }
      }
      for (const key of [...request.headers.keys()]) {
        if (key.toLowerCase().startsWith("x-dev")) {
          request.headers.delete(key);
        }
      }
      // The deadline (or an inbound abort) may have fired while the token was pending.
      // Discard a late token and dispatch NOTHING — never a late or tokenless request.
      // The `deadline` race has already produced the terminal rejection; mirror it.
      if (controller.signal.aborted) {
        return deadline;
      }
      return baseFetch(request);
    };

    try {
      return await Promise.race([dispatch(), deadline]);
    } finally {
      if (timer) clearTimeout(timer);
      if (inbound && onInboundAbort) inbound.removeEventListener("abort", onInboundAbort);
    }
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
    file: { uri: string; type: string },
  ): Promise<{ status: number; data?: unknown; detail?: unknown }> => {
    if (!uploadFile) {
      // The provider always injects `uploadFile`; a missing one is a wiring bug, not a runtime
      // condition, so fail loudly rather than silently no-op an upload.
      throw new Error("uploadMultipart requires a native uploadFile implementation");
    }
    const url = `${baseUrl}${path}`;
    // Build the auth header via the SAME token path as `sanitizingFetch` (no second, unaudited
    // auth mechanism). A token-provider failure surfaces as AuthSessionError, never a silent
    // tokenless upload. No x-dev-strip step is needed: these headers are built here from scratch
    // (only ever an Authorization header), so an x-dev* header can never appear.
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
    // Delegate to the native uploader (expo-file-system `uploadAsync`, MULTIPART). It streams the
    // file from `file.uri` as a multipart/form-data part named "file" and sets the boundary +
    // Content-Type itself. This replaces a `fetch(url, { body: formData })` upload, which throws
    // `Error: Unsupported FormDataPart implementation` on RN's New Architecture (the `{ uri, name,
    // type }` file-part shape is rejected before the request is sent). Do NOT set Content-Type.
    const res = await uploadFile(url, file.uri, {
      httpMethod: "POST",
      fieldName: "file",
      mimeType: file.type,
      headers,
    });
    if (res.status >= 200 && res.status < 300) {
      // Parse the success body so the caller can read PhotoOut.points_awarded (#204). Previously
      // it was discarded, so a 2nd photo (which awards 0) still fired a celebration.
      let data: unknown;
      try {
        data = res.body ? JSON.parse(res.body) : undefined;
      } catch {
        data = undefined; // a non-JSON success body -> no verifiable award -> no celebration
      }
      return { status: res.status, data };
    }
    // On failure, best-effort read the JSON body's `detail` field (e.g. the upload endpoint's two
    // distinct 409 shapes - `display_name_required` vs `photo_limit_fountain`/`photo_limit_user` -
    // are only distinguishable this way; see `mapPhotoUploadError`). A non-JSON or empty error
    // body must never throw here.
    let detail: unknown;
    try {
      const body: unknown = JSON.parse(res.body);
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
