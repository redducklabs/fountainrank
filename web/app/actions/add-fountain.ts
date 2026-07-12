"use server";
import { revalidatePath } from "next/cache";
import type { components } from "@fountainrank/api-client";
import { awardedPoints } from "./awarded";
import { getAuthedApiClientForAction } from "../../lib/server/api";
import { log } from "../../lib/server/log";
import {
  isUuid,
  isValidAddFountainInput,
  toAddFountainBody,
  type AddFountainInput,
  type AddFountainResult,
} from "../../lib/add-fountain";

export async function addFountain(input: AddFountainInput): Promise<AddFountainResult> {
  const requestId = crypto.randomUUID();
  if (!isValidAddFountainInput(input)) {
    log("warn", "add-fountain", { requestId, outcome: "validation" });
    return { ok: false, error: "validation" };
  }
  let client: Awaited<ReturnType<typeof getAuthedApiClientForAction>>;
  try {
    client = await getAuthedApiClientForAction(requestId);
  } catch (err) {
    log("warn", "add-fountain auth error", { requestId, reason: (err as Error).name });
    return { ok: false, error: "unauthenticated" };
  }
  try {
    // openapi-fetch surfaces a non-2xx typed body on `error`, not `data`.
    const { data, error, response } = await client.POST("/api/v1/fountains", {
      body: toAddFountainBody(input),
    });
    const status = response?.status ?? 0;
    if (status === 201 && data) {
      const fountainId = (data as components["schemas"]["FountainDetail"]).id;
      const pointsAwarded = awardedPoints(data);
      revalidatePath("/");
      log("info", "add-fountain", { requestId, outcome: "created", status, pointsAwarded });
      return { ok: true, fountainId, pointsAwarded };
    }
    if (status === 409) {
      // add_fountain has TWO 409 shapes: the duplicate-proximity conflict (carries a fountain_id)
      // and the name gate (detail === "display_name_required"). Branch on the typed body.
      const body = error as
        | components["schemas"]["DuplicateFountainConflict"]
        | components["schemas"]["DisplayNameRequiredConflict"]
        | undefined;
      const dup = body as components["schemas"]["DuplicateFountainConflict"] | undefined;
      if (dup && isUuid(dup.fountain_id)) {
        log("info", "add-fountain", { requestId, outcome: "duplicate", status });
        return { ok: false, error: "duplicate", fountainId: dup.fountain_id };
      }
      if ((body as { detail?: string } | undefined)?.detail === "display_name_required") {
        log("info", "add-fountain", { requestId, outcome: "needs_name", status });
        return { ok: false, error: "needs_name" };
      }
      log("warn", "add-fountain", { requestId, outcome: "malformed-409", status });
      return { ok: false, error: "server" };
    }
    if (status === 401) {
      log("warn", "add-fountain", { requestId, outcome: "unauthenticated", status });
      return { ok: false, error: "unauthenticated" };
    }
    if (status === 422) {
      log("warn", "add-fountain", { requestId, outcome: "validation", status });
      return { ok: false, error: "validation" };
    }
    log("warn", "add-fountain", { requestId, outcome: "server", status });
    return { ok: false, error: "server" };
  } catch (err) {
    log("warn", "add-fountain error", { requestId, reason: (err as Error).name });
    return { ok: false, error: "server" };
  }
}
