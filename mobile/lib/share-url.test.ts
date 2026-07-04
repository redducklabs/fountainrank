import { describe, expect, it } from "vitest";

import { fountainShareUrl, shareContent } from "./share-url";

describe("fountainShareUrl", () => {
  it("joins base + fountain id without a double slash", () => {
    expect(fountainShareUrl("https://fountainrank.com", "f1")).toBe(
      "https://fountainrank.com/fountains/f1",
    );
    expect(fountainShareUrl("https://fountainrank.com/", "f1")).toBe(
      "https://fountainrank.com/fountains/f1",
    );
  });
});

describe("shareContent", () => {
  it("puts the URL in the native url slot on iOS", () => {
    expect(shareContent("https://x/fountains/f1", "ios")).toEqual({
      url: "https://x/fountains/f1",
    });
  });

  it("puts the URL in message on Android (its sheet ignores url)", () => {
    expect(shareContent("https://x/fountains/f1", "android")).toEqual({
      message: "https://x/fountains/f1",
    });
  });
});
