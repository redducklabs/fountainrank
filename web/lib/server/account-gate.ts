import { getLogtoContext } from "@logto/next/server-actions";

import { getLogtoConfig } from "../logto";
import { getAuthedApiClient } from "./api";
import { log } from "./log";
import { syncProfile } from "./sync";

export type MeProfile = {
  display_name: string;
  email: string;
  avatar_url: string | null;
  needs_name: boolean;
};

// The account first-sign-in flow, single-sourced so every account-scoped page (the account
// page and /account/fountains) applies the SAME gate — a name-less user is always held at
// `needs-name`, never able to slip past it on a subpage (#170).
export type AccountGate =
  | { status: "unauthenticated" }
  | { status: "no-profile" }
  | { status: "needs-name" }
  | { status: "ready"; profile: MeProfile };

export async function resolveAccountGate(requestId: string): Promise<AccountGate> {
  const { isAuthenticated } = await getLogtoContext(getLogtoConfig(), { fetchUserInfo: false });
  if (!isAuthenticated) return { status: "unauthenticated" };
  // Best-effort: refresh the stored profile from Logto before reading it (never throws).
  await syncProfile(requestId);
  try {
    const { data, error, response } = await (await getAuthedApiClient(requestId)).GET("/api/v1/me");
    if (error || !data) {
      log("error", "failed to load profile", { requestId, status: response?.status });
      return { status: "no-profile" };
    }
    if (data.needs_name) return { status: "needs-name" };
    return { status: "ready", profile: data };
  } catch (err) {
    // getAccessTokenRSC()/network can throw on an expired or broken session — treat as no-profile
    // so the caller renders a graceful state instead of an unhandled server error.
    log("error", "failed to load profile", { requestId, reason: (err as Error).name });
    return { status: "no-profile" };
  }
}
