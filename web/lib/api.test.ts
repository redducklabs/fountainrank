import { describe, expect, it } from "vitest";

import { resolveApiBaseUrl } from "./api";

describe("resolveApiBaseUrl", () => {
  it("defaults to localhost:8000", () => {
    expect(resolveApiBaseUrl({})).toBe("http://localhost:8000");
  });

  it("uses NEXT_PUBLIC_API_BASE_URL when set", () => {
    expect(resolveApiBaseUrl({ NEXT_PUBLIC_API_BASE_URL: "https://api.example.com" })).toBe(
      "https://api.example.com",
    );
  });
});
