// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { MobileAppBanner } from "./MobileAppBanner";

afterEach(cleanup);

describe("MobileAppBanner", () => {
  it("renders an accessible store action and wires dismissal", () => {
    const onDismiss = vi.fn();
    render(
      <MobileAppBanner
        link={{
          store: "ios",
          label: "Download on the App Store",
          href: "https://apps.apple.com/app/id123",
        }}
        onDismiss={onDismiss}
      />,
    );

    expect(
      screen.getByRole("complementary", { name: /get the fountainrank mobile app/i }),
    ).toBeTruthy();
    const link = screen.getByRole("link", { name: /download on the app store.*new tab/i });
    expect(link.getAttribute("href")).toBe("https://apps.apple.com/app/id123");
    expect(link.getAttribute("rel")).toBe("noopener noreferrer");

    fireEvent.click(screen.getByRole("button", { name: /dismiss app download banner/i }));
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });
});
