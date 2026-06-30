export const DISPLAY_NAME_MAX = 80;

// Pure validation shared by the account form: trim, then require 1..80 chars. Mirrors the backend
// UpdateMeRequest constraints and the web helper.
export function validateDisplayName(raw: string): { ok: true; value: string } | { ok: false } {
  const value = typeof raw === "string" ? raw.trim() : "";
  if (value.length < 1 || value.length > DISPLAY_NAME_MAX) return { ok: false };
  return { ok: true, value };
}

// The root name-gate decision (kill Anonymous). Sign-in can start from the map (not just the
// account tab), so once authenticated and still name-less, force the account capture screen —
// unless the user is already on it.
export function shouldRouteToNameGate(
  status: string,
  needsName: boolean,
  onAccountRoute: boolean,
): boolean {
  return status === "authenticated" && needsName && !onAccountRoute;
}
