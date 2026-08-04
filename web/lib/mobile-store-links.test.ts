import { describe, expect, it } from "vitest";
import {
  detectMobilePlatform,
  isStandaloneDisplayMode,
  resolveMobileStoreLinks,
  selectMobileStoreLink,
} from "./mobile-store-links";

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

describe("detectMobilePlatform", () => {
  it("detects Android", () => {
    expect(
      detectMobilePlatform({
        userAgent: "Mozilla/5.0 (Linux; Android 16; Pixel 9)",
        platform: "Linux armv8l",
        maxTouchPoints: 5,
      }),
    ).toBe("android");
  });

  it("detects iPhone and iPad desktop mode", () => {
    expect(
      detectMobilePlatform({
        userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 19_0 like Mac OS X)",
        platform: "iPhone",
        maxTouchPoints: 5,
      }),
    ).toBe("ios");
    expect(
      detectMobilePlatform({
        userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15)",
        platform: "MacIntel",
        maxTouchPoints: 5,
      }),
    ).toBe("ios");
  });

  it("does not classify a desktop Mac as iOS", () => {
    expect(
      detectMobilePlatform({
        userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15)",
        platform: "MacIntel",
        maxTouchPoints: 0,
      }),
    ).toBeNull();
  });
});

describe("mobile banner selection", () => {
  const links = resolveMobileStoreLinks({
    NEXT_PUBLIC_APP_STORE_URL: "https://apps.apple.com/app/id123",
    NEXT_PUBLIC_GOOGLE_PLAY_URL: "https://play.google.com/store/apps/details?id=x",
  });

  it("selects only the detected platform's link", () => {
    expect(selectMobileStoreLink(links, "ios")?.store).toBe("ios");
    expect(selectMobileStoreLink(links, "android")?.store).toBe("android");
    expect(selectMobileStoreLink(links, null)).toBeNull();
  });

  it("hides a platform whose store URL is not configured", () => {
    expect(
      selectMobileStoreLink(
        links.filter((link) => link.store === "ios"),
        "android",
      ),
    ).toBeNull();
  });

  it("recognizes browser and iOS standalone modes", () => {
    expect(
      isStandaloneDisplayMode({ displayModeStandalone: true, navigatorStandalone: false }),
    ).toBe(true);
    expect(
      isStandaloneDisplayMode({ displayModeStandalone: false, navigatorStandalone: true }),
    ).toBe(true);
    expect(
      isStandaloneDisplayMode({ displayModeStandalone: false, navigatorStandalone: false }),
    ).toBe(false);
  });
});
