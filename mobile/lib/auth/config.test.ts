import { describe, expect, it } from "vitest";

import type { MobileConfig } from "../config";
import { authCallbackUri, nativeAuthConfig } from "./config";

const CONFIG: MobileConfig = {
  apiBaseUrl: "https://api.fountainrank.com",
  logtoEndpoint: "https://auth.fountainrank.com",
  logtoAudience: "https://api.fountainrank.com",
  authCallbackScheme: "com.redducklabs.fountainrank",
};

describe("authCallbackUri", () => {
  it("builds the custom-scheme callback URL", () => {
    expect(authCallbackUri("com.redducklabs.fountainrank")).toBe(
      "com.redducklabs.fountainrank://callback",
    );
  });
});

describe("nativeAuthConfig", () => {
  it("is unconfigured when the app id is absent", () => {
    expect(nativeAuthConfig(CONFIG)).toEqual({
      state: "unconfigured",
      redirectUri: "com.redducklabs.fountainrank://callback",
    });
  });

  it("is unconfigured when an app id is present without owner confirmation", () => {
    expect(nativeAuthConfig({ ...CONFIG, logtoAppId: "abc123" }).state).toBe("unconfigured");
  });

  it("includes the backend audience as a Logto resource when configured", () => {
    expect(
      nativeAuthConfig({
        ...CONFIG,
        logtoAppId: "abc123",
        logtoNativeAuthConfirmed: true,
      }),
    ).toEqual({
      state: "configured",
      redirectUri: "com.redducklabs.fountainrank://callback",
      logtoConfig: {
        endpoint: "https://auth.fountainrank.com",
        appId: "abc123",
        // profile + email so Logto userinfo returns the real name/email/avatar for
        // POST /api/v1/me/sync; without them the Account name is a raw opaque id (#103).
        scopes: ["email", "profile"],
        resources: ["https://api.fountainrank.com"],
      },
    });
  });
});
