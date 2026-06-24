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
      resources: [config.logtoAudience],
    },
  };
}
