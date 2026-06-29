// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const getDetail = vi.fn();
const getAdminDetail = vi.fn();
const getNotes = vi.fn();
const getViewerFn = vi.fn();
const getTokenFn = vi.fn();
const logFn = vi.fn();

vi.mock("../../../../lib/fountains", () => ({
  getFountainDetailServer: (...a: unknown[]) => getDetail(...a),
  getFountainNotesServer: (...a: unknown[]) => getNotes(...a),
}));
vi.mock("../../../../lib/server/admin", () => ({
  getAdminFountainDetailServer: (...a: unknown[]) => getAdminDetail(...a),
}));
vi.mock("../../../../lib/server/viewer", () => ({
  getViewer: (...a: unknown[]) => getViewerFn(...a),
}));
vi.mock("../../../../lib/server/api", () => ({
  getViewerAccessToken: (...a: unknown[]) => getTokenFn(...a),
}));
vi.mock("../../../../lib/server/log", () => ({ log: (...a: unknown[]) => logFn(...a) }));
vi.mock("../../../../components/fountain/DetailOverlay", () => ({
  DetailOverlay: ({ children }: { children: ReactNode }) => (
    <div data-testid="overlay">{children}</div>
  ),
}));
vi.mock("../../../../components/admin/FountainAdminControls", () => ({
  FountainAdminControls: () => <div data-testid="admin-controls" />,
}));
vi.mock("../../../../components/fountain/FountainDetail", () => ({
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

import FountainModal from "./page";

const params = Promise.resolve({ id: "f1" });

beforeEach(() => {
  getDetail.mockReset();
  getAdminDetail.mockReset();
  getNotes.mockReset();
  getViewerFn.mockReset();
  getTokenFn.mockReset();
  logFn.mockReset();
  getViewerFn.mockResolvedValue({ state: "anonymous" });
  getTokenFn.mockResolvedValue(null);
});

describe("FountainModal route (overlay)", () => {
  it("passes fetched notes through on success", async () => {
    getDetail.mockResolvedValue({ data: { id: "f1" }, status: 200 });
    getNotes.mockResolvedValue({ data: [{ id: "n1" }], status: 200 });
    render(await FountainModal({ params }));
    expect(await screen.findByTestId("detail")).toHaveTextContent("notes:1");
    expect(logFn).not.toHaveBeenCalled();
  });
  it("non-fatal notes: 503 renders detail with notes=[] + constrained warn log", async () => {
    getDetail.mockResolvedValue({ data: { id: "f1" }, status: 200 });
    getNotes.mockResolvedValue({ data: undefined, status: 503 });
    render(await FountainModal({ params }));
    expect(await screen.findByTestId("detail")).toHaveTextContent("notes:0");
    expect(logFn).toHaveBeenCalledWith("warn", expect.stringMatching(/notes/i), {
      requestId: expect.any(String),
      id: "f1",
      status: 503,
    });
  });
  it("detail 404 renders the overlay not-found message", async () => {
    getDetail.mockResolvedValue({ data: undefined, status: 404 });
    getNotes.mockResolvedValue({ data: [], status: 200 });
    render(await FountainModal({ params }));
    expect(await screen.findByText(/Fountain not found/i)).toBeInTheDocument();
  });
  it("detail network failure renders the overlay error message", async () => {
    getDetail.mockResolvedValue({ data: undefined, status: 0 });
    getNotes.mockResolvedValue({ data: undefined, status: 0 });
    render(await FountainModal({ params }));
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
    render(await FountainModal({ params }));
    expect(await screen.findByTestId("detail")).toHaveAttribute("data-authed", "true");
  });
  it("passes isAuthenticated=false when viewer.state is anonymous", async () => {
    getDetail.mockResolvedValue({ data: { id: "f1" }, status: 200 });
    getNotes.mockResolvedValue({ data: [], status: 200 });
    getViewerFn.mockResolvedValue({ state: "anonymous" });
    render(await FountainModal({ params }));
    expect(await screen.findByTestId("detail")).toHaveAttribute("data-authed", "false");
  });
  it("forwards the viewer token to the detail fetch when authenticated (#114)", async () => {
    getDetail.mockResolvedValue({ data: { id: "f1" }, status: 200 });
    getNotes.mockResolvedValue({ data: [], status: 200 });
    getViewerFn.mockResolvedValue({
      state: "authed",
      displayName: "Sam",
      avatarUrl: null,
      isAdmin: false,
    });
    getTokenFn.mockResolvedValue("tok-xyz");
    render(await FountainModal({ params }));
    expect(getDetail).toHaveBeenCalledWith("f1", expect.any(String), "tok-xyz");
  });
  it("fetches the detail anonymously (null token) when signed out (#114)", async () => {
    getDetail.mockResolvedValue({ data: { id: "f1" }, status: 200 });
    getNotes.mockResolvedValue({ data: [], status: 200 });
    getTokenFn.mockResolvedValue(null);
    render(await FountainModal({ params }));
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
    render(await FountainModal({ params }));
    expect(getAdminDetail).toHaveBeenCalledWith("f1", expect.any(String));
    expect(getDetail).not.toHaveBeenCalled();
    expect(getNotes).not.toHaveBeenCalled();
    expect(await screen.findByTestId("detail")).toHaveTextContent("notes:1");
    expect(await screen.findByTestId("admin-controls")).toBeInTheDocument();
  });
});
