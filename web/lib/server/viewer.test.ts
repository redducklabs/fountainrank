import { afterEach, describe, expect, it, vi } from "vitest";

const { getLogtoContext, GET, getAuthedApiClient, getAuthedApiClientForAction } = vi.hoisted(
  () => ({
    getLogtoContext: vi.fn(),
    GET: vi.fn(),
    getAuthedApiClient: vi.fn(async () => ({ GET: vi.fn() })),
    getAuthedApiClientForAction: vi.fn(async () => ({ GET: vi.fn() })),
  }),
);

vi.mock("server-only", () => ({}));
vi.mock("@logto/next/server-actions", () => ({ getLogtoContext, getAccessTokenRSC: vi.fn() }));
vi.mock("./api", () => ({ getAuthedApiClient, getAuthedApiClientForAction }));
vi.mock("../logto", () => ({ getLogtoConfig: () => ({}), API_RESOURCE: "https://api" }));

import { getViewer, getViewerForRoute, getViewerTotalPoints } from "./viewer";

afterEach(() => {
  vi.clearAllMocks();
  // Restore default: the clients resolve with a stub that has GET
  getAuthedApiClient.mockImplementation(async () => ({ GET }));
  getAuthedApiClientForAction.mockImplementation(async () => ({ GET }));
});

describe("getViewer", () => {
  it("returns anonymous when not authenticated", async () => {
    getLogtoContext.mockResolvedValue({ isAuthenticated: false });
    expect(await getViewer("r1")).toEqual({ state: "anonymous" });
  });

  it("returns anonymous when getLogtoContext throws (broken session)", async () => {
    getLogtoContext.mockRejectedValue(new Error("bad cookie"));
    expect(await getViewer("r1")).toEqual({ state: "anonymous" });
  });

  it("returns anonymous when getAuthedApiClient throws (token/session acquisition failure)", async () => {
    getLogtoContext.mockResolvedValue({ isAuthenticated: true });
    getAuthedApiClient.mockRejectedValue(new Error("no token"));
    expect(await getViewer("r1")).toEqual({ state: "anonymous" });
  });

  it("returns authed with profile on success", async () => {
    getLogtoContext.mockResolvedValue({ isAuthenticated: true });
    GET.mockResolvedValue({
      data: { display_name: "Aron", avatar_url: "http://a", is_admin: true, needs_name: false },
      response: { status: 200 },
    });
    expect(await getViewer("r1")).toEqual({
      state: "authed",
      displayName: "Aron",
      avatarUrl: "http://a",
      isAdmin: true,
      needsName: false,
    });
  });

  it("does not leak the subject when needs_name is true (display_name is empty)", async () => {
    getLogtoContext.mockResolvedValue({ isAuthenticated: true });
    GET.mockResolvedValue({
      data: { display_name: "", avatar_url: null, is_admin: false, needs_name: true },
      response: { status: 200 },
    });
    const viewer = await getViewer("r1");
    expect(viewer).toEqual({
      state: "authed",
      displayName: "",
      avatarUrl: null,
      isAdmin: false,
      needsName: true,
    });
    expect(JSON.stringify(viewer)).not.toContain("4zsznfwtd8cx"); // no subject anywhere
  });

  it("returns anonymous when /me is 401 (session no longer usable)", async () => {
    getLogtoContext.mockResolvedValue({ isAuthenticated: true });
    GET.mockResolvedValue({ data: undefined, response: { status: 401 } });
    expect(await getViewer("r1")).toEqual({ state: "anonymous" });
  });

  it("returns error when /me is 5xx (backend down) — never silently non-admin", async () => {
    getLogtoContext.mockResolvedValue({ isAuthenticated: true });
    GET.mockResolvedValue({ data: undefined, response: { status: 503 } });
    expect(await getViewer("r1")).toEqual({ state: "error" });
  });

  it("returns error when /me throws", async () => {
    getLogtoContext.mockResolvedValue({ isAuthenticated: true });
    GET.mockRejectedValue(new Error("network"));
    expect(await getViewer("r1")).toEqual({ state: "error" });
  });
});

describe("getViewerForRoute (route-handler-safe)", () => {
  it("reads /me via the action client and carries needsName", async () => {
    GET.mockResolvedValue({
      data: { display_name: "", avatar_url: null, is_admin: false, needs_name: true },
      response: { status: 200 },
    });
    expect(await getViewerForRoute("r1")).toEqual({
      state: "authed",
      displayName: "",
      avatarUrl: null,
      isAdmin: false,
      needsName: true,
    });
    expect(getAuthedApiClientForAction).toHaveBeenCalled();
  });

  it("returns anonymous when the action token client throws", async () => {
    getAuthedApiClientForAction.mockRejectedValue(new Error("no token"));
    expect(await getViewerForRoute("r1")).toEqual({ state: "anonymous" });
  });
});

describe("getViewerTotalPoints", () => {
  it("returns 0 when token/session acquisition fails", async () => {
    getAuthedApiClient.mockRejectedValue(new Error("no token"));
    expect(await getViewerTotalPoints("r1")).toBe(0);
    expect(GET).not.toHaveBeenCalled();
  });

  it("returns total points from contribution stats", async () => {
    GET.mockResolvedValue({
      data: { stats: { total_points: 42 } },
      response: { status: 200 },
    });
    expect(await getViewerTotalPoints("r1")).toBe(42);
  });

  it("returns 0 when contribution stats fail", async () => {
    GET.mockResolvedValue({ data: undefined, response: { status: 503 } });
    expect(await getViewerTotalPoints("r1")).toBe(0);
  });

  it("returns 0 when contribution stats throw", async () => {
    GET.mockRejectedValue(new Error("network"));
    expect(await getViewerTotalPoints("r1")).toBe(0);
  });
});
