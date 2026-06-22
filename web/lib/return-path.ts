// Open-redirect defense for the post-sign-in return path. Accepts ONLY a safe internal
// path; everything else -> null. Re-validated on read in app/callback/route.ts.

// Name of the httpOnly cookie that carries the post-sign-in return path. Lives here (a plain
// module) rather than in the "use server" actions module, where only async function exports
// are legal and a non-function export breaks `next build`.
export const RETURN_COOKIE = "fr_return_to";

function hasControlOrSeparator(s: string): boolean {
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c <= 0x1f || c === 0x7f || c === 0x2028 || c === 0x2029) return true;
  }
  return false;
}

export function safeReturnPath(value: string | null | undefined): string | null {
  if (typeof value !== "string" || value.length === 0 || value.length > 512) return null;
  // Must be a single-slash-rooted path (reject protocol-relative `//` and `/\`).
  if (!value.startsWith("/") || value.startsWith("//") || value.startsWith("/\\")) return null;
  if (value.includes("\\")) return null;
  if (value.includes("://")) return null;
  if (hasControlOrSeparator(value)) return null;
  // Decode percent-encoding once and re-apply the checks so encoded hostile forms
  // (%5c, %2f%2f, %00, ...) can't slip through. Malformed % -> reject.
  let decoded: string;
  try {
    decoded = decodeURIComponent(value);
  } catch {
    return null;
  }
  if (
    decoded.includes("\\") || // any backslash (e.g. decoded %5c) is hostile
    decoded.startsWith("//") || // protocol-relative after decode (covers decoded %2f%2f -> ///)
    decoded.startsWith("/\\") ||
    hasControlOrSeparator(decoded)
  ) {
    return null;
  }
  // Note: a `//` *inside* the path (e.g. `/foo//bar`) is allowed — only a protocol-relative
  // START is an open-redirect risk.
  return value;
}
