// @vitest-environment jsdom
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { NoteOut } from "../../lib/fountains";

// The note row now mounts a Report affordance whose dialog imports the `reportContent` server
// action; mock it so the (server-only) action module is never loaded into the jsdom test.
vi.mock("../../app/actions/contribute", () => ({ reportContent: vi.fn() }));

import { NotesList } from "./NotesList";

const now = new Date("2026-06-22T12:00:00Z");
const note = (over: Partial<NoteOut> = {}): NoteOut => ({
  id: "n1",
  body: "Behind the restroom block",
  author_display_name: "Alex",
  created_at: "2026-06-20T12:00:00Z",
  updated_at: "2026-06-20T12:00:00Z",
  ...over,
});

describe("NotesList", () => {
  it("returns null when empty", () => {
    const { container } = render(
      <NotesList notes={[]} now={now} fountainId="fid" isAuthenticated={false} />,
    );
    expect(container.firstChild).toBeNull();
  });
  it("renders heading, body, author, relative time + edited marker", () => {
    render(
      <NotesList
        notes={[note({ updated_at: "2026-06-21T12:00:00Z" })]}
        now={now}
        fountainId="fid"
        isAuthenticated={false}
      />,
    );
    expect(screen.getByText("Community notes")).toBeInTheDocument();
    expect(screen.getByText("Behind the restroom block")).toBeInTheDocument();
    expect(screen.getByText(/Alex/)).toBeInTheDocument();
    expect(screen.getByText(/2 days ago/)).toBeInTheDocument();
    expect(screen.getByText(/edited/)).toBeInTheDocument();
  });
  it("no edited marker when not edited", () => {
    render(<NotesList notes={[note()]} now={now} fountainId="fid" isAuthenticated={false} />);
    expect(screen.queryByText(/edited/)).not.toBeInTheDocument();
  });
  it("renders ONLY author_display_name — no other identity field leaks", () => {
    // A widened object carrying fields the web layer must never render.
    const leaky = {
      ...note({ author_display_name: "Alex" }),
      display_name: "PRIVATE_NAME",
      user_id: "logto-subject-123",
    } as unknown as NoteOut;
    render(<NotesList notes={[leaky]} now={now} fountainId="fid" isAuthenticated={false} />);
    expect(screen.getByText(/Alex/)).toBeInTheDocument();
    expect(screen.queryByText(/PRIVATE_NAME/)).not.toBeInTheDocument();
    expect(screen.queryByText(/logto-subject-123/)).not.toBeInTheDocument();
  });
  it("no Report affordance for a signed-out viewer", () => {
    render(
      <NotesList
        notes={[note(), note({ id: "n2", body: "Second note" })]}
        now={now}
        fountainId="fid"
        isAuthenticated={false}
      />,
    );
    expect(screen.queryByRole("button", { name: /report/i })).not.toBeInTheDocument();
  });
  it("signed-in viewer sees a Report control per note that opens the note report dialog", () => {
    render(
      <NotesList
        notes={[note({ id: "n1" }), note({ id: "n2", body: "Second note" })]}
        now={now}
        fountainId="fid"
        isAuthenticated={true}
      />,
    );
    const reportButtons = screen.getAllByRole("button", { name: /^report$/i });
    expect(reportButtons).toHaveLength(2);
    // Opening one surfaces the generalized dialog titled for a note report.
    fireEvent.click(reportButtons[0]);
    expect(screen.getByRole("dialog", { name: /report note/i })).toBeInTheDocument();
  });
});
