// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

const { reportContent } = vi.hoisted(() => ({ reportContent: vi.fn() }));
vi.mock("../../app/actions/contribute", () => ({ reportContent }));

import { ReportContentDialog } from "./ReportContentDialog";
import { REPORT_CATEGORIES } from "./reportCategories";

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("ReportContentDialog", () => {
  it("renders the labelled options for the given categories prop (note set)", () => {
    render(
      <ReportContentDialog
        contentType="note"
        fountainId="fid"
        contentId="nid"
        categories={REPORT_CATEGORIES.note}
        alreadyReported={false}
        onClose={vi.fn()}
        onReported={vi.fn()}
      />,
    );
    // Note set: spam, abuse, inappropriate, inaccurate, other — Abuse/Inaccurate are note-only.
    const select = screen.getByLabelText(/reason/i) as HTMLSelectElement;
    const values = Array.from(select.options).map((o) => o.value);
    expect(values).toEqual(["spam", "abuse", "inappropriate", "inaccurate", "other"]);
    expect(screen.getByRole("option", { name: "Abuse" })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "Inaccurate" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: /report note/i })).toBeInTheDocument();
  });

  it("submits contentType/ids/category/trimmed note through reportContent", async () => {
    reportContent.mockResolvedValue({ ok: true });
    const onReported = vi.fn();
    render(
      <ReportContentDialog
        contentType="note"
        fountainId="fid"
        contentId="nid"
        categories={REPORT_CATEGORIES.note}
        alreadyReported={false}
        onClose={vi.fn()}
        onReported={onReported}
      />,
    );
    fireEvent.change(screen.getByLabelText(/reason/i), { target: { value: "abuse" } });
    fireEvent.change(screen.getByLabelText(/note/i), { target: { value: "  harassment  " } });
    fireEvent.click(screen.getByRole("button", { name: /submit report/i }));
    await waitFor(() =>
      expect(reportContent).toHaveBeenCalledWith("note", "fid", "nid", "abuse", "harassment"),
    );
    await waitFor(() => expect(onReported).toHaveBeenCalled());
    expect(screen.getByRole("status")).toHaveTextContent(/thanks/i);
  });

  it("defaults to the first category and titles a fountain report", async () => {
    reportContent.mockResolvedValue({ ok: true });
    render(
      <ReportContentDialog
        contentType="fountain"
        fountainId="fid"
        contentId="fid"
        categories={REPORT_CATEGORIES.fountain}
        alreadyReported={false}
        onClose={vi.fn()}
        onReported={vi.fn()}
      />,
    );
    expect(screen.getByRole("heading", { name: /report this fountain/i })).toBeInTheDocument();
    // No note typed -> undefined note; first category (not_a_fountain) is the default.
    fireEvent.click(screen.getByRole("button", { name: /submit report/i }));
    await waitFor(() =>
      expect(reportContent).toHaveBeenCalledWith(
        "fountain",
        "fid",
        "fid",
        "not_a_fountain",
        undefined,
      ),
    );
  });

  it("shows a friendly error and does not call onReported on failure", async () => {
    reportContent.mockResolvedValue({ ok: false, error: "server" });
    const onReported = vi.fn();
    render(
      <ReportContentDialog
        contentType="photo"
        fountainId="fid"
        contentId="pid"
        categories={REPORT_CATEGORIES.photo}
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
      <ReportContentDialog
        contentType="photo"
        fountainId="fid"
        contentId="pid"
        categories={REPORT_CATEGORIES.photo}
        alreadyReported={false}
        onClose={onClose}
        onReported={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /cancel/i }));
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(reportContent).not.toHaveBeenCalled();

    fireEvent.keyDown(document, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(2);
  });

  it("alreadyReported=true shows a read-only notice with no form", () => {
    render(
      <ReportContentDialog
        contentType="note"
        fountainId="fid"
        contentId="nid"
        categories={REPORT_CATEGORIES.note}
        alreadyReported={true}
        onClose={vi.fn()}
        onReported={vi.fn()}
      />,
    );
    expect(screen.getByText(/already reported this note/i)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /submit report/i })).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/reason/i)).not.toBeInTheDocument();
  });
});
