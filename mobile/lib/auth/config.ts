import type { LogtoNativeConfig } from "@logto/rn";

import { isAuthConfigured, type MobileConfig } from "../config";

export type NativeAuthConfig =
  | { state: "unconfigured"; redirectUri: string }
  | { state: "configured"; redirectUri: string; logtoConfig: LogtoNativeConfig };

export function authCallbackUri(scheme: string): string {
  return `${scheme}://callback`;
}

export function nativeAuthConfig(config: MobileConfig): NativeAuthConfig {
  const redirectUri = authCallbackUri(config.authCallbackScheme);
  if (!isAuthConfigured(config)) {
    return { state: "unconfigured", redirectUri };
  }
  const appId = config.logtoAppId;
  if (!appId) {
    return { state: "unconfigured", redirectUri };
  }
  return {
    state: "configured",
    redirectUri,
    logtoConfig: {
      endpoint: config.logtoEndpoint,
      appId,
      // Request profile + email (mirror of the web getLogtoConfig) so Logto userinfo
      // returns the real name/email/avatar for POST /api/v1/me/sync. Without these the
      // backend first-seen fallback `display_name = sub` shows a raw opaque id (#103).
      // String literals (not the UserScope enum) keep this module free of an @logto/rn
      // runtime import so it stays loadable under the node-based vitest.
      scopes: ["email", "profile"],
      resources: [config.logtoAudience],
    },
  };
}
