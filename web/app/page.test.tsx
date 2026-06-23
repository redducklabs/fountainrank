// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";

const { getViewer } = vi.hoisted(() => ({ getViewer: vi.fn() }));
vi.mock("../lib/server/viewer", () => ({ getViewer }));
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

import Home from "./page";

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
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
