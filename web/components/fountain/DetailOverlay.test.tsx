// @vitest-environment jsdom
import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DetailOverlay } from "./DetailOverlay";

const { back } = vi.hoisted(() => ({ back: vi.fn() }));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ back }),
}));

beforeEach(() => {
  vi.useFakeTimers();
  back.mockReset();
});

afterEach(() => {
  vi.runOnlyPendingTimers();
  vi.useRealTimers();
});

describe("DetailOverlay", () => {
  it("guards close re-entry during the exit animation", () => {
    render(
      <DetailOverlay>
        <button type="button">Inside drawer</button>
      </DetailOverlay>,
    );

    fireEvent.keyDown(document, { key: "Escape" });
    fireEvent.click(screen.getByRole("button", { name: /close/i }));

    act(() => {
      vi.advanceTimersByTime(200);
    });

    expect(back).toHaveBeenCalledTimes(1);
  });
});
