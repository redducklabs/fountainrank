// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render } from "@testing-library/react";

const ensureGaConfigured = vi.fn();
vi.mock("./gtag", () => ({
  ensureGaConfigured: (...args: unknown[]) => ensureGaConfigured(...args),
}));
vi.mock("./GaPageView", () => ({ GaPageView: () => null }));
// Mock next/script as a plain element (not a real <script>, which would trip @next/next/no-sync-scripts)
// carrying the resolved src so we can assert the encoded id.
vi.mock("next/script", () => ({
  default: (props: { id?: string; src?: string }) => (
    <div data-testid="ga-loader" data-src={props.src} />
  ),
}));

import { GaScripts } from "./GaScripts";

afterEach(() => {
  cleanup();
  ensureGaConfigured.mockClear();
});

describe("GaScripts", () => {
  it("renders nothing and does not configure GA for an invalid id", () => {
    const { container } = render(<GaScripts gaId="not-valid" />);
    expect(ensureGaConfigured).not.toHaveBeenCalled();
    expect(container.querySelector("[data-testid='ga-loader']")).toBeNull();
  });

  it("configures GA and renders the loader with an encoded id for a valid id", () => {
    const { container } = render(<GaScripts gaId="G-ABC123" />);
    expect(ensureGaConfigured).toHaveBeenCalledWith("G-ABC123");
    const loader = container.querySelector("[data-testid='ga-loader']");
    expect(loader).not.toBeNull();
    expect(loader?.getAttribute("data-src")).toContain("id=G-ABC123");
  });
});
