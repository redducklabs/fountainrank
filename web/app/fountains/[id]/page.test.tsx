// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const getDetail = vi.fn();
const getAdminDetail = vi.fn();
const getNotes = vi.fn();
const getViewerFn = vi.fn();
const getViewerTotalPointsFn = vi.fn();
const getTokenFn = vi.fn();
const logFn = vi.fn();
const notFoundFn = vi.fn(() => {
  throw new Error("NEXT_NOT_FOUND");
});

vi.mock("../../../lib/fountains", () => ({
  getFountainDetailServer: (...a: unknown[]) => getDetail(...a),
  getFountainNotesServer: (...a: unknown[]) => getNotes(...a),
}));
vi.mock("../../../lib/server/admin", () => ({
  getAdminFountainDetailServer: (...a: unknown[]) => getAdminDetail(...a),
}));
vi.mock("../../../lib/server/viewer", () => ({
  getViewer: (...a: unknown[]) => getViewerFn(...a),
  getViewerTotalPoints: (...a: unknown[]) => getViewerTotalPointsFn(...a),
}));
vi.mock("../../../lib/server/api", () => ({
  getViewerAccessToken: (...a: unknown[]) => getTokenFn(...a),
}));
vi.mock("../../../lib/server/log", () => ({ log: (...a: unknown[]) => logFn(...a) }));
vi.mock("next/navigation", () => ({ notFound: () => notFoundFn() }));
vi.mock("next/link", () => ({
  default: ({ children, href }: { children: ReactNode; href: string }) => (
    <a href={href}>{children}</a>
  ),
}));
vi.mock("../../../components/admin/FountainAdminControls", () => ({
  FountainAdminControls: () => <div data-testid="admin-controls" />,
}));
vi.mock("../../../components/fountain/FountainDetail", () => ({
  FountainDetail: ({
    notes,
    isAuthenticated,
    adminControls,
  }: {
    notes: unknown[];
    isAuthenticated: boolean;
    adminControls?: ReactNode;
  }) => (
    <div data-testid="detail" data-authed={String(isAuthenticated)}>
      notes:{notes.length}
      {adminControls}
    </div>
  ),
}));
vi.mock("../../../components/contributions/ContributionStatusOverlay", () => ({
  ContributionStatusOverlay: ({ initialTotalPoints }: { initialTotalPoints: number }) => (
    <div data-testid="contribution-status">points:{initialTotalPoints}</div>
  ),
}));
vi.mock("../../../components/SiteHeader", () => ({
  SiteHeader: () => <div data-testid="site-header" />,
}));

import FountainPage from "./page";

const params = Promise.resolve({ id: "f1" });

beforeEach(() => {
  getDetail.mockReset();
  getAdminDetail.mockReset();
  getNotes.mockReset();
  getViewerFn.mockReset();
  getViewerTotalPointsFn.mockReset();
  getTokenFn.mockReset();
  logFn.mockReset();
  notFoundFn.mockClear();
  getViewerFn.mockResolvedValue({ state: "anonymous" });
  getViewerTotalPointsFn.mockResolvedValue(0);
  getTokenFn.mockResolvedValue(null);
});

describe("FountainPage route (standalone)", () => {
  it("passes fetched notes through to the detail on success", async () => {
    getDetail.mockResolvedValue({ data: { id: "f1" }, status: 200 });
    getNotes.mockResolvedValue({ data: [{ id: "n1" }, { id: "n2" }], status: 200 });
    render(await FountainPage({ params }));
    expect(await screen.findByTestId("detail")).toHaveTextContent("notes:2");
    expect(logFn).not.toHaveBeenCalled();
  });
  it("non-fatal notes: 503 renders detail with notes=[] and a constrained warn log", async () => {
    getDetail.mockResolvedValue({ data: { id: "f1" }, status: 200 });
    getNotes.mockResolvedValue({ data: undefined, status: 503 });
    render(await FountainPage({ params }));
    expect(await screen.findByTestId("detail")).toHaveTextContent("notes:0");
    expect(logFn).toHaveBeenCalledWith("warn", expect.stringMatching(/notes/i), {
      requestId: expect.any(String),
      id: "f1",
      status: 503,
    });
  });
  it("detail 404 calls notFound() and does not render the detail", async () => {
    getDetail.mockResolvedValue({ data: undefined, status: 404 });
    getNotes.mockResolvedValue({ data: [], status: 200 });
    await expect(FountainPage({ params })).rejects.toThrow("NEXT_NOT_FOUND");
    expect(notFoundFn).toHaveBeenCalled();
  });
  it("detail network failure (!data) renders the error UI, not a blank/crash", async () => {
    getDetail.mockResolvedValue({ data: undefined, status: 0 });
    getNotes.mockResolvedValue({ data: undefined, status: 0 });
    render(await FountainPage({ params }));
    expect(await screen.findByText(/Couldn.t load this fountain/i)).toBeInTheDocument();
  });
  it("passes isAuthenticated=true when viewer.state is authed", async () => {
    getDetail.mockResolvedValue({ data: { id: "f1" }, status: 200 });
    getNotes.mockResolvedValue({ data: [], status: 200 });
    getViewerFn.mockResolvedValue({
      state: "authed",
      displayName: "Sam",
      avatarUrl: null,
      isAdmin: false,
    });
    render(await FountainPage({ params }));
    expect(await screen.findByTestId("detail")).toHaveAttribute("data-authed", "true");
  });
  it("renders contribution status on authenticated standalone pages", async () => {
    getDetail.mockResolvedValue({ data: { id: "f1" }, status: 200 });
    getNotes.mockResolvedValue({ data: [], status: 200 });
    getViewerFn.mockResolvedValue({
      state: "authed",
      displayName: "Sam",
      avatarUrl: null,
      isAdmin: false,
    });
    getViewerTotalPointsFn.mockResolvedValue(31);
    render(await FountainPage({ params }));
    expect(await screen.findByTestId("contribution-status")).toHaveTextContent("points:31");
  });
  it("passes isAuthenticated=false when viewer.state is anonymous", async () => {
    getDetail.mockResolvedValue({ data: { id: "f1" }, status: 200 });
    getNotes.mockResolvedValue({ data: [], status: 200 });
    getViewerFn.mockResolvedValue({ state: "anonymous" });
    render(await FountainPage({ params }));
    expect(await screen.findByTestId("detail")).toHaveAttribute("data-authed", "false");
  });
  it("forwards the viewer token to the detail fetch when authenticated (#114)", async () => {
    getDetail.mockResolvedValue({ data: { id: "f1" }, status: 200 });
    getNotes.mockResolvedValue({ data: [], status: 200 });
    getTokenFn.mockResolvedValue("tok-123");
    render(await FountainPage({ params }));
    expect(getDetail).toHaveBeenCalledWith("f1", expect.any(String), "tok-123");
  });
  it("fetches the detail anonymously (null token) when signed out (#114)", async () => {
    getDetail.mockResolvedValue({ data: { id: "f1" }, status: 200 });
    getNotes.mockResolvedValue({ data: [], status: 200 });
    getTokenFn.mockResolvedValue(null);
    render(await FountainPage({ params }));
    expect(getDetail).toHaveBeenCalledWith("f1", expect.any(String), null);
  });
  it("admin viewer uses the admin detail endpoint and renders admin controls", async () => {
    getViewerFn.mockResolvedValue({
      state: "authed",
      displayName: "Mod",
      avatarUrl: null,
      isAdmin: true,
    });
    getAdminDetail.mockResolvedValue({
      data: { id: "f1", notes: [{ id: "hidden-note", is_hidden: true }] },
      status: 200,
    });
    render(await FountainPage({ params }));
    expect(getAdminDetail).toHaveBeenCalledWith("f1", expect.any(String));
    expect(getDetail).not.toHaveBeenCalled();
    expect(getNotes).not.toHaveBeenCalled();
    expect(await screen.findByTestId("detail")).toHaveTextContent("notes:1");
    expect(await screen.findByTestId("admin-controls")).toBeInTheDocument();
  });
});
