// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

const pending = vi.hoisted(() => ({ value: false }));
vi.mock("next/link", () => ({ useLinkStatus: () => ({ pending: pending.value }) }));

import { PendingLinkLabel } from "./PendingLinkLabel";

describe("PendingLinkLabel", () => {
  it("exposes busy state and pending copy", () => {
    pending.value = true;
    render(<PendingLinkLabel pendingLabel="Opening…">Open</PendingLinkLabel>);
    expect(screen.getByText("Opening…").parentElement).toHaveAttribute("aria-busy", "true");
  });

  it("renders normal copy while idle", () => {
    pending.value = false;
    render(<PendingLinkLabel>Open</PendingLinkLabel>);
    expect(screen.getByText("Open")).toBeInTheDocument();
  });
});
