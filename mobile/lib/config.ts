export type MobileConfig = {
  apiBaseUrl: string;
  logtoEndpoint: string;
  logtoAudience: string;
  authCallbackScheme: string;
  logtoAppId?: string;
  basemapStyleUrl?: string;
};

function requireNonEmpty(value: unknown, field: string): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`Mobile config: "${field}" is required`);
  }
  return value;
}

// React-Native-safe https validation (no URL polyfill dependency): reject
// whitespace/control characters, then require the https:// scheme + a non-empty
// host. Hyphens in the host (e.g. api-staging.example.com) are allowed.
function requireHttpsUrl(value: unknown, field: string): string {
  const s = requireNonEmpty(value, field);
  if (/[\s\p{Cc}]/u.test(s)) {
    throw new Error(`Mobile config: "${field}" must not contain whitespace or control characters`);
  }
  // Host must start with an alphanumeric (rejects hostless forms like
  // "https://", "https://?x", "https://#frag", "https://:"), then host chars +
  // optional :port + optional /path.
  if (!/^https:\/\/[a-zA-Z0-9][a-zA-Z0-9.-]*(:\d+)?(\/.*)?$/.test(s)) {
    throw new Error(`Mobile config: "${field}" must be a valid https URL`);
  }
  return s;
}

export function parseMobileConfig(extra: unknown): MobileConfig {
  if (typeof extra !== "object" || extra === null) {
    throw new Error("Mobile config: expoConfig.extra is missing");
  }
  const e = extra as Record<string, unknown>;
  const config: MobileConfig = {
    apiBaseUrl: requireHttpsUrl(e.apiBaseUrl, "apiBaseUrl"),
    logtoEndpoint: requireHttpsUrl(e.logtoEndpoint, "logtoEndpoint"),
    logtoAudience: requireHttpsUrl(e.logtoAudience, "logtoAudience"),
    authCallbackScheme: requireNonEmpty(e.authCallbackScheme, "authCallbackScheme"),
  };
  // logtoAppId is optional in this beta: absent until the owner-gated Logto
  // Native app exists (spec section 21, auth-unavailable mode). Present: a
  // non-empty string; absent: omitted entirely (no placeholder/fake id).
  if (e.logtoAppId !== undefined) {
    config.logtoAppId = requireNonEmpty(e.logtoAppId, "logtoAppId");
  }
  // basemapStyleUrl is optional: when absent/blank the map screen shows an
  // honest "map unavailable" state instead of crashing the app (spec section 21
  // honest-degradation). Present: a valid https URL (a cache-busting query
  // string is allowed). It is public config — a committed default ships in
  // app.config.ts, overridable via EXPO_PUBLIC_BASEMAP_STYLE_URL.
  if (e.basemapStyleUrl !== undefined) {
    config.basemapStyleUrl = requireHttpsUrl(e.basemapStyleUrl, "basemapStyleUrl");
  }
  return config;
}

/** True only when a real Logto Native app id is configured. False in this beta
 * (auth-unavailable mode), so the app stays in a public-read state. */
export function isAuthConfigured(config: MobileConfig): boolean {
  return typeof config.logtoAppId === "string" && config.logtoAppId.length > 0;
}

/** True only when a basemap style URL is configured. When false, the map screen
 * renders an honest "map unavailable" state rather than crashing. */
export function isMapConfigured(config: MobileConfig): boolean {
  return typeof config.basemapStyleUrl === "string" && config.basemapStyleUrl.length > 0;
}
