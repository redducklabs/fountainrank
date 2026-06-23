import { describe, expect, it } from "vitest";

import { parseMobileConfig } from "./config";

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
});
