"use server";
import { revalidatePath } from "next/cache";
import type { components } from "@fountainrank/api-client";
import { getAuthedApiClientForAction } from "../../lib/server/api";
import { log } from "../../lib/server/log";

type ConditionStatus = components["schemas"]["ConditionReportRequest"]["status"];
export type ContributeError =
  "unauthenticated" | "validation" | "not_found" | "needs_name" | "server";
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
