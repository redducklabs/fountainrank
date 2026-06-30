import { describe, expect, it } from "vitest";

import { ApiError } from "../api";
import { AuthSessionError } from "../auth/state";
import {
  addFountainErrorText,
  addFountainGate,
  addFountainReducer,
  classifyAddConflict,
  duplicateFountainId,
  initialAddFountainState,
  mapAddFountainError,
} from "./state";

const UUID = "123e4567-e89b-12d3-a456-426614174000";
const circle = { kind: "circle" as const, center: { lng: -122.3321, lat: 47.6062 }, radiusM: 150 };

describe("addFountainReducer", () => {
  it("drops, nudges, advances, and preserves state on errors", () => {
    let state = addFountainReducer(initialAddFountainState, { type: "setBound", bound: circle });
    state = addFountainReducer(state, { type: "dropPin", point: circle.center });
    expect(state.pin).toEqual(circle.center);

    state = addFountainReducer(state, { type: "nudge", direction: "n" });
    expect(state.pin!.lat).toBeGreaterThan(circle.center.lat);

    state = addFountainReducer(state, { type: "next" });
    expect(state.phase).toBe("details");
    state = addFountainReducer(state, { type: "setWorking", isWorking: false });
    state = addFountainReducer(state, { type: "submitStart" });
    expect(state.phase).toBe("submitting");
    state = addFountainReducer(state, { type: "submitError", error: "server" });
    expect(state.phase).toBe("error");
    expect(state.error).toBe("server");
    expect(state.pin).not.toBeNull();
    expect(state.isWorking).toBe(false);

    state = addFountainReducer(state, { type: "back" });
    expect(state.phase).toBe("placing");
  });

  it("stores duplicate id before the route action can use it", () => {
    const state = addFountainReducer(initialAddFountainState, {
      type: "duplicate",
      fountainId: UUID,
    });
    expect(state.phase).toBe("duplicate");
    expect(state.duplicateId).toBe(UUID);
  });
});

describe("mapAddFountainError", () => {
  it("maps auth and status errors", () => {
    expect(mapAddFountainError(new AuthSessionError("token_unavailable"))).toBe("unauthenticated");
    expect(mapAddFountainError(new ApiError(401))).toBe("unauthenticated");
    expect(mapAddFountainError(new ApiError(422))).toBe("validation");
    expect(mapAddFountainError(new ApiError(500))).toBe("server");
  });

  it("distinguishes network from internal errors", () => {
    expect(mapAddFountainError(new TypeError("Network request failed"))).toBe("network");
    expect(mapAddFountainError(new Error("missing location"))).toBe("server");
  });
});

describe("duplicateFountainId", () => {
  it("returns a valid duplicate id and rejects malformed bodies", () => {
    expect(duplicateFountainId({ fountain_id: UUID })).toBe(UUID);
    expect(duplicateFountainId({ fountain_id: "not-a-uuid" })).toBeNull();
    expect(duplicateFountainId({})).toBeNull();
    expect(duplicateFountainId(undefined)).toBeNull();
  });
});

describe("classifyAddConflict", () => {
  it("classifies a display_name_required 409 body as needs_name", () => {
    expect(classifyAddConflict({ detail: "display_name_required" })).toEqual({
      kind: "needs_name",
    });
  });
  it("classifies a duplicate 409 body (valid fountain_id)", () => {
    expect(classifyAddConflict({ fountain_id: UUID })).toEqual({
      kind: "duplicate",
      fountainId: UUID,
    });
  });
  it("classifies an unrecognized / malformed 409 body as server", () => {
    expect(classifyAddConflict({})).toEqual({ kind: "server" });
    expect(classifyAddConflict({ fountain_id: "not-a-uuid" })).toEqual({ kind: "server" });
    expect(classifyAddConflict(undefined)).toEqual({ kind: "server" });
  });
});

describe("addFountainErrorText", () => {
  it("has user-facing copy for every error", () => {
    expect(addFountainErrorText("unauthenticated")).toMatch(/sign in/i);
    expect(addFountainErrorText("validation")).toMatch(/check/i);
    expect(addFountainErrorText("needs_name")).toMatch(/display name/i);
    expect(addFountainErrorText("network")).toMatch(/connection/i);
    expect(addFountainErrorText("server")).toMatch(/try again/i);
  });
});

describe("addFountainGate", () => {
  it("allows writes only when authenticated", () => {
    expect(addFountainGate("authenticated")).toEqual({ state: "ready" });
    expect(addFountainGate("unconfigured").state).toBe("unavailable");
    expect(addFountainGate("initializing").state).toBe("pending");
    expect(addFountainGate("signedOut").state).toBe("sign_in");
    expect(addFountainGate("signingIn").state).toBe("pending");
    expect(addFountainGate("reauthRequired").state).toBe("reauth");
  });
});
