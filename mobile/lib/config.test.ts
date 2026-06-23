import { describe, expect, it } from "vitest";

import { isAuthConfigured, parseMobileConfig } from "./config";

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

  it("rejects a present-but-empty logtoAppId", () => {
    expect(() => parseMobileConfig({ ...VALID, logtoAppId: "" })).toThrow(/logtoAppId/);
  });

  it("rejects a non-string logtoAppId", () => {
    expect(() => parseMobileConfig({ ...VALID, logtoAppId: 5 })).toThrow(/logtoAppId/);
  });
});

describe("isAuthConfigured", () => {
  it("is false when logtoAppId is absent (auth-unavailable)", () => {
    expect(isAuthConfigured(parseMobileConfig(VALID))).toBe(false);
  });

  it("is true when a logtoAppId is present", () => {
    expect(isAuthConfigured(parseMobileConfig({ ...VALID, logtoAppId: "abc123" }))).toBe(true);
  });
});
