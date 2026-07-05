// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

const { hideFn, dismissFn, deleteFn, refreshFn } = vi.hoisted(() => ({
  hideFn: vi.fn(),
  dismissFn: vi.fn(),
  deleteFn: vi.fn(),
  refreshFn: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: refreshFn }),
}));
vi.mock("../../app/actions/admin", () => ({
  adminHidePhoto: hideFn,
  adminDismissPhotoReports: dismissFn,
  adminDeletePhoto: deleteFn,
}));

import { ReportedPhotoActions } from "./ReportedPhotoActions";

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("ReportedPhotoActions", () => {
  it("calls adminHidePhoto(id, true) and refreshes on Hide", async () => {
    hideFn.mockResolvedValue({ ok: true });
    render(<ReportedPhotoActions photoId="p1" isHidden={false} />);
    fireEvent.click(screen.getByRole("button", { name: "Hide" }));
    await waitFor(() => expect(hideFn).toHaveBeenCalledWith("p1", true));
    await waitFor(() => expect(refreshFn).toHaveBeenCalled());
  });

  it("shows Unhide and calls adminHidePhoto(id, false) when already hidden", async () => {
    hideFn.mockResolvedValue({ ok: true });
    render(<ReportedPhotoActions photoId="p1" isHidden={true} />);
    fireEvent.click(screen.getByRole("button", { name: "Unhide" }));
    await waitFor(() => expect(hideFn).toHaveBeenCalledWith("p1", false));
  });

  it("calls adminDismissPhotoReports(id) on Reject", async () => {
    dismissFn.mockResolvedValue({ ok: true });
    render(<ReportedPhotoActions photoId="p1" isHidden={false} />);
    fireEvent.click(screen.getByRole("button", { name: "Reject" }));
    await waitFor(() => expect(dismissFn).toHaveBeenCalledWith("p1"));
  });

  it("requires a second click before calling adminDeletePhoto(id)", async () => {
    deleteFn.mockResolvedValue({ ok: true });
    render(<ReportedPhotoActions photoId="p1" isHidden={false} />);
    fireEvent.click(screen.getByRole("button", { name: "Delete" }));
    expect(deleteFn).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Confirm delete" }));
    await waitFor(() => expect(deleteFn).toHaveBeenCalledWith("p1"));
  });

  it("surfaces an error message and does not refresh when the action fails", async () => {
    hideFn.mockResolvedValue({ ok: false, error: "forbidden" });
    render(<ReportedPhotoActions photoId="p1" isHidden={false} />);
    fireEvent.click(screen.getByRole("button", { name: "Hide" }));
    await waitFor(() =>
      expect(screen.getByText("This account does not have admin access.")).toBeInTheDocument(),
    );
    expect(refreshFn).not.toHaveBeenCalled();
  });
});
