// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

vi.mock("../../app/actions/auth", () => ({ signInWithReturn: vi.fn() }));

import { AddFountainFab } from "./AddFountainFab";

afterEach(cleanup);

describe("AddFountainFab", () => {
  it("is hidden when WebGL is unavailable", () => {
    const { container } = render(
      <AddFountainFab isAuthenticated webglOk={false} onEnter={() => {}} />,
    );
    expect(container.firstChild).toBeNull();
  });
  it("signed-in: clicking calls onEnter", () => {
    const onEnter = vi.fn();
    render(<AddFountainFab isAuthenticated webglOk onEnter={onEnter} />);
    fireEvent.click(screen.getByRole("button", { name: /add a fountain/i }));
    expect(onEnter).toHaveBeenCalled();
  });
  it("signed-out: renders a sign-in submit (no onEnter)", () => {
    const onEnter = vi.fn();
    render(<AddFountainFab isAuthenticated={false} webglOk onEnter={onEnter} />);
    expect(screen.getByRole("button", { name: /add a fountain/i })).toHaveProperty(
      "type",
      "submit",
    );
    expect(onEnter).not.toHaveBeenCalled();
  });
});
