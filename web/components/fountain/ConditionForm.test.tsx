// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, fireEvent, waitFor } from "@testing-library/react";

const { submitCondition, refresh } = vi.hoisted(() => ({
  submitCondition: vi.fn(),
  refresh: vi.fn(),
}));
vi.mock("../../app/actions/contribute", () => ({ submitCondition }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));

import { ConditionForm } from "./ConditionForm";

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

it("clicking 'I checked' calls submitCondition with working", async () => {
  submitCondition.mockResolvedValue({ ok: true });
  render(<ConditionForm fountainId="fid" />);
  fireEvent.click(screen.getByRole("button", { name: /i checked/i }));
  await waitFor(() => expect(submitCondition).toHaveBeenCalledWith("fid", "working"));
  await waitFor(() => expect(refresh).toHaveBeenCalled());
});

it("'Report a problem' disclosure reveals 7 option labels", async () => {
  render(<ConditionForm fountainId="fid" />);
  const disclosureBtn = screen.getByRole("button", { name: /report a problem/i });
  expect(disclosureBtn).toHaveAttribute("aria-expanded", "false");
  fireEvent.click(disclosureBtn);
  expect(disclosureBtn).toHaveAttribute("aria-expanded", "true");
  expect(screen.getByRole("option", { name: /broken \/ not working/i })).toBeInTheDocument();
  expect(screen.getByRole("option", { name: /low water pressure/i })).toBeInTheDocument();
  expect(screen.getByRole("option", { name: /dirty/i })).toBeInTheDocument();
  expect(screen.getByRole("option", { name: /bad taste/i })).toBeInTheDocument();
  expect(screen.getByRole("option", { name: /blocked/i })).toBeInTheDocument();
  expect(screen.getByRole("option", { name: /shut off for the season/i })).toBeInTheDocument();
  expect(screen.getByRole("option", { name: /only available certain hours/i })).toBeInTheDocument();
});

it("changing select + submit calls with that status", async () => {
  submitCondition.mockResolvedValue({ ok: true });
  render(<ConditionForm fountainId="fid" />);
  fireEvent.click(screen.getByRole("button", { name: /report a problem/i }));
  const select = screen.getByRole("combobox");
  fireEvent.change(select, { target: { value: "low_pressure" } });
  fireEvent.click(screen.getByRole("button", { name: /submit/i }));
  await waitFor(() => expect(submitCondition).toHaveBeenCalledWith("fid", "low_pressure"));
});

it("shows error message on server failure", async () => {
  submitCondition.mockResolvedValue({ ok: false, error: "server" });
  render(<ConditionForm fountainId="fid" />);
  fireEvent.click(screen.getByRole("button", { name: /i checked/i }));
  await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent(/couldn't save/i));
});

it("shows the ineligible warning when conditionPointsEligibleAt is in the future", () => {
  const future = new Date(Date.now() + 3_600_000).toISOString();
  render(<ConditionForm fountainId="fid" conditionPointsEligibleAt={future} />);
  // Component text uses the codebase's curly-apostrophe convention (&rsquo; → ’ once JSX
  // decodes it), so the regex must match that glyph rather than a straight apostrophe.
  expect(screen.getByText(/won’t earn points/i)).toBeInTheDocument();
  // Warn, don't block: the submit control stays enabled.
  expect(screen.getByRole("button", { name: /i checked/i })).not.toBeDisabled();
});

it("celebrates the server's awarded points, not a client guess", async () => {
  submitCondition.mockResolvedValue({ ok: true, pointsAwarded: 0 });
  render(<ConditionForm fountainId="fid" />);
  fireEvent.click(screen.getByRole("button", { name: /i checked/i }));
  await waitFor(() =>
    expect(screen.getByRole("status")).toHaveTextContent(/already counted recently/i),
  );
});
