// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { StatusBlock } from "./StatusBlock";

const now = new Date("2026-06-22T12:00:00Z");

describe("StatusBlock", () => {
  it("ok: verified-working chip + relative trust line + precise title", () => {
    render(
      <StatusBlock currentStatus="ok" isWorking lastVerifiedAt="2026-06-19T12:00:00Z" now={now} />,
    );
    expect(screen.getByText("Verified working")).toBeInTheDocument();
    const trust = screen.getByText(/Last verified 3 days ago/);
    expect(trust).toHaveAttribute("title", "Jun 19, 2026");
  });
  it("reported_issue: baseline Working chip + advisory line", () => {
    render(
      <StatusBlock currentStatus="reported_issue" isWorking lastVerifiedAt={null} now={now} />,
    );
    expect(screen.getByText("Working")).toBeInTheDocument();
    expect(screen.getByText(/Issue reported recently/)).toBeInTheDocument();
  });
  it("null + working: baseline chip + not-yet-verified line", () => {
    render(<StatusBlock currentStatus={null} isWorking lastVerifiedAt={null} now={now} />);
    expect(screen.getByText("Working")).toBeInTheDocument();
    expect(screen.getByText("Not yet verified by anyone")).toBeInTheDocument();
  });
  it("null + not working: out-of-order baseline", () => {
    render(<StatusBlock currentStatus={null} isWorking={false} lastVerifiedAt={null} now={now} />);
    expect(screen.getByText("Out of order")).toBeInTheDocument();
  });
});
