"use server";

import { revalidatePath } from "next/cache";
import type { components } from "@fountainrank/api-client";
import { getAuthedApiClientForAction } from "../../lib/server/api";
import { log } from "../../lib/server/log";

export type AdminError = "unauthenticated" | "forbidden" | "validation" | "not_found" | "server";
export type AdminActionResult = { ok: true } | { ok: false; error: AdminError };
export type AdminContentType = "photo" | "note" | "fountain";
export type AdminSanctionStatus = "active" | "suspended" | "banned";
type AdminFountainPatch = components["schemas"]["AdminFountainPatch"];

const UUID_RE = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

function fail(error: AdminError): AdminActionResult {
  return { ok: false, error };
}

function mapStatus(status: number): AdminActionResult {
  if (status >= 200 && status < 300) return { ok: true };
  if (status === 401) return fail("unauthenticated");
  if (status === 403) return fail("forbidden");
  if (status === 404) return fail("not_found");
  if (status === 422) return fail("validation");
  return fail("server");
}

async function runAdminAction(
  action: string,
  targetId: string,
  call: (
    client: Awaited<ReturnType<typeof getAuthedApiClientForAction>>,
  ) => Promise<{ response?: { status: number } }>,
): Promise<AdminActionResult> {
  const requestId = crypto.randomUUID();
  let client: Awaited<ReturnType<typeof getAuthedApiClientForAction>>;
  try {
    client = await getAuthedApiClientForAction(requestId);
  } catch (err) {
    log("warn", "admin action auth error", {
      requestId,
      action,
      targetId,
      reason: (err as Error).name,
    });
    return fail("unauthenticated");
  }
  try {
    const { response } = await call(client);
    const status = response?.status ?? 0;
    const result = mapStatus(status);
    log(result.ok ? "info" : "warn", "admin action", {
      requestId,
      action,
      targetId,
      status,
    });
    if (result.ok) {
      revalidatePath("/");
    }
    return result;
  } catch (err) {
    log("warn", "admin action error", {
      requestId,
      action,
      targetId,
      reason: (err as Error).name,
    });
    return fail("server");
  }
}

function cleanText(value: string | null): string | null {
  if (value == null) return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

export async function adminSetUserSanction(
  userId: string,
  status: AdminSanctionStatus,
  reason: string,
  suspendedUntil?: string,
): Promise<AdminActionResult> {
  const cleanReason = cleanText(reason);
  if (!UUID_RE.test(userId) || !cleanReason) return fail("validation");
  const result = await runAdminAction("user_sanction", userId, (client) =>
    client.PATCH("/api/v1/admin/users/{user_id}/sanction", {
      params: { path: { user_id: userId } },
      body: {
        status,
        reason: cleanReason,
        suspended_until: status === "suspended" ? suspendedUntil : null,
      },
    }),
  );
  if (result.ok) revalidatePath("/admin/reports");
  return result;
}

export async function adminUpdateFountain(
  fountainId: string,
  patch: AdminFountainPatch,
): Promise<AdminActionResult> {
  if (!UUID_RE.test(fountainId)) return fail("validation");
  if (!patch || Object.keys(patch).length === 0) return fail("validation");
  if (patch.location) {
    const { latitude, longitude } = patch.location;
    if (
      typeof latitude !== "number" ||
      typeof longitude !== "number" ||
      latitude < -90 ||
      latitude > 90 ||
      longitude < -180 ||
      longitude > 180
    ) {
      return fail("validation");
    }
  }
  return runAdminAction("edit_fountain", fountainId, async (client) => {
    const { response } = await client.PATCH("/api/v1/admin/fountains/{fountain_id}", {
      params: { path: { fountain_id: fountainId } },
      body: patch,
    });
    return { response };
  }).then((result) => {
    if (result.ok) {
      revalidatePath(`/fountains/${fountainId}`);
    }
    return result;
  });
}

export async function adminUpdateFountainFromForm(
  fountainId: string,
  formData: FormData,
): Promise<AdminActionResult> {
  const latitude = Number(formData.get("latitude"));
  const longitude = Number(formData.get("longitude"));
  const isWorking = formData.get("is_working") === "true";
  return adminUpdateFountain(fountainId, {
    location: { latitude, longitude },
    is_working: isWorking,
    placement_note: cleanText(formData.get("placement_note")?.toString() ?? null),
    comments: cleanText(formData.get("comments")?.toString() ?? null),
  });
}

export async function adminSetFountainHidden(
  fountainId: string,
  isHidden: boolean,
  moderationReason?: string,
): Promise<AdminActionResult> {
  if (!UUID_RE.test(fountainId)) return fail("validation");
  const reason = cleanText(moderationReason ?? null);
  const result = await adminUpdateFountain(fountainId, {
    is_hidden: isHidden,
    ...(reason ? { moderation_reason: reason } : {}),
  });
  // Refresh the moderation queue when this is invoked from it (#12).
  if (result.ok) revalidatePath("/admin/reports");
  return result;
}

export async function adminDeleteFountain(
  fountainId: string,
  moderationReason?: string,
): Promise<AdminActionResult> {
  if (!UUID_RE.test(fountainId)) return fail("validation");
  const reason = cleanText(moderationReason ?? null);
  return runAdminAction("delete_fountain", fountainId, async (client) => {
    const { response } = await client.DELETE("/api/v1/admin/fountains/{fountain_id}", {
      params: {
        path: { fountain_id: fountainId },
        ...(reason ? { query: { reason } } : {}),
      },
    });
    return { response };
  }).then((result) => {
    if (result.ok) {
      revalidatePath(`/fountains/${fountainId}`);
      revalidatePath("/admin/reports");
    }
    return result;
  });
}

export async function adminSetNoteHidden(
  noteId: string,
  isHidden: boolean,
  fountainId: string,
  moderationReason?: string,
): Promise<AdminActionResult> {
  if (!UUID_RE.test(noteId) || !UUID_RE.test(fountainId)) return fail("validation");
  const reason = cleanText(moderationReason ?? null);
  return runAdminAction(isHidden ? "hide_note" : "unhide_note", noteId, async (client) => {
    const { response } = await client.PATCH("/api/v1/admin/notes/{note_id}", {
      params: { path: { note_id: noteId } },
      body: { is_hidden: isHidden, ...(reason ? { moderation_reason: reason } : {}) },
    });
    return { response };
  }).then((result) => {
    if (result.ok) {
      revalidatePath(`/fountains/${fountainId}`);
      // Also refresh the moderation queue when this is invoked from it (#12); harmless from
      // the inline fountain-detail controls.
      revalidatePath("/admin/reports");
    }
    return result;
  });
}

export async function adminHidePhoto(
  photoId: string,
  isHidden: boolean,
  moderationReason?: string,
): Promise<AdminActionResult> {
  if (!UUID_RE.test(photoId)) return fail("validation");
  const reason = cleanText(moderationReason ?? null);
  return runAdminAction(isHidden ? "hide_photo" : "unhide_photo", photoId, async (client) => {
    const { response } = await client.PATCH("/api/v1/admin/photos/{photo_id}", {
      params: { path: { photo_id: photoId } },
      body: { is_hidden: isHidden, ...(reason ? { moderation_reason: reason } : {}) },
    });
    return { response };
  }).then((result) => {
    if (result.ok) {
      revalidatePath("/admin/reports");
    }
    return result;
  });
}

// Generalized report dismissal (#12): reject an item's pending reports for any content type,
// used by the unified moderation board for photo/note/fountain. The old photo-specific
// dismiss endpoint stays on the backend for released mobile clients but is no longer called here.
export async function adminDismissReport(
  contentType: AdminContentType,
  contentId: string,
  moderationReason?: string,
): Promise<AdminActionResult> {
  if (!UUID_RE.test(contentId)) return fail("validation");
  if (contentType !== "photo" && contentType !== "note" && contentType !== "fountain") {
    return fail("validation");
  }
  const reason = cleanText(moderationReason ?? null);
  return runAdminAction("dismiss_report", contentId, async (client) => {
    const { response } = await client.POST("/api/v1/admin/reports/dismiss", {
      body: {
        content_type: contentType,
        content_id: contentId,
        ...(reason ? { reason } : {}),
      },
    });
    return { response };
  }).then((result) => {
    if (result.ok) {
      revalidatePath("/admin/reports");
    }
    return result;
  });
}

export async function adminDeletePhoto(
  photoId: string,
  moderationReason?: string,
): Promise<AdminActionResult> {
  if (!UUID_RE.test(photoId)) return fail("validation");
  const reason = cleanText(moderationReason ?? null);
  return runAdminAction("delete_photo", photoId, async (client) => {
    const { response } = await client.DELETE("/api/v1/admin/photos/{photo_id}", {
      params: {
        path: { photo_id: photoId },
        ...(reason ? { query: { reason } } : {}),
      },
    });
    return { response };
  }).then((result) => {
    if (result.ok) {
      revalidatePath("/admin/reports");
    }
    return result;
  });
}

export async function adminDeleteRating(
  ratingId: string,
  fountainId: string,
  reason: string,
): Promise<AdminActionResult> {
  const cleanedReason = cleanText(reason);
  if (!UUID_RE.test(ratingId) || !UUID_RE.test(fountainId) || !cleanedReason) {
    return fail("validation");
  }
  return runAdminAction("delete_rating", ratingId, async (client) => {
    const { response } = await client.DELETE("/api/v1/admin/ratings/{rating_id}", {
      params: { path: { rating_id: ratingId } },
      body: { reason: cleanedReason },
    });
    return { response };
  }).then((result) => {
    if (result.ok) revalidatePath(`/fountains/${fountainId}`);
    return result;
  });
}

// Polled by the client-side badge (W8): keeps the Logto access token server-side. Any
// non-2xx (unauthenticated, forbidden, or a transient server error) degrades quietly to 0
// rather than surfacing a noisy error to a client component that polls unconditionally.
// As of #12 the count spans all report types (photo/note/fountain).
export async function fetchPendingReportCount(): Promise<number> {
  const requestId = crypto.randomUUID();
  try {
    const client = await getAuthedApiClientForAction(requestId);
    const { data, response } = await client.GET("/api/v1/admin/reports/summary", {});
    const status = response?.status ?? 0;
    if (status < 200 || status >= 300 || !data) {
      if (status !== 401 && status !== 403) {
        log("warn", "pending report count non-2xx", { requestId, status });
      }
      return 0;
    }
    return data.pending_count;
  } catch (err) {
    log("warn", "pending report count error", {
      requestId,
      reason: (err as Error).name,
    });
    return 0;
  }
}
