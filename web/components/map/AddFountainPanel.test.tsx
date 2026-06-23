// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

vi.mock("../../app/actions/auth", () => ({ signInWithReturn: vi.fn() }));

import { AddFountainPanel, type AddFountainPanelProps } from "./AddFountainPanel";

const base: AddFountainPanelProps = {
  phase: "placing",
  pin: null,
  working: true,
  placeable: false,
  gpsUnavailable: false,
  duplicateId: null,
  errorKind: null,
  onCancel: vi.fn(),
  onPlaceAtCenter: vi.fn(),
  onNudge: vi.fn(),
  onNext: vi.fn(),
  onBack: vi.fn(),
  onSetWorking: vi.fn(),
  onSubmit: vi.fn(),
};

afterEach(cleanup);

describe("AddFountainPanel", () => {
  it("Escape calls onCancel", () => {
    const onCancel = vi.fn();
    render(<AddFountainPanel {...base} onCancel={onCancel} />);
    fireEvent.keyDown(document, { key: "Escape" });
    expect(onCancel).toHaveBeenCalled();
  });

  it("placing: keyboard controls are disabled until placeable, then enabled", () => {
    const { rerender } = render(<AddFountainPanel {...base} />);
    expect(screen.getByRole("button", { name: /place at map center/i })).toHaveProperty(
      "disabled",
      true,
    );
    expect(screen.getByRole("button", { name: /next/i })).toHaveProperty("disabled", true);
    rerender(<AddFountainPanel {...base} placeable pin={{ lng: -122.3, lat: 47.6 }} />);
    expect(screen.getByRole("button", { name: /place at map center/i })).toHaveProperty(
      "disabled",
      false,
    );
    expect(screen.getByRole("button", { name: /next/i })).toHaveProperty("disabled", false);
  });

  it("placing: keyboard controls complete placement with no canvas interaction", () => {
    const onPlaceAtCenter = vi.fn();
    const onNudge = vi.fn();
    const onNext = vi.fn();
    render(
      <AddFountainPanel
        {...base}
        placeable
        pin={{ lng: -122.3, lat: 47.6 }}
        onPlaceAtCenter={onPlaceAtCenter}
        onNudge={onNudge}
        onNext={onNext}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /place at map center/i }));
    expect(onPlaceAtCenter).toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: /nudge north/i }));
    expect(onNudge).toHaveBeenCalledWith("n");
    fireEvent.click(screen.getByRole("button", { name: /next/i }));
    expect(onNext).toHaveBeenCalled();
  });

  it("placing: shows the fallback copy when GPS is unavailable", () => {
    render(<AddFountainPanel {...base} gpsUnavailable />);
    expect(screen.getByText(/couldn.t confirm your location/i)).toBeTruthy();
  });

  it("details: working toggle defaults to Yes and can flip", () => {
    const onSetWorking = vi.fn();
    render(
      <AddFountainPanel
        {...base}
        phase="details"
        pin={{ lng: -122.3, lat: 47.6 }}
        onSetWorking={onSetWorking}
      />,
    );
    expect(screen.getByRole("radio", { name: /yes/i })).toHaveProperty("checked", true);
    fireEvent.click(screen.getByRole("radio", { name: /no/i }));
    expect(onSetWorking).toHaveBeenCalledWith(false);
  });

  it("duplicate: shows a View it link to the existing fountain", () => {
    render(<AddFountainPanel {...base} phase="duplicate" duplicateId="dup-1" />);
    expect(screen.getByRole("link", { name: /view it/i }).getAttribute("href")).toBe(
      "/fountains/dup-1",
    );
  });

  it("error (server): shows a retry affordance and an aria-live message", () => {
    render(
      <AddFountainPanel
        {...base}
        phase="error"
        errorKind="server"
        pin={{ lng: -122.3, lat: 47.6 }}
      />,
    );
    expect(screen.getByRole("status")).toBeTruthy();
    expect(screen.getByRole("button", { name: /try again/i })).toBeTruthy();
  });

  it("error (unauthenticated): offers sign-in instead of retry", () => {
    render(
      <AddFountainPanel
        {...base}
        phase="error"
        errorKind="unauthenticated"
        pin={{ lng: -122.3, lat: 47.6 }}
      />,
    );
    expect(screen.getByRole("button", { name: /sign in/i })).toHaveProperty("type", "submit");
    expect(screen.queryByRole("button", { name: /try again/i })).toBeNull();
  });
});
