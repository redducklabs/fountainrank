// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

const { reportPhoto } = vi.hoisted(() => ({ reportPhoto: vi.fn() }));
vi.mock("../../app/actions/contribute", () => ({ reportPhoto }));

import { ReportPhotoDialog } from "./ReportPhotoDialog";

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("ReportPhotoDialog", () => {
  it("submits the selected category and trimmed note", async () => {
    reportPhoto.mockResolvedValue({ ok: true });
    const onReported = vi.fn();
    render(
      <ReportPhotoDialog
        fountainId="fid"
        photoId="pid"
        alreadyReported={false}
        onClose={vi.fn()}
        onReported={onReported}
      />,
    );
    fireEvent.change(screen.getByLabelText(/reason/i), { target: { value: "spam" } });
    fireEvent.change(screen.getByLabelText(/note/i), { target: { value: "  looks fake  " } });
    fireEvent.click(screen.getByRole("button", { name: /submit report/i }));
    await waitFor(() =>
      expect(reportPhoto).toHaveBeenCalledWith("fid", "pid", "spam", "looks fake"),
    );
    await waitFor(() => expect(onReported).toHaveBeenCalled());
    expect(screen.getByRole("status")).toHaveTextContent(/thanks/i);
  });

  it("shows a friendly error and does not call onReported on failure", async () => {
    reportPhoto.mockResolvedValue({ ok: false, error: "server" });
    const onReported = vi.fn();
    render(
      <ReportPhotoDialog
        fountainId="fid"
        photoId="pid"
        alreadyReported={false}
        onClose={vi.fn()}
        onReported={onReported}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /submit report/i }));
    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent(/couldn't save/i));
    expect(onReported).not.toHaveBeenCalled();
  });

  it("Cancel and Escape both call onClose without submitting", () => {
    const onClose = vi.fn();
    render(
      <ReportPhotoDialog
        fountainId="fid"
        photoId="pid"
        alreadyReported={false}
        onClose={onClose}
        onReported={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /cancel/i }));
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(reportPhoto).not.toHaveBeenCalled();

    fireEvent.keyDown(document, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(2);
  });

  it("alreadyReported=true shows a read-only notice with no form", () => {
    render(
      <ReportPhotoDialog
        fountainId="fid"
        photoId="pid"
        alreadyReported={true}
        onClose={vi.fn()}
        onReported={vi.fn()}
      />,
    );
    expect(screen.getByText(/already reported/i)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /submit report/i })).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/reason/i)).not.toBeInTheDocument();
  });
});
