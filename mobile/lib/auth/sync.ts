/**
 * Best-effort profile sync after native sign-in — the mobile analog of the web
 * `syncProfile` (#62). The backend's first-seen fallback sets `display_name = sub`
 * (a raw opaque Logto id); without a sync the Account screen and avatar initial
 * show that id instead of the real name (#103).
 *
 * Mirrors the web `postProfileSync`: forward the OPAQUE Logto access token to
 * `POST /api/v1/me/sync`, authenticated with the resource JWT. The backend calls
 * Logto userinfo with the opaque token, verifies the subject, and writes the real
 * `display_name`/`email`/`avatar_url`.
 *
 * SECURITY (spec section 14): only the two fixed headers below are sent — never an
 * `X-Dev-*` dev-auth header, in any build profile.
 *
 * This NEVER throws and is time-bounded so a hung or unreachable backend cannot
 * stall sign-in. Returns the outcome for diagnostics (callers ignore it).
 */
export type ProfileSyncResult = "synced" | "skipped" | "failed";

export async function syncProfileOnSignIn(params: {
  apiBaseUrl: string;
  resourceToken: string | null | undefined;
  userinfoToken: string | null | undefined;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}): Promise<ProfileSyncResult> {
  const { apiBaseUrl, resourceToken, userinfoToken, fetchImpl = fetch, timeoutMs = 3000 } = params;

  if (!resourceToken || !userinfoToken) {
    return "skipped";
  }

  // Manual AbortController + timer rather than AbortSignal.timeout, which is not
  // guaranteed on the React Native (Hermes) runtime.
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchImpl(`${apiBaseUrl}/api/v1/me/sync`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${resourceToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ userinfo_token: userinfoToken }),
      signal: controller.signal,
    });
    return response.ok ? "synced" : "failed";
  } catch {
    return "failed";
  } finally {
    clearTimeout(timer);
  }
}
