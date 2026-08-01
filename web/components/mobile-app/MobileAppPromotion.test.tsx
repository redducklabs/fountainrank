// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { MOBILE_APP_BANNER_DISMISSED_KEY } from "../../lib/mobile-store-links";
import { MobileAppPromotion } from "./MobileAppPromotion";

function configureBrowser({
  userAgent,
  platform,
  maxTouchPoints = 5,
  standalone = false,
}: {
  userAgent: string;
  platform: string;
  maxTouchPoints?: number;
  standalone?: boolean;
}) {
  vi.stubGlobal("navigator", { userAgent, platform, maxTouchPoints, standalone });
  vi.stubGlobal(
    "matchMedia",
    vi.fn().mockReturnValue({
      matches: standalone,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    }),
  );
}

describe("MobileAppPromotion", () => {
  beforeEach(() => {
    vi.stubEnv("NEXT_PUBLIC_APP_STORE_URL", "https://apps.apple.com/app/id123");
    vi.stubEnv("NEXT_PUBLIC_GOOGLE_PLAY_URL", "https://play.google.com/store/apps/details?id=x");
    window.localStorage.clear();
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    window.localStorage.clear();
  });

  it("offers Google Play to Android visitors", () => {
    configureBrowser({ userAgent: "Mozilla/5.0 (Linux; Android 16)", platform: "Linux" });
    render(<MobileAppPromotion />);

    expect(screen.getByRole("link", { name: /get it on google play/i })).toHaveAttribute(
      "href",
      "https://play.google.com/store/apps/details?id=x",
    );
  });

  it("offers the App Store to iOS visitors", () => {
    configureBrowser({ userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 19_0)", platform: "iPhone" });
    render(<MobileAppPromotion />);

    expect(screen.getByRole("link", { name: /download on the app store/i })).toHaveAttribute(
      "href",
      "https://apps.apple.com/app/id123",
    );
  });

  it("stays hidden on desktop and in standalone mode", () => {
    configureBrowser({
      userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15)",
      platform: "MacIntel",
      maxTouchPoints: 0,
    });
    const desktop = render(<MobileAppPromotion />);
    expect(screen.queryByRole("complementary")).toBeNull();
    desktop.unmount();

    configureBrowser({
      userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 19_0)",
      platform: "iPhone",
      standalone: true,
    });
    render(<MobileAppPromotion />);
    expect(screen.queryByRole("complementary")).toBeNull();
  });

  it("stays hidden when the detected platform has no configured URL", () => {
    vi.stubEnv("NEXT_PUBLIC_GOOGLE_PLAY_URL", "");
    configureBrowser({ userAgent: "Mozilla/5.0 (Linux; Android 16)", platform: "Linux" });
    render(<MobileAppPromotion />);
    expect(screen.queryByRole("complementary")).toBeNull();
  });

  it("persists dismissal and stays hidden on a later mount", () => {
    configureBrowser({ userAgent: "Mozilla/5.0 (Linux; Android 16)", platform: "Linux" });
    const first = render(<MobileAppPromotion />);
    fireEvent.click(screen.getByRole("button", { name: /dismiss app download banner/i }));
    expect(window.localStorage.getItem(MOBILE_APP_BANNER_DISMISSED_KEY)).toBe("true");
    expect(screen.queryByRole("complementary")).toBeNull();
    first.unmount();

    render(<MobileAppPromotion />);
    expect(screen.queryByRole("complementary")).toBeNull();
  });

  it("still dismisses for the page when localStorage writes fail", () => {
    configureBrowser({ userAgent: "Mozilla/5.0 (Linux; Android 16)", platform: "Linux" });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("quota exceeded");
    });
    vi.spyOn(console, "warn").mockImplementation(() => {});
    render(<MobileAppPromotion />);

    fireEvent.click(screen.getByRole("button", { name: /dismiss app download banner/i }));
    expect(screen.queryByRole("complementary")).toBeNull();
    expect(console.warn).toHaveBeenCalled();
  });
});
