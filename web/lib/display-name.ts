export const DISPLAY_NAME_MAX = 80;

// Pure validation shared by the account form and the setDisplayName action: trim, then require
// 1..80 chars. Mirrors the backend UpdateMeRequest constraints.
export function validateDisplayName(raw: string): { ok: true; value: string } | { ok: false } {
  const value = typeof raw === "string" ? raw.trim() : "";
  if (value.length < 1 || value.length > DISPLAY_NAME_MAX) return { ok: false };
  return { ok: true, value };
}
