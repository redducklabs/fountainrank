// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";

const { getViewer, notFound } = vi.hoisted(() => ({
  getViewer: vi.fn(),
  notFound: vi.fn(() => {
    throw new Error("NEXT_NOT_FOUND");
  }),
}));
vi.mock("../../lib/server/viewer", () => ({ getViewer }));
vi.mock("next/navigation", () => ({ notFound }));
vi.mock("../../components/SiteHeader", () => ({ SiteHeader: () => <div data-testid="hdr" /> }));
vi.mock("../actions/auth", () => ({ signInWithReturn: vi.fn() }));

import AdminPage from "./page";

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

it("renders a sign-in prompt for anonymous (no cookie mutation during render)", async () => {
  getViewer.mockResolvedValue({ state: "anonymous" });
  render(await AdminPage());
  // Assert the ADMIN-specific prompt (a stable contract that the return path is preserved),
  // not just any sign-in button — so a future edit can't silently drop the /admin context.
  expect(screen.getByText(/sign in to access the admin tools/i)).toBeTruthy();
  expect(screen.getByRole("button", { name: /sign in/i })).toBeTruthy();
});

it("404s a non-admin", async () => {
  getViewer.mockResolvedValue({
    state: "authed",
    displayName: "x",
    avatarUrl: null,
    isAdmin: false,
  });
  await expect(AdminPage()).rejects.toThrow("NEXT_NOT_FOUND");
});

it("shows a retry state on error (not admin content, not 404)", async () => {
  getViewer.mockResolvedValue({ state: "error" });
  render(await AdminPage());
  expect(screen.getByText(/couldn.t verify admin access/i)).toBeTruthy();
  expect(notFound).not.toHaveBeenCalled();
});

it("renders the inline-moderation landing for an admin", async () => {
  getViewer.mockResolvedValue({
    state: "authed",
    displayName: "x",
    avatarUrl: null,
    isAdmin: true,
  });
  render(await AdminPage());
  expect(screen.getByText(/moderation controls live inline/i)).toBeTruthy();
  expect(screen.getByText(/open a fountain from the map/i)).toBeTruthy();
});
