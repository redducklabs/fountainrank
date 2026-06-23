// Canonical hyphenated UUID (any version), case-insensitive — the form the API
// serializes fountain ids as and the form our own map pins navigate with.
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Normalize an Expo Router `id` param to a usable fountain id, or `null` when it
 * is absent, an array (unexpected route shape), or not a well-formed UUID. The
 * backend route param is a `uuid.UUID`, so a malformed string would 422 — reject
 * it client-side and show the honest non-retryable "not found" state instead of
 * wasting two public reads on a value we can deterministically refuse.
 */
export function normalizeFountainId(value: string | string[] | undefined): string | null {
  return typeof value === "string" && UUID_RE.test(value) ? value : null;
}
