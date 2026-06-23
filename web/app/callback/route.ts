import { handleSignIn } from "@logto/next/server-actions";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import type { NextRequest } from "next/server";

import { getLogtoConfig } from "../../lib/logto";
import { log } from "../../lib/server/log";
import { RETURN_COOKIE, safeReturnPath } from "../../lib/return-path";
import { syncProfileForRoute } from "../../lib/server/sync";

export const dynamic = "force-dynamic";

// A thrown Next redirect carries a `digest` of "NEXT_REDIRECT;...". handleSignIn() in
// @logto/next can itself redirect internally; that must be rethrown, NOT treated as a
// callback failure, or a successful sign-in would be turned into an error.
function isNextRedirect(error: unknown): boolean {
  const digest = (error as { digest?: unknown }).digest;
  return typeof digest === "string" && digest.startsWith("NEXT_REDIRECT");
}

export async function GET(request: NextRequest): Promise<void> {
  const requestId = crypto.randomUUID();
  let ok = true;
  try {
    await handleSignIn(getLogtoConfig(), request.nextUrl.searchParams);
  } catch (error) {
    if (isNextRedirect(error)) throw error; // a successful internal redirect — let it propagate
    ok = false;
    // Never log the callback query string (it carries the auth `code`).
    log("warn", "logto callback failed", { requestId, reason: (error as Error).name });
  }
  // redirect() throws NEXT_REDIRECT, so it must run OUTSIDE the try/catch above.
  if (!ok) redirect("/account?error=signin");
  // Best-effort: sync profile right after sign-in so the user's real name (e.g. from Apple
  // via Logto userinfo) is captured immediately rather than waiting for /account to load.
  await syncProfileForRoute(requestId);
  const store = await cookies();
  const raw = store.get(RETURN_COOKIE)?.value;
  store.delete({ name: RETURN_COOKIE, path: "/" });
  redirect(safeReturnPath(raw) ?? "/account");
}
