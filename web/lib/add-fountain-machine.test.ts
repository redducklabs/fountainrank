import { describe, expect, it } from "vitest";
import { addReducer, initialAddState, type AddState } from "./add-fountain-machine";
import type { Bound } from "./map/placement";

const circle: Bound = { kind: "circle", center: { lng: -122.3, lat: 47.6 }, radiusM: 150 };
const placing: AddState = { ...initialAddState, phase: "placing", bound: circle };

describe("addReducer", () => {
  it("ENTER starts placing with defaults (working = true)", () => {
    const s = addReducer(initialAddState, { type: "ENTER" });
    expect(s.phase).toBe("placing");
    expect(s.working).toBe(true);
    expect(s.pin).toBeNull();
  });
  it("CANCEL resets to idle", () => {
    expect(addReducer(placing, { type: "CANCEL" })).toEqual(initialAddState);
  });
  it("DROP_PIN clamps to the bound", () => {
    const s = addReducer(placing, { type: "DROP_PIN", point: { lng: -122.0, lat: 47.6 } });
    expect(s.pin).not.toBeNull();
    expect(Math.abs(s.pin!.lng - -122.3)).toBeLessThan(0.01);
  });
  it("SET_BOUND re-clamps an existing pin", () => {
    const dropped = addReducer(placing, { type: "DROP_PIN", point: { lng: -122.3005, lat: 47.6 } });
    const s = addReducer(dropped, { type: "SET_BOUND", bound: circle });
    expect(s.bound).toEqual(circle);
    expect(s.pin).not.toBeNull();
  });
  it("NUDGE moves the pin and clamps; no-op without a pin", () => {
    expect(addReducer(placing, { type: "NUDGE", dir: "n" }).pin).toBeNull();
    const dropped = addReducer(placing, { type: "DROP_PIN", point: { lng: -122.3, lat: 47.6 } });
    expect(addReducer(dropped, { type: "NUDGE", dir: "n" }).pin!.lat).toBeGreaterThan(
      dropped.pin!.lat,
    );
  });
  it("NEXT requires a pin and only advances from placing; BACK returns", () => {
    expect(addReducer(placing, { type: "NEXT" }).phase).toBe("placing");
    const dropped = addReducer(placing, { type: "DROP_PIN", point: { lng: -122.3, lat: 47.6 } });
    const details = addReducer(dropped, { type: "NEXT" });
    expect(details.phase).toBe("details");
    expect(addReducer(details, { type: "BACK" }).phase).toBe("placing");
  });
  it("SET_WORKING updates the flag", () => {
    expect(addReducer(placing, { type: "SET_WORKING", working: false }).working).toBe(false);
  });
  it("submit lifecycle preserves pin & working on error", () => {
    const details: AddState = {
      ...placing,
      phase: "details",
      pin: { lng: -122.3, lat: 47.6 },
      working: false,
    };
    expect(addReducer(details, { type: "SUBMIT_START" }).phase).toBe("submitting");
    expect(addReducer(details, { type: "SUBMIT_DONE", fountainId: "f1" })).toMatchObject({
      phase: "done",
      newId: "f1",
    });
    expect(addReducer(details, { type: "SUBMIT_DUPLICATE", fountainId: "d1" })).toMatchObject({
      phase: "duplicate",
      duplicateId: "d1",
    });
    const errored = addReducer(details, { type: "SUBMIT_ERROR", errorKind: "server" });
    expect(errored).toMatchObject({ phase: "error", errorKind: "server" });
    expect(errored.pin).toEqual(details.pin);
    expect(errored.working).toBe(false);
  });
});
