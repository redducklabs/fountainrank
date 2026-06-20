import "server-only";

import type { LogtoNextConfig } from "@logto/next";

export const API_RESOURCE = "https://api.fountainrank.com";

export function requireEnv(name: string, env: Record<string, string | undefined> = process.env): string {
  const value = env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

export function requireCookieSecret(name: string, env: Record<string, string | undefined> = process.env): string {
  const value = requireEnv(name, env);
  if (value.length < 32) {
    throw new Error(`${name} must be at least 32 characters (Logto session cookie encryption)`);
  }
  return value;
}

// Built per request (never a top-level const) so `next build` — which runs with no
// LOGTO_* present — never evaluates requireEnv and fails. Call sites are dynamic routes.
export function getLogtoConfig(env: Record<string, string | undefined> = process.env): LogtoNextConfig {
  return {
    endpoint: requireEnv("LOGTO_ENDPOINT", env),
    appId: requireEnv("LOGTO_APP_ID", env),
    appSecret: requireEnv("LOGTO_APP_SECRET", env),
    baseUrl: requireEnv("LOGTO_BASE_URL", env),
    cookieSecret: requireCookieSecret("LOGTO_COOKIE_SECRET", env),
    cookieSecure: env.NODE_ENV === "production",
    resources: [API_RESOURCE],
  };
}
