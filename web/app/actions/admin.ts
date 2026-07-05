"use server";

import { revalidatePath } from "next/cache";
import type { components } from "@fountainrank/api-client";
import { getAuthedApiClientForAction } from "../../lib/server/api";
import { log } from "../../lib/server/log";

export type AdminError = "unauthenticated" | "forbidden" | "validation" | "not_found" | "server";
export type AdminActionResult = { ok: true } | { ok: false; error: AdminError };
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
): Promise<AdminActionResult> {
  if (!UUID_RE.test(fountainId)) return fail("validation");
  return adminUpdateFountain(fountainId, { is_hidden: isHidden });
}

export async function adminDeleteFountain(fountainId: string): Promise<AdminActionResult> {
  if (!UUID_RE.test(fountainId)) return fail("validation");
  return runAdminAction("delete_fountain", fountainId, async (client) => {
    const { response } = await client.DELETE("/api/v1/admin/fountains/{fountain_id}", {
      params: { path: { fountain_id: fountainId } },
    });
    return { response };
  }).then((result) => {
    if (result.ok) {
      revalidatePath(`/fountains/${fountainId}`);
    }
    return result;
  });
}

export async function adminSetNoteHidden(
  noteId: string,
  isHidden: boolean,
  fountainId: string,
): Promise<AdminActionResult> {
  if (!UUID_RE.test(noteId) || !UUID_RE.test(fountainId)) return fail("validation");
  return runAdminAction(isHidden ? "hide_note" : "unhide_note", noteId, async (client) => {
    const { response } = await client.PATCH("/api/v1/admin/notes/{note_id}", {
      params: { path: { note_id: noteId } },
      body: { is_hidden: isHidden },
    });
    return { response };
  }).then((result) => {
    if (result.ok) {
      revalidatePath(`/fountains/${fountainId}`);
    }
    return result;
  });
}

export async function adminHidePhoto(
  photoId: string,
  isHidden: boolean,
): Promise<AdminActionResult> {
  if (!UUID_RE.test(photoId)) return fail("validation");
  return runAdminAction(isHidden ? "hide_photo" : "unhide_photo", photoId, async (client) => {
    const { response } = await client.PATCH("/api/v1/admin/photos/{photo_id}", {
      params: { path: { photo_id: photoId } },
      body: { is_hidden: isHidden },
    });
    return { response };
  }).then((result) => {
    if (result.ok) {
      revalidatePath("/admin/reports");
    }
    return result;
  });
}

export async function adminDismissPhotoReports(photoId: string): Promise<AdminActionResult> {
  if (!UUID_RE.test(photoId)) return fail("validation");
  return runAdminAction("dismiss_photo_reports", photoId, async (client) => {
    const { response } = await client.POST("/api/v1/admin/photos/{photo_id}/dismiss-reports", {
      params: { path: { photo_id: photoId } },
    });
    return { response };
  }).then((result) => {
    if (result.ok) {
      revalidatePath("/admin/reports");
    }
    return result;
  });
}

export async function adminDeletePhoto(photoId: string): Promise<AdminActionResult> {
  if (!UUID_RE.test(photoId)) return fail("validation");
  return runAdminAction("delete_photo", photoId, async (client) => {
    const { response } = await client.DELETE("/api/v1/admin/photos/{photo_id}", {
      params: { path: { photo_id: photoId } },
    });
    return { response };
  }).then((result) => {
    if (result.ok) {
      revalidatePath("/admin/reports");
    }
    return result;
  });
}

// Polled by the client-side badge (W8): keeps the Logto access token server-side. Any
// non-2xx (unauthenticated, forbidden, or a transient server error) degrades quietly to 0
// rather than surfacing a noisy error to a client component that polls unconditionally.
export async function fetchPendingReportCount(): Promise<number> {
  const requestId = crypto.randomUUID();
  try {
    const client = await getAuthedApiClientForAction(requestId);
    const { data, response } = await client.GET("/api/v1/admin/photo-reports/summary", {});
    const status = response?.status ?? 0;
    if (status < 200 || status >= 300 || !data) {
      if (status !== 401 && status !== 403) {
        log("warn", "pending report count non-2xx", { requestId, status });
      }
      return 0;
    }
    return data.pending_photo_count;
  } catch (err) {
    log("warn", "pending report count error", {
      requestId,
      reason: (err as Error).name,
    });
    return 0;
  }
}
