// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import type { Viewer } from "../lib/server/viewer";

const { getViewer, getViewerTotalPoints, getPendingReportCountServer } = vi.hoisted(() => ({
  getViewer: vi.fn<() => Promise<Viewer>>(async () => ({ state: "anonymous" })),
  getViewerTotalPoints: vi.fn(async () => 0),
  getPendingReportCountServer: vi.fn(async () => 0),
}));
vi.mock("../lib/server/viewer", () => ({
  getViewer,
  getViewerTotalPoints,
}));
vi.mock("../lib/server/content-reports", () => ({
  getPendingReportCountServer,
}));
vi.mock("./AuthControl", () => ({ AuthControl: () => <div data-testid="auth-control" /> }));
vi.mock("./HeaderPoints", () => ({
  HeaderPoints: ({ initialTotalPoints }: { initialTotalPoints: number }) => (
    <div data-testid="header-points">{initialTotalPoints}</div>
  ),
}));
vi.mock("./HeaderSearch", () => ({ HeaderSearch: () => <div data-testid="header-search" /> }));

import { SiteHeader } from "./SiteHeader";

afterEach(cleanup);
afterEach(() => {
  vi.clearAllMocks();
});

describe("SiteHeader", () => {
  it("hero variant shows the positioning h1", async () => {
    render(await SiteHeader({ variant: "hero" }));
    expect(
      screen.getByRole("heading", {
        level: 1,
        name: /the largest community-rated guide to public drinking fountains/i,
      }),
    ).toBeTruthy();
    expect(screen.getByTestId("auth-control")).toBeTruthy();
  });

  it("renders the ever-present header search in both variants", async () => {
    render(await SiteHeader({ variant: "hero" }));
    expect(screen.getByTestId("header-search")).toBeTruthy();
    cleanup();
    render(await SiteHeader({ variant: "bar" }));
    expect(screen.getByTestId("header-search")).toBeTruthy();
  });

  it("bar variant has no tagline", async () => {
    render(await SiteHeader({ variant: "bar" }));
    expect(screen.queryByText(/the largest community-rated guide/i)).toBeNull();
  });

  it("shows points in the right-side header cluster for authenticated viewers", async () => {
    getViewer.mockResolvedValue({
      state: "authed",
      displayName: "A",
      avatarUrl: null,
      isAdmin: false,
      needsName: false,
    });
    getViewerTotalPoints.mockResolvedValue(196);

    render(await SiteHeader({ variant: "bar" }));

    expect(screen.getByTestId("header-points")).toHaveTextContent("196");
    expect(screen.getByTestId("header-points").parentElement).toHaveClass("ml-auto");
  });

  it("reads the pending report count only for an admin viewer", async () => {
    getViewer.mockResolvedValue({
      state: "authed",
      displayName: "A",
      avatarUrl: null,
      isAdmin: false,
      needsName: false,
    });
    render(await SiteHeader({ variant: "bar" }));
    expect(getPendingReportCountServer).not.toHaveBeenCalled();

    cleanup();
    vi.clearAllMocks();
    getViewer.mockResolvedValue({
      state: "authed",
      displayName: "A",
      avatarUrl: null,
      isAdmin: true,
      needsName: false,
    });
    render(await SiteHeader({ variant: "bar" }));
    expect(getPendingReportCountServer).toHaveBeenCalled();
  });
});
