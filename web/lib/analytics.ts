// Pure helpers for consent-gated, path-only GA4 analytics (see
// docs/specs/2026-06-30-ga4-web-analytics-design.md). All env/consent/host/path logic lives here as
// pure functions so it is unit-testable without a DOM; the client components in
// components/analytics/ consume these.

export const GA_MEASUREMENT_ID_DEFAULT = "G-BG3PYM6T43";
export const CONSENT_STORAGE_KEY = "fr-analytics-consent";
export const CANONICAL_HOSTS = ["fountainrank.com", "www.fountainrank.com"] as const;

export type Consent = "granted" | "denied" | "undecided";

export function resolveGaMeasurementId(envOverride?: Record<string, string | undefined>): string {
  // Read `process.env.NEXT_PUBLIC_GA_MEASUREMENT_ID` via a LITERAL static member access so Next.js
  // inlines it into the client (and server) bundle at build time. Bracket/aliased access is NOT
  // statically replaced, so in the browser it would be `undefined` and we would silently lose the
  // override (mirrors the `resolveApiBaseUrl` caveat in lib/api.ts). `envOverride` exists only for
  // tests; runtime callers pass nothing and get the inlined value.
  if (envOverride) {
    return envOverride["NEXT_PUBLIC_GA_MEASUREMENT_ID"] ?? GA_MEASUREMENT_ID_DEFAULT;
  }
  return process.env.NEXT_PUBLIC_GA_MEASUREMENT_ID ?? GA_MEASUREMENT_ID_DEFAULT;
}

// Validate the (possibly overridden) Measurement ID before it is ever used to build a script URL or
// a gtag `config` command — injection-hardening for a third-party script feature.
export function isValidGaMeasurementId(id: string): boolean {
  return /^G-[A-Z0-9]+$/.test(id);
}

export function parseConsent(raw: string | null | undefined): Consent {
  if (raw === "granted") return "granted";
  if (raw === "denied") return "denied";
  return "undecided";
}

export function isCanonicalHost(hostname: string | undefined): boolean {
  return !!hostname && (CANONICAL_HOSTS as readonly string[]).includes(hostname);
}

// Reduce a pathname to a path with no query string or fragment. Defends against a caller accidentally
// passing a full URL (e.g. `https://host/x?y` → `/x`). This is what we send to GA as `page_path`.
export function sanitizePagePath(pathname: string): string {
  if (!pathname) return "/";
  if (pathname.includes("://")) {
    try {
      return new URL(pathname).pathname || "/";
    } catch {
      return "/";
    }
  }
  const path = pathname.split("?")[0].split("#")[0];
  return path || "/";
}

// Reduce a full URL to `origin + pathname` (no query/fragment); "" for empty/unparseable input. Used
// for `page_location` and `page_referrer` so neither can carry a query string to GA.
export function sanitizeUrl(raw: string | null | undefined): string {
  if (!raw) return "";
  try {
    const u = new URL(raw);
    return u.origin + u.pathname;
  } catch {
    return "";
  }
}

export function shouldLoadGa(
  consent: Consent,
  nodeEnv: string | undefined,
  hostname: string | undefined,
): boolean {
  return consent === "granted" && nodeEnv === "production" && isCanonicalHost(hostname);
}

export function shouldShowBanner(
  consent: Consent,
  nodeEnv: string | undefined,
  hostname: string | undefined,
): boolean {
  return consent === "undecided" && nodeEnv === "production" && isCanonicalHost(hostname);
}
