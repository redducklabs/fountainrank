// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

const actions = vi.hoisted(() => ({
  adminHidePhoto: vi.fn(async () => ({ ok: true })),
  adminDeletePhoto: vi.fn(async () => ({ ok: true })),
  adminDismissReport: vi.fn(async () => ({ ok: true })),
  adminSetNoteHidden: vi.fn(async () => ({ ok: true })),
  adminSetFountainHidden: vi.fn(async () => ({ ok: true })),
  adminDeleteFountain: vi.fn(async () => ({ ok: true })),
}));
vi.mock("../../app/actions/admin", () => actions);
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));

import { ReportedContentActions } from "./ReportedContentActions";

const ID = "11111111-1111-1111-1111-111111111111";
const FID = "22222222-2222-2222-2222-222222222222";

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("per-type action availability", () => {
  it("photo: Hide, Reject, and Delete", () => {
    render(
      <ReportedContentActions
        contentType="photo"
        contentId={ID}
        fountainId={FID}
        isHidden={false}
      />,
    );
    expect(screen.getByRole("button", { name: "Hide" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Reject" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Delete" })).toBeTruthy();
  });

  it("note: Hide and Reject, but NO Delete (hide is the removal)", () => {
    render(
      <ReportedContentActions
        contentType="note"
        contentId={ID}
        fountainId={FID}
        isHidden={false}
      />,
    );
    expect(screen.getByRole("button", { name: "Hide" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Reject" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Delete" })).toBeNull();
  });

  it("fountain: Hide, Reject, and Delete", () => {
    render(
      <ReportedContentActions
        contentType="fountain"
        contentId={ID}
        fountainId={FID}
        isHidden={false}
      />,
    );
    expect(screen.getByRole("button", { name: "Delete" })).toBeTruthy();
  });

  it("reflects the hidden state on the toggle label", () => {
    render(
      <ReportedContentActions contentType="note" contentId={ID} fountainId={FID} isHidden={true} />,
    );
    expect(screen.getByRole("button", { name: "Unhide" })).toBeTruthy();
  });
});

it("Reject dispatches the generalized dismiss with the row's content type", async () => {
  render(
    <ReportedContentActions contentType="note" contentId={ID} fountainId={FID} isHidden={false} />,
  );
  fireEvent.click(screen.getByRole("button", { name: "Reject" }));
  await waitFor(() => expect(actions.adminDismissReport).toHaveBeenCalledWith("note", ID));
});

it("Delete is a two-step confirm before the destructive call", async () => {
  render(
    <ReportedContentActions
      contentType="fountain"
      contentId={ID}
      fountainId={FID}
      isHidden={false}
    />,
  );
  fireEvent.click(screen.getByRole("button", { name: "Delete" }));
  // First click reveals Confirm delete + Cancel and does NOT call the API.
  expect(actions.adminDeleteFountain).not.toHaveBeenCalled();
  expect(screen.getByRole("button", { name: "Cancel" })).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Confirm delete" }));
  await waitFor(() => expect(actions.adminDeleteFountain).toHaveBeenCalledWith(ID));
});
