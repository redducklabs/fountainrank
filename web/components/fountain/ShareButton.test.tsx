// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { ShareButton } from "./ShareButton";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("ShareButton", () => {
  it("copies to clipboard and shows feedback when Web Share is unavailable", async () => {
    // Force the clipboard fallback (desktop: no navigator.share).
    Object.defineProperty(navigator, "share", { value: undefined, configurable: true });
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });

    render(<ShareButton />);
    fireEvent.click(screen.getByRole("button", { name: /share/i }));

    expect(await screen.findByText(/link copied/i)).toBeDefined();
    expect(writeText).toHaveBeenCalledWith(window.location.href);
  });
});
