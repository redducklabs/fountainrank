// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render } from "@testing-library/react";

const ensureGaConfigured = vi.fn();
vi.mock("./gtag", () => ({
  ensureGaConfigured: (...args: unknown[]) => ensureGaConfigured(...args),
}));
vi.mock("./GaPageView", () => ({ GaPageView: () => null }));
vi.mock("next/script", () => ({
  default: (props: { id?: string; src?: string }) => (
    <script data-testid="ga-loader" id={props.id} src={props.src} />
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
    expect(loader?.getAttribute("src")).toContain("id=G-ABC123");
  });
});
