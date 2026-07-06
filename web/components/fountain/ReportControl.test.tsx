// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

const { reportContent } = vi.hoisted(() => ({ reportContent: vi.fn() }));
vi.mock("../../app/actions/contribute", () => ({ reportContent }));

import { ReportControl } from "./ReportControl";
import { REPORT_CATEGORIES } from "./reportCategories";

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("ReportControl", () => {
  it("renders a trigger and no dialog until clicked", () => {
    render(
      <ReportControl
        contentType="note"
        fountainId="fid"
        contentId="nid"
        categories={REPORT_CATEGORIES.note}
      />,
    );
    expect(screen.getByRole("button", { name: /^report$/i })).toBeInTheDocument();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("opens the content report dialog for the given content type/id on click", () => {
    render(
      <ReportControl
        contentType="note"
        fountainId="fid"
        contentId="nid"
        categories={REPORT_CATEGORIES.note}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /^report$/i }));
    expect(screen.getByRole("dialog", { name: /report note/i })).toBeInTheDocument();
  });

  it("supports a custom label for the fountain-level control", () => {
    render(
      <ReportControl
        contentType="fountain"
        fountainId="fid"
        contentId="fid"
        categories={REPORT_CATEGORIES.fountain}
        label="Report this fountain"
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /report this fountain/i }));
    expect(screen.getByRole("dialog", { name: /report this fountain/i })).toBeInTheDocument();
  });

  it("submits through reportContent, then a reopen shows the already-reported notice", async () => {
    reportContent.mockResolvedValue({ ok: true });
    render(
      <ReportControl
        contentType="note"
        fountainId="fid"
        contentId="nid"
        categories={REPORT_CATEGORIES.note}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /^report$/i }));
    fireEvent.click(screen.getByRole("button", { name: /submit report/i }));
    await waitFor(() =>
      expect(reportContent).toHaveBeenCalledWith("note", "fid", "nid", "spam", undefined),
    );
    // Dismiss (Escape) and reopen — the control remembers it was reported this session.
    fireEvent.keyDown(document, { key: "Escape" });
    fireEvent.click(screen.getByRole("button", { name: /^report$/i }));
    expect(screen.getByText(/already reported this note/i)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /submit report/i })).not.toBeInTheDocument();
  });
});
