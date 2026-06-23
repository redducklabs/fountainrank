import { describe, expect, it } from "vitest";

import { formatBuildInfo } from "./build-info";

describe("formatBuildInfo", () => {
  it("formats version and build", () => {
    expect(formatBuildInfo("0.1.0", "1")).toBe("v0.1.0 (build 1)");
  });

  it("falls back when version is missing", () => {
    expect(formatBuildInfo(null, "3")).toBe("v0.0.0 (build 3)");
  });

  it("falls back when build is missing", () => {
    expect(formatBuildInfo("0.2.0", null)).toBe("v0.2.0 (build unknown)");
  });
});
