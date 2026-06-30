// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render } from "@testing-library/react";

const sendPageView = vi.fn();
vi.mock("./gtag", () => ({
  sendPageView: (...args: unknown[]) => sendPageView(...args),
}));

let mockPathname = "/leaderboard?lat=1&lng=2";
vi.mock("next/navigation", () => ({
  usePathname: () => mockPathname,
}));

import { GaPageView } from "./GaPageView";

type Payload = {
  page_path: string;
  page_location: string;
  page_referrer: string;
  page_title: string;
};

afterEach(() => {
  cleanup();
  sendPageView.mockClear();
});

describe("GaPageView", () => {
  it("sends a sanitized page_view with no query string in any URL field", () => {
    mockPathname = "/leaderboard?lat=1&lng=2";
    render(<GaPageView gaId="G-ABC123" />);

    expect(sendPageView).toHaveBeenCalledTimes(1);
    const [gaId, payload] = sendPageView.mock.calls[0] as [string, Payload];
    expect(gaId).toBe("G-ABC123");
    expect(payload.page_path).toBe("/leaderboard");
    for (const field of ["page_path", "page_location", "page_referrer"] as const) {
      expect(payload[field]).not.toContain("?");
      expect(payload[field]).not.toContain("#");
    }
  });

  it("uses the previous sanitized location as the referrer on in-app navigation", () => {
    mockPathname = "/a";
    const { rerender } = render(<GaPageView gaId="G-ABC123" />);
    mockPathname = "/b?x=1";
    rerender(<GaPageView gaId="G-ABC123" />);

    expect(sendPageView).toHaveBeenCalledTimes(2);
    const second = sendPageView.mock.calls[1][1] as Payload;
    expect(second.page_path).toBe("/b");
    expect(second.page_referrer).toBe(`${window.location.origin}/a`);
  });
});
