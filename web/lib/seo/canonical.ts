import { SITE_HOST } from "./site";

/**
 * Decide whether an incoming request should be permanently redirected to the
 * canonical apex host. Returns the absolute https target URL when the request
 * arrived on the `www.` host, or `null` when the host is already canonical (or
 * is localhost / an internal host) and should pass through untouched (see #126).
 *
 * Kept as a pure function so the redirect rule is unit-testable without
 * constructing a full Next.js request in `middleware.ts`.
 */
export function wwwRedirectTarget(
  host: string | null | undefined,
  pathname: string,
  search: string,
): string | null {
  if (!host) return null;
  // Drop any :port so "www.fountainrank.com:443" still matches.
  const hostname = host.split(":", 1)[0].toLowerCase();
  if (hostname !== `www.${SITE_HOST}`) return null;
  return `https://${SITE_HOST}${pathname}${search}`;
}
