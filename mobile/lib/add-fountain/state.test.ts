import { describe, expect, it } from "vitest";

import { ApiError, ApiTimeoutError } from "../api";
import { AuthSessionError } from "../auth/state";
import { buildAddFountainPayload } from "./payloads";
import {
  addFountainErrorText,
  addFountainGate,
  addFountainReducer,
  classifyAddConflict,
  classifyAddSubmitFailure,
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

describe("addFountainReducer — reducer-owned bound authority (spec §6)", () => {
  const CENTER = { lng: -122.3321, lat: 47.6062 };
  const OUT_OF_BOUND = { lng: -122.3, lat: 47.6062 }; // ~2.4 km east of the 150 m circle
  const tinyCircle = { kind: "circle" as const, center: CENTER, radiusM: 1 };

  it("accepts any placement before a bound exists (the sole pre-bound exception)", () => {
    const state = addFountainReducer(initialAddFountainState, {
      type: "dropPin",
      point: OUT_OF_BOUND,
    });
    expect(state.pin).toEqual(OUT_OF_BOUND);
  });

  it("rejects an out-of-bound drop against the CURRENT bound (pin unchanged)", () => {
    let state = addFountainReducer(initialAddFountainState, { type: "setBound", bound: circle });
    state = addFountainReducer(state, { type: "dropPin", point: circle.center });
    expect(state.pin).toEqual(circle.center);
    // A drop that would replace the accepted pin with an out-of-bound point is rejected.
    state = addFountainReducer(state, { type: "dropPin", point: OUT_OF_BOUND });
    expect(state.pin).toEqual(circle.center);
  });

  it("rejects a nudge whose computed result leaves the current bound (accepted pin preserved)", () => {
    let state = addFountainReducer(initialAddFountainState, {
      type: "setBound",
      bound: tinyCircle,
    });
    state = addFountainReducer(state, { type: "dropPin", point: CENTER });
    expect(state.pin).toEqual(CENTER);
    // A 5 m nudge out of a 1 m circle is rejected; the pin stays exactly where it was accepted.
    state = addFountainReducer(state, { type: "nudge", direction: "n" });
    expect(state.pin).toEqual(CENTER);
  });

  it("keeps an already-accepted pin when the bound later MOVES to exclude it (walked-away)", () => {
    let state = addFountainReducer(initialAddFountainState, { type: "setBound", bound: circle });
    state = addFountainReducer(state, { type: "dropPin", point: circle.center });
    // The user walks away → the live bound moves far from the accepted pin.
    const movedBound = {
      kind: "circle" as const,
      center: OUT_OF_BOUND,
      radiusM: 150,
    };
    state = addFountainReducer(state, { type: "setBound", bound: movedBound });
    expect(state.pin).toEqual(circle.center); // submittable pin survives the moved bound
    // But a NEW placement is gated against the moved current bound.
    const rejected = addFountainReducer(state, { type: "dropPin", point: circle.center });
    expect(rejected.pin).toEqual(circle.center); // circle.center is now out of movedBound → unchanged
  });

  it("accepts an in-bound drop against the current bound", () => {
    let state = addFountainReducer(initialAddFountainState, { type: "setBound", bound: circle });
    state = addFountainReducer(state, { type: "dropPin", point: circle.center });
    // A nudge that stays inside the 150 m circle is accepted.
    state = addFountainReducer(state, { type: "nudge", direction: "n" });
    expect(state.pin!.lat).toBeGreaterThan(circle.center.lat);
  });
});

describe("mapAddFountainError", () => {
  it("maps auth and status errors", () => {
    expect(mapAddFountainError(new AuthSessionError("token_unavailable"))).toBe("unauthenticated");
    expect(mapAddFountainError(new ApiError(401))).toBe("unauthenticated");
    expect(mapAddFountainError(new ApiError(422))).toBe("validation");
    expect(mapAddFountainError(new ApiError(500))).toBe("server");
  });

  it("classifies both a request timeout and a mid-flight network drop as outcome-unknown 'timeout'", () => {
    // The create may still have committed server-side, so both recover by reconciliation
    // (unchanged retry → 409 → route to the created fountain), not a plain network retry.
    expect(mapAddFountainError(new ApiTimeoutError("POST", "/api/v1/fountains", 30_000))).toBe(
      "timeout",
    );
    expect(mapAddFountainError(new TypeError("Network request failed"))).toBe("timeout");
  });

  it("maps a non-network internal Error to server", () => {
    expect(mapAddFountainError(new Error("missing location"))).toBe("server");
  });
});

describe("classifyAddSubmitFailure", () => {
  it("ApiTimeoutError → 'timeout' + a deadline descriptor carrying timeout_ms", () => {
    expect(
      classifyAddSubmitFailure(new ApiTimeoutError("POST", "/api/v1/fountains", 30_000)),
    ).toEqual({ error: "timeout", outcome: { reason: "deadline", timeout_ms: 30_000 } });
  });

  it("mid-flight TypeError → 'timeout' + a network_failure descriptor with NO timeout_ms", () => {
    const result = classifyAddSubmitFailure(new TypeError("Network request failed"));
    expect(result).toEqual({ error: "timeout", outcome: { reason: "network_failure" } });
    expect(result.outcome && "timeout_ms" in result.outcome).toBe(false);
  });

  it("other errors keep their existing mapping and carry NO descriptor", () => {
    expect(classifyAddSubmitFailure(new ApiError(500))).toEqual({ error: "server" });
    expect(classifyAddSubmitFailure(new ApiError(422))).toEqual({ error: "validation" });
    expect(classifyAddSubmitFailure(new ApiError(401))).toEqual({ error: "unauthenticated" });
    expect(classifyAddSubmitFailure(new AuthSessionError("token_unavailable"))).toEqual({
      error: "unauthenticated",
    });
  });
});

describe("addFountainReducer — outcome-unknown timeout preserves the draft for reconciliation", () => {
  it("submitError('timeout') → error phase with pin + isWorking preserved", () => {
    let state = addFountainReducer(initialAddFountainState, { type: "setBound", bound: circle });
    state = addFountainReducer(state, { type: "dropPin", point: circle.center });
    state = addFountainReducer(state, { type: "next" });
    state = addFountainReducer(state, { type: "setWorking", isWorking: false });
    state = addFountainReducer(state, { type: "submitStart" });
    const pinBefore = state.pin;
    state = addFountainReducer(state, { type: "submitError", error: "timeout" });
    expect(state.phase).toBe("error");
    expect(state.error).toBe("timeout");
    // Unchanged pin is the whole point: an unchanged retry posts identical coordinates.
    expect(state.pin).toEqual(pinBefore);
    expect(state.isWorking).toBe(false);
  });

  it("submitStart transitions the error state back to submitting (the retry), draft intact", () => {
    let state = addFountainReducer(initialAddFountainState, { type: "setBound", bound: circle });
    state = addFountainReducer(state, { type: "dropPin", point: circle.center });
    state = addFountainReducer(state, { type: "next" });
    state = addFountainReducer(state, { type: "submitError", error: "timeout" });
    expect(state.phase).toBe("error");
    state = addFountainReducer(state, { type: "submitStart" });
    expect(state.phase).toBe("submitting");
    expect(state.error).toBeNull();
    expect(state.pin).toEqual(circle.center);
  });
});

describe("add-flow retry posts an identical body (reconciliation, spec §2)", () => {
  it("buildAddFountainPayload is deterministic for an unchanged draft — exact lat/lng, deep-equal", () => {
    // The submit-path draft (pin + is_working + comments + ratings + observations) is
    // preserved across a timeout (reducer test above; the screen keeps the rest in useState
    // and the catch branch never resets it), so the retry rebuilds a byte-identical body.
    const draft = {
      location: { latitude: 47.6062, longitude: -122.3321 },
      is_working: true,
      comments: "cold and clean",
      ratings: [{ rating_type_id: 1, stars: 5 }],
      observations: [{ attribute_type_id: 2, value: "yes" }],
    };
    const first = buildAddFountainPayload(draft);
    const retry = buildAddFountainPayload(draft);
    expect(retry).toEqual(first);
    expect(first.ok && first.value.location).toEqual({ latitude: 47.6062, longitude: -122.3321 });
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

  it("the timeout copy states the outcome-unknown ambiguity and the reconciliation retry", () => {
    const copy = addFountainErrorText("timeout");
    expect(copy).toMatch(/couldn't confirm/i);
    expect(copy).toMatch(/try again/i);
    expect(copy).toMatch(/take you to it/i);
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
