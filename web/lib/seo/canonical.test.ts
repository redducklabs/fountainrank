import { describe, expect, it } from "vitest";

import { wwwRedirectTarget } from "./canonical";

const APEX = "https://fountainrank.com";

describe("wwwRedirectTarget", () => {
  it("redirects the www host to the apex, preserving path and query", () => {
    expect(wwwRedirectTarget("www.fountainrank.com", "/leaderboard", "?scope=near")).toBe(
      `${APEX}/leaderboard?scope=near`,
    );
  });

  it("redirects the root path", () => {
    expect(wwwRedirectTarget("www.fountainrank.com", "/", "")).toBe(`${APEX}/`);
  });

  it("ignores a port on the www host", () => {
    expect(wwwRedirectTarget("www.fountainrank.com:443", "/", "")).toBe(`${APEX}/`);
  });

  it("is case-insensitive on the host", () => {
    expect(wwwRedirectTarget("WWW.FountainRank.com", "/", "")).toBe(`${APEX}/`);
  });

  it("passes through the canonical apex host", () => {
    expect(wwwRedirectTarget("fountainrank.com", "/", "")).toBeNull();
  });

  it("passes through localhost and internal hosts", () => {
    expect(wwwRedirectTarget("localhost:3000", "/", "")).toBeNull();
    expect(wwwRedirectTarget("10.0.0.5", "/", "")).toBeNull();
  });

  it("passes through a missing host header", () => {
    expect(wwwRedirectTarget(null, "/", "")).toBeNull();
    expect(wwwRedirectTarget(undefined, "/", "")).toBeNull();
  });
});
