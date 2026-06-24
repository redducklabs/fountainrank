import { describe, expect, it } from "vitest";

import { isAuthConfigured, isMapConfigured, parseMobileConfig } from "./config";

const VALID = {
  apiBaseUrl: "https://api.fountainrank.com",
  logtoEndpoint: "https://auth.fountainrank.com",
  logtoAudience: "https://api.fountainrank.com",
  authCallbackScheme: "com.redducklabs.fountainrank",
};

describe("parseMobileConfig", () => {
  it("returns a typed config for valid extra", () => {
    expect(parseMobileConfig(VALID)).toEqual(VALID);
  });

  it("throws when extra is missing", () => {
    expect(() => parseMobileConfig(undefined)).toThrow();
    expect(() => parseMobileConfig(null)).toThrow();
  });

  it("throws when apiBaseUrl is absent", () => {
    expect(() => parseMobileConfig({ ...VALID, apiBaseUrl: undefined })).toThrow(/apiBaseUrl/);
  });

  it("rejects a non-https apiBaseUrl (HTTPS-only)", () => {
    expect(() =>
      parseMobileConfig({ ...VALID, apiBaseUrl: "http://api.fountainrank.com" }),
    ).toThrow(/https/);
  });

  it("rejects an https URL with an empty host", () => {
    expect(() => parseMobileConfig({ ...VALID, apiBaseUrl: "https://" })).toThrow(/https/);
  });

  it("rejects malformed https URLs with no real host", () => {
    for (const bad of ["https://?x", "https://#frag", "https://:", "https://-x.com"]) {
      expect(() => parseMobileConfig({ ...VALID, apiBaseUrl: bad })).toThrow(/https/);
    }
  });

  it("rejects a URL containing whitespace", () => {
    expect(() => parseMobileConfig({ ...VALID, apiBaseUrl: "https://api .com" })).toThrow(
      /whitespace/,
    );
  });

  it("accepts an https host with hyphens (e.g. staging)", () => {
    const staging = { ...VALID, apiBaseUrl: "https://api-staging.fountainrank.com" };
    expect(parseMobileConfig(staging).apiBaseUrl).toBe("https://api-staging.fountainrank.com");
  });

  it("rejects a non-https logtoEndpoint", () => {
    expect(() =>
      parseMobileConfig({ ...VALID, logtoEndpoint: "http://auth.fountainrank.com" }),
    ).toThrow(/https/);
  });

  it("requires a non-empty authCallbackScheme", () => {
    expect(() => parseMobileConfig({ ...VALID, authCallbackScheme: "" })).toThrow(/scheme/i);
  });

  it("omits logtoAppId when it is absent (auth-unavailable mode)", () => {
    expect("logtoAppId" in parseMobileConfig(VALID)).toBe(false);
  });

  it("parses a present non-empty logtoAppId", () => {
    const withId = { ...VALID, logtoAppId: "abc123" };
    expect(parseMobileConfig(withId).logtoAppId).toBe("abc123");
  });

  it("parses a present native-auth confirmation flag", () => {
    expect(parseMobileConfig({ ...VALID, logtoNativeAuthConfirmed: true })).toMatchObject({
      logtoNativeAuthConfirmed: true,
    });
  });

  it("rejects a present-but-empty logtoAppId", () => {
    expect(() => parseMobileConfig({ ...VALID, logtoAppId: "" })).toThrow(/logtoAppId/);
  });

  it("rejects a non-string logtoAppId", () => {
    expect(() => parseMobileConfig({ ...VALID, logtoAppId: 5 })).toThrow(/logtoAppId/);
  });

  it("rejects a false native-auth confirmation flag", () => {
    expect(() => parseMobileConfig({ ...VALID, logtoNativeAuthConfirmed: false })).toThrow(
      /logtoNativeAuthConfirmed/,
    );
  });
});

describe("isAuthConfigured", () => {
  it("is false when logtoAppId is absent (auth-unavailable)", () => {
    expect(isAuthConfigured(parseMobileConfig(VALID))).toBe(false);
  });

  it("is false when a logtoAppId is present without owner confirmation", () => {
    expect(isAuthConfigured(parseMobileConfig({ ...VALID, logtoAppId: "abc123" }))).toBe(false);
  });

  it("is true only when a logtoAppId and owner confirmation are present", () => {
    expect(
      isAuthConfigured(
        parseMobileConfig({
          ...VALID,
          logtoAppId: "abc123",
          logtoNativeAuthConfirmed: true,
        }),
      ),
    ).toBe(true);
  });
});

describe("basemapStyleUrl", () => {
  it("omits basemapStyleUrl when absent (map-unavailable mode)", () => {
    expect("basemapStyleUrl" in parseMobileConfig(VALID)).toBe(false);
  });

  it("parses a present https basemapStyleUrl", () => {
    const withMap = { ...VALID, basemapStyleUrl: "https://cdn.example.com/style.light.json" };
    expect(parseMobileConfig(withMap).basemapStyleUrl).toBe(
      "https://cdn.example.com/style.light.json",
    );
  });

  it("accepts a basemapStyleUrl with a cache-busting query string", () => {
    const withMap = { ...VALID, basemapStyleUrl: "https://cdn.example.com/style.light.json?v=3" };
    expect(parseMobileConfig(withMap).basemapStyleUrl).toBe(
      "https://cdn.example.com/style.light.json?v=3",
    );
  });

  it("rejects a non-https basemapStyleUrl", () => {
    expect(() =>
      parseMobileConfig({ ...VALID, basemapStyleUrl: "http://cdn.example.com/style.json" }),
    ).toThrow(/https/);
  });

  it("rejects a present-but-empty basemapStyleUrl", () => {
    // Empty hits the requireNonEmpty branch ("is required"), mirroring the
    // present-but-empty logtoAppId case; assert on the field name to cover both
    // the "required" and "https" rejection paths.
    expect(() => parseMobileConfig({ ...VALID, basemapStyleUrl: "" })).toThrow(/basemapStyleUrl/);
  });
});

describe("isMapConfigured", () => {
  it("is false when basemapStyleUrl is absent", () => {
    expect(isMapConfigured(parseMobileConfig(VALID))).toBe(false);
  });

  it("is true when a basemapStyleUrl is present", () => {
    const withMap = { ...VALID, basemapStyleUrl: "https://cdn.example.com/style.light.json" };
    expect(isMapConfigured(parseMobileConfig(withMap))).toBe(true);
  });
});
