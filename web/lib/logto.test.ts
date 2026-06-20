import { describe, expect, it } from "vitest";

import { getLogtoConfig, requireCookieSecret, requireEnv } from "./logto";

const base = {
  LOGTO_ENDPOINT: "https://auth.fountainrank.com",
  LOGTO_APP_ID: "app123",
  LOGTO_APP_SECRET: "secret",
  LOGTO_BASE_URL: "https://fountainrank.com",
  LOGTO_COOKIE_SECRET: "x".repeat(32),
} as NodeJS.ProcessEnv;

describe("requireEnv", () => {
  it("returns the value when set", () => {
    expect(requireEnv("LOGTO_APP_ID", base)).toBe("app123");
  });
  it("throws naming the missing var", () => {
    expect(() => requireEnv("LOGTO_APP_ID", {})).toThrow(/LOGTO_APP_ID/);
  });
});

describe("requireCookieSecret", () => {
  it("passes at exactly 32 chars", () => {
    expect(requireCookieSecret("LOGTO_COOKIE_SECRET", { LOGTO_COOKIE_SECRET: "x".repeat(32) })).toHaveLength(32);
  });
  it("throws below 32 chars", () => {
    expect(() => requireCookieSecret("LOGTO_COOKIE_SECRET", { LOGTO_COOKIE_SECRET: "x".repeat(31) })).toThrow(/32/);
  });
});

describe("getLogtoConfig", () => {
  it("builds config with the API resource and dev cookieSecure=false", () => {
    const cfg = getLogtoConfig({ ...base, NODE_ENV: "development" });
    expect(cfg.resources).toEqual(["https://api.fountainrank.com"]);
    expect(cfg.cookieSecure).toBe(false);
    expect(cfg.baseUrl).toBe("https://fountainrank.com");
  });
  it("sets cookieSecure=true in production", () => {
    expect(getLogtoConfig({ ...base, NODE_ENV: "production" }).cookieSecure).toBe(true);
  });
});
