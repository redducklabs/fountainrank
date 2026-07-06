"use server";
import { revalidatePath } from "next/cache";
import type { components } from "@fountainrank/api-client";
import { getAuthedApiClientForAction, getActionAccessToken } from "../../lib/server/api";
import { log } from "../../lib/server/log";
import { resolveApiBaseUrl } from "../../lib/api";
import {
  REPORT_CATEGORIES,
  type ReportContentType,
} from "../../components/fountain/reportCategories";

type ConditionStatus = components["schemas"]["ConditionReportRequest"]["status"];
export type ContributeError =
  | "unauthenticated"
  | "validation"
  | "not_found"
  | "needs_name"
  | "server"
  // Photo-upload-only conflict: `photo_limit_fountain`/`photo_limit_user` (distinct from the
  // shared `needs_name` 409 gate — see `uploadPhoto`).
  | "photo_limit"
  | "rate_limited"
  // Photo-upload-only: 413 (too large) / 415 (unsupported type) — a client-input problem, but
  // distinct from `validation` (422) so the UI can show file-specific guidance.
  | "file_invalid";
export type ActionResult =
  { ok: true; pointsAwarded?: number } | { ok: false; error: ContributeError };

const UUID_RE = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;
const CONDITION_STATUSES: ReadonlySet<string> = new Set([
  "working",
  "broken",
  "low_pressure",
  "dirty",
  "bad_taste",
  "blocked",
  "seasonal_unavailable",
  "hours_limited",
]);

function fail(error: ContributeError): ActionResult {
  return { ok: false, error };
}
function readPointsAwarded(data: unknown): number | undefined {
  if (data && typeof data === "object" && "condition_points_awarded" in data) {
    const value = (data as { condition_points_awarded?: unknown }).condition_points_awarded;
    return typeof value === "number" ? value : undefined;
  }
  return undefined;
}
function mapStatus(status: number): ActionResult {
  if (status >= 200 && status < 300) return { ok: true };
  if (status === 401) return fail("unauthenticated");
  if (status === 404) return fail("not_found");
  if (status === 422) return fail("validation");
  if (status === 429) return fail("rate_limited");
  // These endpoints have only ONE 409 shape — the name gate (require_named_user). The user must
  // set a display name before contributing; the UI routes them to /account.
  if (status === 409) return fail("needs_name");
  return fail("server");
}

async function run(
  fountainId: string,
  action: string,
  call: (
    client: Awaited<ReturnType<typeof getAuthedApiClientForAction>>,
  ) => Promise<{ response?: { status: number }; data?: unknown }>,
): Promise<ActionResult> {
  const requestId = crypto.randomUUID();
  // Split the two failure classes: a token/session failure (getAccessToken throws) is
  // "unauthenticated"; a POST/network failure (backend down, fetch threw) is "server".
  // Collapsing both into "unauthenticated" would tell users to sign in again when the
  // backend is merely down.
  let client: Awaited<ReturnType<typeof getAuthedApiClientForAction>>;
  try {
    client = await getAuthedApiClientForAction(requestId);
  } catch (err) {
    log("warn", "contribute auth error", {
      requestId,
      action,
      fountainId,
      reason: (err as Error).name,
    });
    return fail("unauthenticated");
  }
  try {
    const { response, data } = await call(client);
    const status = response?.status ?? 0;
    if (status >= 200 && status < 300) {
      revalidatePath(`/fountains/${fountainId}`);
      revalidatePath("/");
      log("info", "contribute action", { requestId, action, fountainId, status });
      return { ok: true, pointsAwarded: readPointsAwarded(data) };
    }
    const result = mapStatus(status);
    log("warn", "contribute action", { requestId, action, fountainId, status });
    return result;
  } catch (err) {
    log("warn", "contribute action error", {
      requestId,
      action,
      fountainId,
      reason: (err as Error).name,
    });
    return fail("server");
  }
}

export async function submitRating(
  fountainId: string,
  ratings: { rating_type_id: number; stars: number }[],
): Promise<ActionResult> {
  if (!UUID_RE.test(fountainId)) return fail("validation");
  if (
    !Array.isArray(ratings) ||
    ratings.length === 0 ||
    !ratings.every(
      (r) =>
        Number.isInteger(r?.rating_type_id) &&
        r.rating_type_id > 0 &&
        Number.isInteger(r?.stars) &&
        r.stars >= 1 &&
        r.stars <= 5,
    )
  ) {
    return fail("validation");
  }
  return run(fountainId, "rate", (client) =>
    client.POST("/api/v1/fountains/{fountain_id}/ratings", {
      params: { path: { fountain_id: fountainId } },
      body: { ratings },
    }),
  );
}

export async function submitCondition(
  fountainId: string,
  status: ConditionStatus,
): Promise<ActionResult> {
  if (!UUID_RE.test(fountainId)) return fail("validation");
  if (!CONDITION_STATUSES.has(status)) return fail("validation");
  return run(fountainId, "condition", (client) =>
    client.POST("/api/v1/fountains/{fountain_id}/conditions", {
      params: { path: { fountain_id: fountainId } },
      body: { status, is_proximate: false },
    }),
  );
}

export async function submitNote(fountainId: string, body: string): Promise<ActionResult> {
  if (!UUID_RE.test(fountainId)) return fail("validation");
  const trimmed = typeof body === "string" ? body.trim() : "";
  if (trimmed.length < 1 || trimmed.length > 1000) return fail("validation");
  return run(fountainId, "note", (client) =>
    client.POST("/api/v1/fountains/{fountain_id}/notes", {
      params: { path: { fountain_id: fountainId } },
      body: { body: trimmed },
    }),
  );
}

export async function submitAttributes(
  fountainId: string,
  observations: { attribute_type_id: number; value: string }[],
): Promise<ActionResult> {
  if (!UUID_RE.test(fountainId)) return fail("validation");
  if (
    !Array.isArray(observations) ||
    observations.length === 0 ||
    !observations.every(
      (o) =>
        Number.isInteger(o?.attribute_type_id) &&
        o.attribute_type_id > 0 &&
        typeof o.value === "string" &&
        o.value.trim().length > 0,
    )
  ) {
    return fail("validation");
  }
  return run(fountainId, "attributes", (client) =>
    client.POST("/api/v1/fountains/{fountain_id}/attributes", {
      params: { path: { fountain_id: fountainId } },
      body: { observations: observations.map((o) => ({ ...o, value: o.value.trim() })) },
    }),
  );
}

// Multipart upload does not fit the typed openapi-fetch client, so this issues a raw `fetch`
// directly rather than going through `run(...)`. The access token is read server-side via
// `getActionAccessToken` and never returned to the client.
export async function uploadPhoto(fountainId: string, formData: FormData): Promise<ActionResult> {
  if (!UUID_RE.test(fountainId)) return fail("validation");
  const requestId = crypto.randomUUID();

  let token: string;
  try {
    token = await getActionAccessToken(requestId);
  } catch (err) {
    log("warn", "contribute auth error", {
      requestId,
      action: "upload_photo",
      fountainId,
      reason: (err as Error).name,
    });
    return fail("unauthenticated");
  }

  let response: Response;
  try {
    response = await fetch(`${resolveApiBaseUrl()}/api/v1/fountains/${fountainId}/photos`, {
      method: "POST",
      // Deliberately NOT setting Content-Type: the fetch implementation derives the
      // multipart boundary from the FormData body itself.
      headers: { Authorization: `Bearer ${token}`, "X-Request-ID": requestId },
      body: formData,
    });
  } catch (err) {
    log("warn", "contribute action error", {
      requestId,
      action: "upload_photo",
      fountainId,
      reason: (err as Error).name,
    });
    return fail("server");
  }

  const status = response.status;
  let result: ActionResult;
  if (status >= 200 && status < 300) {
    result = { ok: true };
  } else if (status === 401) {
    result = fail("unauthenticated");
  } else if (status === 404) {
    result = fail("not_found");
  } else if (status === 413 || status === 415) {
    result = fail("file_invalid");
  } else if (status === 422) {
    result = fail("validation");
  } else if (status === 429) {
    result = fail("rate_limited");
  } else if (status === 409) {
    // Two distinct 409 shapes on this endpoint: the shared name gate
    // (`display_name_required`) and the photo-upload-only quota conflicts
    // (`photo_limit_fountain` / `photo_limit_user`). Only the JSON body disambiguates them.
    let detail: unknown;
    try {
      detail = (await response.json())?.detail;
    } catch {
      detail = undefined;
    }
    result =
      detail === "photo_limit_fountain" || detail === "photo_limit_user"
        ? fail("photo_limit")
        : fail("needs_name");
  } else {
    result = fail("server");
  }

  log(result.ok ? "info" : "warn", "contribute action", {
    requestId,
    action: "upload_photo",
    fountainId,
    status,
  });
  if (result.ok) {
    revalidatePath(`/fountains/${fountainId}`);
    revalidatePath("/");
  }
  return result;
}

// Generalized content report (#11): POSTs the nested report endpoint matching `contentType`.
// Category is validated against the per-type allowed set (mirrors the backend chokepoint,
// spec §6) BEFORE any API call. For a fountain report the endpoint has no separate content-id
// path param — `contentId` is the fountain itself (callers pass `contentId === fountainId`).
export async function reportContent(
  contentType: ReportContentType,
  fountainId: string,
  contentId: string,
  category: string,
  note?: string,
): Promise<ActionResult> {
  if (!UUID_RE.test(fountainId) || !UUID_RE.test(contentId)) return fail("validation");
  const allowed = REPORT_CATEGORIES[contentType];
  if (!allowed || !allowed.includes(category)) return fail("validation");
  const trimmedNote = typeof note === "string" ? note.trim() : undefined;
  const body = { category, note: trimmedNote || undefined };
  if (contentType === "photo") {
    return run(fountainId, "report_photo", (client) =>
      client.POST("/api/v1/fountains/{fountain_id}/photos/{photo_id}/report", {
        params: { path: { fountain_id: fountainId, photo_id: contentId } },
        body,
      }),
    );
  }
  if (contentType === "note") {
    return run(fountainId, "report_note", (client) =>
      client.POST("/api/v1/fountains/{fountain_id}/notes/{note_id}/report", {
        params: { path: { fountain_id: fountainId, note_id: contentId } },
        body,
      }),
    );
  }
  return run(fountainId, "report_fountain", (client) =>
    client.POST("/api/v1/fountains/{fountain_id}/report", {
      params: { path: { fountain_id: fountainId } },
      body,
    }),
  );
}

export async function deleteOwnPhoto(fountainId: string, photoId: string): Promise<ActionResult> {
  if (!UUID_RE.test(fountainId) || !UUID_RE.test(photoId)) return fail("validation");
  return run(fountainId, "delete_photo", (client) =>
    client.DELETE("/api/v1/fountains/{fountain_id}/photos/{photo_id}", {
      params: { path: { fountain_id: fountainId, photo_id: photoId } },
    }),
  );
}
