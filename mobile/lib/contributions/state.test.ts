import { describe, expect, it } from "vitest";

import { ApiError } from "../api";
import { AuthSessionError } from "../auth/state";
import {
  CONDITION_STATUSES,
  contributionErrorText,
  contributionGate,
  conditionStatusLabel,
  mapContributionError,
  PROBLEM_CONDITION_STATUSES,
} from "./state";

describe("conditionStatusLabel", () => {
  it("labels every deployed condition status", () => {
    expect(CONDITION_STATUSES).toEqual([
      "working",
      "broken",
      "low_pressure",
      "dirty",
      "bad_taste",
      "blocked",
      "seasonal_unavailable",
      "hours_limited",
    ]);
    expect(PROBLEM_CONDITION_STATUSES).toEqual([
      "broken",
      "low_pressure",
      "dirty",
      "bad_taste",
      "blocked",
      "seasonal_unavailable",
      "hours_limited",
    ]);
    expect(conditionStatusLabel("working")).toBe("It's working");
    expect(conditionStatusLabel("broken")).toBe("Broken / not working");
    expect(conditionStatusLabel("low_pressure")).toBe("Low water pressure");
    expect(conditionStatusLabel("dirty")).toBe("Dirty");
    expect(conditionStatusLabel("bad_taste")).toBe("Bad taste");
    expect(conditionStatusLabel("blocked")).toBe("Blocked / clogged");
    expect(conditionStatusLabel("seasonal_unavailable")).toBe("Shut off for the season");
    expect(conditionStatusLabel("hours_limited")).toBe("Only available certain hours");
  });
});

describe("mapContributionError", () => {
  it("maps auth/session failures to reauth", () => {
    expect(mapContributionError(new ApiError(401))).toBe("unauthenticated");
    expect(mapContributionError(new AuthSessionError("token_unavailable"))).toBe("unauthenticated");
  });

  it("maps HTTP statuses to stable errors", () => {
    expect(mapContributionError(new ApiError(404))).toBe("not_found");
    expect(mapContributionError(new ApiError(422))).toBe("validation");
    expect(mapContributionError(new ApiError(409))).toBe("needs_name");
    expect(mapContributionError(new ApiError(503))).toBe("server");
  });

  it("maps non-HTTP failures to network", () => {
    expect(mapContributionError(new TypeError("Network request failed"))).toBe("network");
  });

  it("does not label internal errors as connectivity problems", () => {
    expect(mapContributionError(new Error("missing fountain id"))).toBe("server");
  });
});

describe("contributionErrorText", () => {
  it("returns user-facing copy for every error kind", () => {
    expect(contributionErrorText("unauthenticated")).toMatch(/sign in/i);
    expect(contributionErrorText("not_found")).toMatch(/no longer/i);
    expect(contributionErrorText("validation")).toMatch(/check/i);
    expect(contributionErrorText("needs_name")).toMatch(/display name/i);
    expect(contributionErrorText("network")).toMatch(/connection/i);
    expect(contributionErrorText("server")).toMatch(/try again/i);
  });
});

describe("contributionGate", () => {
  it("allows writes only when authenticated", () => {
    expect(contributionGate("authenticated")).toEqual({ state: "ready" });
  });

  it("keeps auth-unavailable and transient states non-submittable", () => {
    expect(contributionGate("unconfigured").state).toBe("unavailable");
    expect(contributionGate("initializing").state).toBe("pending");
    expect(contributionGate("signingIn").state).toBe("pending");
    expect(contributionGate("signedOut").state).toBe("sign_in");
    expect(contributionGate("reauthRequired").state).toBe("reauth");
  });
});
