// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { NoteOut } from "../../lib/fountains";
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
    const { container } = render(<NotesList notes={[]} now={now} />);
    expect(container.firstChild).toBeNull();
  });
  it("renders heading, body, author, relative time + edited marker", () => {
    render(<NotesList notes={[note({ updated_at: "2026-06-21T12:00:00Z" })]} now={now} />);
    expect(screen.getByText("Community notes")).toBeInTheDocument();
    expect(screen.getByText("Behind the restroom block")).toBeInTheDocument();
    expect(screen.getByText(/Alex/)).toBeInTheDocument();
    expect(screen.getByText(/2 days ago/)).toBeInTheDocument();
    expect(screen.getByText(/edited/)).toBeInTheDocument();
  });
  it("no edited marker when not edited", () => {
    render(<NotesList notes={[note()]} now={now} />);
    expect(screen.queryByText(/edited/)).not.toBeInTheDocument();
  });
  it("renders ONLY author_display_name — no other identity field leaks", () => {
    // A widened object carrying fields the web layer must never render.
    const leaky = {
      ...note({ author_display_name: "Alex" }),
      display_name: "PRIVATE_NAME",
      user_id: "logto-subject-123",
    } as unknown as NoteOut;
    render(<NotesList notes={[leaky]} now={now} />);
    expect(screen.getByText(/Alex/)).toBeInTheDocument();
    expect(screen.queryByText(/PRIVATE_NAME/)).not.toBeInTheDocument();
    expect(screen.queryByText(/logto-subject-123/)).not.toBeInTheDocument();
  });
});
