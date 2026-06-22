import { afterEach, describe, expect, it, vi } from "vitest";

const { getLogtoContext, GET, getAuthedApiClient } = vi.hoisted(() => ({
  getLogtoContext: vi.fn(),
  GET: vi.fn(),
  getAuthedApiClient: vi.fn(async () => ({ GET: vi.fn() })),
}));

vi.mock("server-only", () => ({}));
vi.mock("@logto/next/server-actions", () => ({ getLogtoContext, getAccessTokenRSC: vi.fn() }));
vi.mock("./api", () => ({ getAuthedApiClient }));
vi.mock("../logto", () => ({ getLogtoConfig: () => ({}), API_RESOURCE: "https://api" }));

import { getViewer } from "./viewer";

afterEach(() => {
  vi.clearAllMocks();
  // Restore default: getAuthedApiClient resolves with a client that has GET
  getAuthedApiClient.mockImplementation(async () => ({ GET }));
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
      data: { display_name: "Aron", avatar_url: "http://a", is_admin: true },
      response: { status: 200 },
    });
    expect(await getViewer("r1")).toEqual({
      state: "authed",
      displayName: "Aron",
      avatarUrl: "http://a",
      isAdmin: true,
    });
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
