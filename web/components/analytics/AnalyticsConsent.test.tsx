// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

// Sentinels so we can detect GA load / banner show without real scripts or next/link.
vi.mock("./GaScripts", () => ({ GaScripts: () => <div data-testid="ga-scripts" /> }));
vi.mock("./ConsentBanner", () => ({
  ConsentBanner: ({ onAccept, onDecline }: { onAccept: () => void; onDecline: () => void }) => (
    <div data-testid="banner">
      <button type="button" onClick={onAccept}>
        accept
      </button>
      <button type="button" onClick={onDecline}>
        decline
      </button>
    </div>
  ),
}));

import { CONSENT_STORAGE_KEY } from "../../lib/analytics";
import { AnalyticsConsent } from "./AnalyticsConsent";

function setHostname(hostname: string) {
  vi.stubGlobal("location", { hostname, origin: `https://${hostname}` });
}

afterEach(() => {
  cleanup();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  window.localStorage.clear();
});

// Layer 1: the REAL gating helpers are exercised (analytics module is NOT mocked), so these verify
// the component passes real NODE_ENV/hostname/consent through, not just that the helpers work.
describe("AnalyticsConsent gating (real helpers)", () => {
  it("loads nothing in non-production even on the canonical host with consent granted", () => {
    vi.stubEnv("NODE_ENV", "development");
    setHostname("fountainrank.com");
    window.localStorage.setItem(CONSENT_STORAGE_KEY, "granted");
    render(<AnalyticsConsent />);
    expect(screen.queryByTestId("ga-scripts")).toBeNull();
    expect(screen.queryByTestId("banner")).toBeNull();
  });

  it("loads nothing on a non-canonical host in production", () => {
    vi.stubEnv("NODE_ENV", "production");
    setHostname("localhost");
    render(<AnalyticsConsent />);
    expect(screen.queryByTestId("ga-scripts")).toBeNull();
    expect(screen.queryByTestId("banner")).toBeNull();
  });

  it("shows the banner but not GA when undecided on prod + canonical host", () => {
    vi.stubEnv("NODE_ENV", "production");
    setHostname("fountainrank.com");
    render(<AnalyticsConsent />);
    expect(screen.queryByTestId("ga-scripts")).toBeNull();
    expect(screen.getByTestId("banner")).toBeTruthy();
  });

  it("loads GA but not the banner when granted on prod + canonical host", () => {
    vi.stubEnv("NODE_ENV", "production");
    setHostname("fountainrank.com");
    window.localStorage.setItem(CONSENT_STORAGE_KEY, "granted");
    render(<AnalyticsConsent />);
    expect(screen.getByTestId("ga-scripts")).toBeTruthy();
    expect(screen.queryByTestId("banner")).toBeNull();
  });
});

// Layer 2: accept / decline / fail-closed state transitions on prod + canonical host.
describe("AnalyticsConsent transitions", () => {
  beforeEach(() => {
    vi.stubEnv("NODE_ENV", "production");
    setHostname("fountainrank.com");
  });

  it("accept persists granted, hides the banner, and loads GA", () => {
    render(<AnalyticsConsent />);
    fireEvent.click(screen.getByText("accept"));
    expect(window.localStorage.getItem(CONSENT_STORAGE_KEY)).toBe("granted");
    expect(screen.getByTestId("ga-scripts")).toBeTruthy();
    expect(screen.queryByTestId("banner")).toBeNull();
  });

  it("is fail-closed: if persistence throws, GA stays off and the banner remains", () => {
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("quota exceeded");
    });
    render(<AnalyticsConsent />);
    fireEvent.click(screen.getByText("accept"));
    expect(screen.queryByTestId("ga-scripts")).toBeNull();
    expect(screen.getByTestId("banner")).toBeTruthy();
  });

  it("decline persists denied and hides the banner without loading GA", () => {
    render(<AnalyticsConsent />);
    fireEvent.click(screen.getByText("decline"));
    expect(window.localStorage.getItem(CONSENT_STORAGE_KEY)).toBe("denied");
    expect(screen.queryByTestId("banner")).toBeNull();
    expect(screen.queryByTestId("ga-scripts")).toBeNull();
  });
});
