// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";

const { getViewer, getContentReportsServer, notFound } = vi.hoisted(() => ({
  getViewer: vi.fn(),
  getContentReportsServer: vi.fn(),
  notFound: vi.fn(() => {
    throw new Error("NEXT_NOT_FOUND");
  }),
}));
vi.mock("../../../lib/server/viewer", () => ({ getViewer }));
vi.mock("../../../lib/server/content-reports", () => ({ getContentReportsServer }));
vi.mock("../../../lib/server/log", () => ({ log: vi.fn() }));
vi.mock("../../../lib/api", () => ({ resolveApiBaseUrl: () => "" }));
vi.mock("../../../components/SiteHeader", () => ({ SiteHeader: () => <div data-testid="hdr" /> }));
vi.mock("../../../components/admin/ReportedContentActions", () => ({
  ReportedContentActions: ({ contentType }: { contentType: string }) => (
    <div data-testid={`actions-${contentType}`} />
  ),
}));
vi.mock("next/navigation", () => ({ notFound }));
vi.mock("../../actions/auth", () => ({ signInWithReturn: vi.fn() }));

import AdminReportsPage from "./page";

const ADMIN = { state: "authed", displayName: "x", avatarUrl: null, isAdmin: true } as const;

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

it("404s a non-admin", async () => {
  getViewer.mockResolvedValue({ ...ADMIN, isAdmin: false });
  await expect(AdminReportsPage()).rejects.toThrow("NEXT_NOT_FOUND");
});

it("renders a heterogeneous queue: photo thumbnail, note excerpt, fountain label", async () => {
  getViewer.mockResolvedValue(ADMIN);
  getContentReportsServer.mockResolvedValue({
    status: 200,
    data: [
      {
        content_type: "photo",
        content_id: "p1",
        fountain_id: "f1",
        is_hidden: false,
        report_count: 2,
        categories: ["spam"],
        notes: ["bad photo"],
        first_reported_at: "2026-07-06T00:00:00Z",
        contributor: "Uploader",
        thumbnail_url: "/api/v1/photos/p1/thumb",
        url: "/api/v1/photos/p1",
        excerpt: null,
        fountain_label: null,
      },
      {
        content_type: "note",
        content_id: "n1",
        fountain_id: "f1",
        is_hidden: false,
        report_count: 1,
        categories: ["abuse"],
        notes: [],
        first_reported_at: "2026-07-06T00:00:00Z",
        contributor: "Author",
        thumbnail_url: null,
        url: null,
        excerpt: "an abusive note",
        fountain_label: null,
      },
      {
        content_type: "fountain",
        content_id: "f2",
        fountain_id: "f2",
        is_hidden: true,
        report_count: 1,
        categories: ["not_a_fountain"],
        notes: [],
        first_reported_at: "2026-07-06T00:00:00Z",
        contributor: null,
        thumbnail_url: null,
        url: null,
        excerpt: null,
        fountain_label: "north gate",
      },
    ],
  });

  const { container } = render(await AdminReportsPage());

  expect(screen.getByText("Moderation queue")).toBeTruthy();
  // photo row: thumbnail image at the resolved gated path. The decorative img (alt="") has ARIA
  // role "presentation", not "img", so query the DOM directly rather than by role.
  const img = container.querySelector("img");
  expect(img?.getAttribute("src")).toBe("/api/v1/photos/p1/thumb");
  // note row: excerpt + author
  expect(screen.getByText("an abusive note")).toBeTruthy();
  expect(screen.getByText(/by Author/)).toBeTruthy();
  // fountain row: label + Hidden chip (is_hidden)
  expect(screen.getByText("north gate")).toBeTruthy();
  expect(screen.getByText("Hidden")).toBeTruthy();
  // per-type action components rendered for all three
  expect(screen.getByTestId("actions-photo")).toBeTruthy();
  expect(screen.getByTestId("actions-note")).toBeTruthy();
  expect(screen.getByTestId("actions-fountain")).toBeTruthy();
});

it("shows the empty state when there are no pending reports", async () => {
  getViewer.mockResolvedValue(ADMIN);
  getContentReportsServer.mockResolvedValue({ status: 200, data: [] });
  render(await AdminReportsPage());
  expect(screen.getByText(/no pending reports/i)).toBeTruthy();
});

it("shows a retry state when the queue read fails", async () => {
  getViewer.mockResolvedValue(ADMIN);
  getContentReportsServer.mockResolvedValue({ status: 0, data: undefined });
  render(await AdminReportsPage());
  expect(screen.getByText(/couldn.t load reports/i)).toBeTruthy();
});
