import { describe, expect, it } from "vitest";
import { resolveMobileStoreLinks } from "./mobile-store-links";

describe("resolveMobileStoreLinks", () => {
  it("hides missing store URLs instead of returning placeholders", () => {
    expect(resolveMobileStoreLinks({})).toEqual([]);
  });

  it("returns configured iOS and Android store links", () => {
    expect(
      resolveMobileStoreLinks({
        NEXT_PUBLIC_APP_STORE_URL: "https://apps.apple.com/app/fountainrank/id123",
        NEXT_PUBLIC_GOOGLE_PLAY_URL: "https://play.google.com/store/apps/details?id=x",
      }),
    ).toEqual([
      {
        store: "ios",
        label: "Download on the App Store",
        href: "https://apps.apple.com/app/fountainrank/id123",
      },
      {
        store: "android",
        label: "Get it on Google Play",
        href: "https://play.google.com/store/apps/details?id=x",
      },
    ]);
  });
});
