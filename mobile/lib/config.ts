export type MobileConfig = {
  apiBaseUrl: string;
  logtoEndpoint: string;
  logtoAudience: string;
  authCallbackScheme: string;
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
  if (!/^https:\/\/[^/]+(\/.*)?$/.test(s)) {
    throw new Error(`Mobile config: "${field}" must be a valid https URL`);
  }
  return s;
}

export function parseMobileConfig(extra: unknown): MobileConfig {
  if (typeof extra !== "object" || extra === null) {
    throw new Error("Mobile config: expoConfig.extra is missing");
  }
  const e = extra as Record<string, unknown>;
  return {
    apiBaseUrl: requireHttpsUrl(e.apiBaseUrl, "apiBaseUrl"),
    logtoEndpoint: requireHttpsUrl(e.logtoEndpoint, "logtoEndpoint"),
    logtoAudience: requireHttpsUrl(e.logtoAudience, "logtoAudience"),
    authCallbackScheme: requireNonEmpty(e.authCallbackScheme, "authCallbackScheme"),
  };
}
