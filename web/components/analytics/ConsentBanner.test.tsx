// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

import { ConsentBanner } from "./ConsentBanner";

afterEach(cleanup);

describe("ConsentBanner", () => {
  it("renders the consent region, /privacy link, and both buttons, and wires the callbacks", () => {
    const onAccept = vi.fn();
    const onDecline = vi.fn();
    render(<ConsentBanner onAccept={onAccept} onDecline={onDecline} />);

    expect(screen.getByRole("region", { name: /analytics consent/i })).toBeTruthy();
    const link = screen.getByRole("link", { name: /privacy policy/i });
    expect(link.getAttribute("href")).toBe("/privacy");

    fireEvent.click(screen.getByRole("button", { name: /^accept$/i }));
    expect(onAccept).toHaveBeenCalledTimes(1);
    expect(onDecline).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: /^decline$/i }));
    expect(onDecline).toHaveBeenCalledTimes(1);
  });
});
