// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, fireEvent, waitFor } from "@testing-library/react";

const { submitNote, refresh } = vi.hoisted(() => ({ submitNote: vi.fn(), refresh: vi.fn() }));
vi.mock("../../app/actions/contribute", () => ({ submitNote }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));

import { NoteForm } from "./NoteForm";

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

it("typing updates the N/1000 counter", () => {
  render(<NoteForm fountainId="fid" />);
  fireEvent.change(screen.getByRole("textbox", { name: /your note/i }), {
    target: { value: "hello" },
  });
  expect(screen.getByText("5/1000")).toBeInTheDocument();
});

it("save with only whitespace does NOT call submitNote and shows 1-1000 message", async () => {
  render(<NoteForm fountainId="fid" />);
  fireEvent.change(screen.getByRole("textbox", { name: /your note/i }), {
    target: { value: "   " },
  });
  fireEvent.click(screen.getByRole("button", { name: /save note/i }));
  expect(submitNote).not.toHaveBeenCalled();
  expect(screen.getByRole("status")).toHaveTextContent(/please enter 1/i);
});

it("save button enabled even when empty (client-guards on submit)", () => {
  render(<NoteForm fountainId="fid" />);
  expect(screen.getByRole("button", { name: /save note/i })).not.toBeDisabled();
});

it("successful save shows 'Your note was saved.', clears textarea, calls refresh", async () => {
  submitNote.mockResolvedValue({ ok: true });
  render(<NoteForm fountainId="fid" />);
  fireEvent.change(screen.getByRole("textbox", { name: /your note/i }), {
    target: { value: "hello" },
  });
  fireEvent.click(screen.getByRole("button", { name: /save note/i }));
  await waitFor(() => expect(submitNote).toHaveBeenCalledWith("fid", "hello"));
  await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("Your note was saved."));
  await waitFor(() => expect(refresh).toHaveBeenCalled());
  expect((screen.getByRole("textbox", { name: /your note/i }) as HTMLTextAreaElement).value).toBe(
    "",
  );
});
