"use server";
import { signOut } from "@logto/next/server-actions";
import { revalidatePath } from "next/cache";

import { validateDisplayName } from "../../lib/display-name";
import { getLogtoConfig } from "../../lib/logto";
import { getAuthedApiClientForAction } from "../../lib/server/api";
import { log } from "../../lib/server/log";

export type SetNameError = "unauthenticated" | "validation" | "server";
export type SetNameResult = { ok: true } | { ok: false; error: SetNameError };
export type DeleteAccountError = "unauthenticated" | "server";
export type DeleteAccountResult = { ok: true } | { ok: false; error: DeleteAccountError };

// Set the signed-in user's display name (stored backend-side as a nickname override). Mirrors the
// contribute actions' shape: a token/session failure is "unauthenticated"; a backend 422 is
// "validation"; any other non-2xx or a network throw is "server".
export async function setDisplayName(name: string): Promise<SetNameResult> {
  const v = validateDisplayName(name);
  if (!v.ok) return { ok: false, error: "validation" };
  const requestId = crypto.randomUUID();
  let client: Awaited<ReturnType<typeof getAuthedApiClientForAction>>;
  try {
    client = await getAuthedApiClientForAction(requestId);
  } catch (err) {
    log("warn", "set-name auth error", { requestId, reason: (err as Error).name });
    return { ok: false, error: "unauthenticated" };
  }
  try {
    const { response } = await client.PATCH("/api/v1/me", { body: { display_name: v.value } });
    const status = response?.status ?? 0;
    if (status >= 200 && status < 300) {
      revalidatePath("/account");
      revalidatePath("/leaderboard");
      log("info", "set-name", { requestId, status });
      return { ok: true };
    }
    if (status === 401) return { ok: false, error: "unauthenticated" };
    if (status === 422) return { ok: false, error: "validation" };
    log("warn", "set-name failed", { requestId, status });
    return { ok: false, error: "server" };
  } catch (err) {
    log("warn", "set-name error", { requestId, reason: (err as Error).name });
    return { ok: false, error: "server" };
  }
}

export async function deleteAccount(): Promise<DeleteAccountResult> {
  const requestId = crypto.randomUUID();
  let client: Awaited<ReturnType<typeof getAuthedApiClientForAction>>;
  try {
    client = await getAuthedApiClientForAction(requestId);
  } catch (err) {
    log("warn", "delete-account auth error", { requestId, reason: (err as Error).name });
    return { ok: false, error: "unauthenticated" };
  }
  try {
    const { response } = await client.DELETE("/api/v1/me");
    const status = response?.status ?? 0;
    if (status === 401) return { ok: false, error: "unauthenticated" };
    if (status < 200 || status >= 300) {
      log("warn", "delete-account failed", { requestId, status });
      return { ok: false, error: "server" };
    }
    log("info", "delete-account", { requestId, status });
  } catch (err) {
    log("warn", "delete-account error", { requestId, reason: (err as Error).name });
    return { ok: false, error: "server" };
  }
  const config = getLogtoConfig();
  await signOut(config, config.baseUrl);
  return { ok: true };
}
