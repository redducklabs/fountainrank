// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";

const { getViewer, getSiteStatsServer } = vi.hoisted(() => ({
  getViewer: vi.fn(),
  getSiteStatsServer: vi.fn(),
}));
vi.mock("../lib/server/viewer", () => ({ getViewer }));
// Keep the real pure helpers (roundedCountPlus); stub only the server stats fetch.
vi.mock("../lib/places", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../lib/places")>();
  return { ...actual, getSiteStatsServer };
});
vi.mock("../components/SiteHeader", () => ({
  SiteHeader: () => <div data-testid="site-header" />,
}));
vi.mock("../components/map/MapBrowserLoader", () => ({
  default: (p: { isAuthenticated: boolean; autoEnterAdd: boolean; hadAddParam: boolean }) => (
    <div
      data-testid="map"
      data-auth={String(p.isAuthenticated)}
      data-auto={String(p.autoEnterAdd)}
      data-had={String(p.hadAddParam)}
    />
  ),
}));

import Home, { generateMetadata } from "./page";

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("generateMetadata", () => {
  it("renders a self-canonical description with live, floored counts", async () => {
    getSiteStatsServer.mockResolvedValue({
      data: { total_fountains: 285432, total_countries: 62 },
      status: 200,
    });
    const meta = await generateMetadata();
    expect(meta.description).toContain("285,000+ public drinking fountains across 62 countries");
    expect(meta.alternates?.canonical).toBe("/");
  });

  it("falls back to a countless description when stats are unavailable", async () => {
    getSiteStatsServer.mockResolvedValue({ data: undefined, status: 0 });
    const meta = await generateMetadata();
    expect(meta.description).not.toMatch(/\d/);
    expect(meta.description).toContain("public drinking fountains");
    expect(meta.alternates?.canonical).toBe("/");
  });
});

it("auto-enters add when ?add=1 and authed", async () => {
  getViewer.mockResolvedValue({
    state: "authed",
    displayName: "A",
    avatarUrl: null,
    isAdmin: false,
  });
  render(await Home({ searchParams: Promise.resolve({ add: "1" }) }));
  const map = screen.getByTestId("map");
  expect(map.getAttribute("data-auto")).toBe("true");
  expect(map.getAttribute("data-had")).toBe("true");
});

it("flags hadAddParam but does not auto-enter when anonymous", async () => {
  getViewer.mockResolvedValue({ state: "anonymous" });
  render(await Home({ searchParams: Promise.resolve({ add: "1" }) }));
  const map = screen.getByTestId("map");
  expect(map.getAttribute("data-auto")).toBe("false");
  expect(map.getAttribute("data-had")).toBe("true");
});

it("renders the header and no add flags without ?add", async () => {
  getViewer.mockResolvedValue({ state: "anonymous" });
  render(await Home({ searchParams: Promise.resolve({}) }));
  expect(screen.getByTestId("site-header")).toBeTruthy();
  expect(screen.getByTestId("map").getAttribute("data-had")).toBe("false");
});
