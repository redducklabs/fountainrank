import { ApiError, ApiTimeoutError } from "../api";
import { isAuthSessionError, type AuthStatus } from "../auth/state";
import { normalizeFountainId } from "../detail/id";
import { clampToBound, nudgePoint, type Bound, type LngLat } from "./placement";
import type { AwardedPoints } from "@fountainrank/contributions";

export type AddFountainError =
  "unauthenticated" | "validation" | "needs_name" | "network" | "server" | "timeout";
export type DuplicateConflict = { fountain_id?: unknown };
export type AddFountainResult =
  // pointsAwarded (#204): the SERVER's award, which includes the conditional first_fountain /
  // first_in_area bonuses the client cannot predict. The add flow used to celebrate its own
  // client-side preview total instead.
  | { ok: true; fountainId: string; pointsAwarded: AwardedPoints }
  | { ok: false; error: "duplicate"; fountainId: string }
  | { ok: false; error: AddFountainError };

export type AddPhase = "placing" | "details" | "submitting" | "created" | "duplicate" | "error";

export type AddFountainState = {
  phase: AddPhase;
  bound: Bound | null;
  pin: LngLat | null;
  isWorking: boolean;
  createdId: string | null;
  duplicateId: string | null;
  error: AddFountainError | null;
};

export const initialAddFountainState: AddFountainState = {
  phase: "placing",
  bound: null,
  pin: null,
  isWorking: true,
  createdId: null,
  duplicateId: null,
  error: null,
};

export type AddFountainAction =
  | { type: "reset" }
  | { type: "setBound"; bound: Bound }
  | { type: "dropPin"; point: LngLat }
  | { type: "nudge"; direction: "n" | "s" | "e" | "w" }
  | { type: "next" }
  | { type: "back" }
  | { type: "setWorking"; isWorking: boolean }
  | { type: "submitStart" }
  | { type: "created"; fountainId: string }
  | { type: "duplicate"; fountainId: string }
  | { type: "submitError"; error: AddFountainError };

export function addFountainReducer(
  state: AddFountainState,
  action: AddFountainAction,
): AddFountainState {
  switch (action.type) {
    case "reset":
      return initialAddFountainState;
    case "setBound":
      return { ...state, bound: action.bound };
    case "dropPin":
      return {
        ...state,
        pin: state.bound ? clampToBound(action.point, state.bound) : action.point,
      };
    case "nudge": {
      if (!state.pin) return state;
      const next = nudgePoint(state.pin, action.direction);
      return { ...state, pin: state.bound ? clampToBound(next, state.bound) : next };
    }
    case "next":
      return state.pin && state.phase === "placing" ? { ...state, phase: "details" } : state;
    case "back":
      return state.phase === "details" || state.phase === "error"
        ? { ...state, phase: "placing" }
        : state;
    case "setWorking":
      return { ...state, isWorking: action.isWorking };
    case "submitStart":
      return { ...state, phase: "submitting", error: null };
    case "created":
      return { ...state, phase: "created", createdId: action.fountainId };
    case "duplicate":
      return { ...state, phase: "duplicate", duplicateId: action.fountainId };
    case "submitError":
      return { ...state, phase: "error", error: action.error };
  }
}

export function mapAddFountainError(error: unknown): AddFountainError {
  if (isAuthSessionError(error)) return "unauthenticated";
  if (error instanceof ApiError) {
    if (error.status === 401) return "unauthenticated";
    if (error.status === 422) return "validation";
    return "server";
  }
  // A create that timed out (ApiTimeoutError) OR dropped mid-flight (TypeError) is
  // OUTCOME-UNKNOWN — the server may already have committed it. Both classify as
  // "timeout" so the flow recovers by reconciliation (unchanged retry → 409 → route to
  // the created fountain), not by treating it as a definitive failure (spec §2).
  if (error instanceof ApiTimeoutError) return "timeout";
  if (error instanceof TypeError) return "timeout";
  if (error instanceof Error) return "server";
  return "network";
}

/**
 * The outcome-unknown diagnostic descriptor (spec §2). Carries ONLY the ambiguity reason
 * (and, for a deadline, its duration) — never the raw error message (RN network errors can
 * embed URLs) and never coordinates. Feeds the `add_fountain_outcome_unknown` log event.
 */
export type AddSubmitOutcomeEvent =
  { reason: "deadline"; timeout_ms: number } | { reason: "network_failure" };

export type AddSubmitFailure = {
  error: AddFountainError;
  /** Present only for the two outcome-unknown branches (timeout / mid-flight network drop). */
  outcome?: AddSubmitOutcomeEvent;
};

/**
 * Pure classification of an add-create failure (spec §2): the mapped `AddFountainError`
 * plus, for the two OUTCOME-UNKNOWN branches, a diagnostic descriptor for the
 * `add_fountain_outcome_unknown` event. Kept pure and node-safe so the submit-path decision
 * is testable without rendering the screen; the catch branch calls this and forwards any
 * descriptor to the log seam.
 */
export function classifyAddSubmitFailure(error: unknown): AddSubmitFailure {
  const mapped = mapAddFountainError(error);
  if (error instanceof ApiTimeoutError) {
    return { error: mapped, outcome: { reason: "deadline", timeout_ms: error.timeoutMs } };
  }
  if (error instanceof TypeError) {
    return { error: mapped, outcome: { reason: "network_failure" } };
  }
  return { error: mapped };
}

export function duplicateFountainId(error: DuplicateConflict | undefined): string | null {
  return normalizeFountainId(
    typeof error?.fountain_id === "string" ? error.fountain_id : undefined,
  );
}

// add_fountain has TWO 409 shapes: the name gate (detail === "display_name_required") and the
// duplicate-proximity conflict (carries a fountain_id). Branch on the typed openapi-fetch error body.
export function classifyAddConflict(
  errorBody: unknown,
): { kind: "needs_name" } | { kind: "duplicate"; fountainId: string } | { kind: "server" } {
  if ((errorBody as { detail?: unknown })?.detail === "display_name_required") {
    return { kind: "needs_name" };
  }
  const fountainId = duplicateFountainId(errorBody as DuplicateConflict | undefined);
  return fountainId ? { kind: "duplicate", fountainId } : { kind: "server" };
}

export function addFountainErrorText(error: AddFountainError): string {
  switch (error) {
    case "unauthenticated":
      return "Your session expired. Please sign in again.";
    case "validation":
      return "Please check the fountain details and try again.";
    case "needs_name":
      return "Add a display name on the Profile tab to contribute.";
    case "network":
      return "Check your connection and try again.";
    case "server":
      return "Couldn't add the fountain. Please try again.";
    case "timeout":
      // Outcome-unknown: state the ambiguity AND the reconciliation. An unchanged retry
      // posts identical coordinates; if the first attempt already committed, the backend
      // returns the typed 409 and the flow routes the user to that fountain (spec §2).
      return "We couldn't confirm your fountain was saved. Leave the pin where it is and try again — if it was already saved, we'll take you to it.";
  }
}

export type AddFountainGate =
  | { state: "ready" }
  | { state: "unavailable"; message: string }
  | { state: "pending"; message: string }
  | { state: "sign_in"; message: string }
  | { state: "reauth"; message: string };

export function addFountainGate(status: AuthStatus): AddFountainGate {
  switch (status) {
    case "authenticated":
      return { state: "ready" };
    case "unconfigured":
      return { state: "unavailable", message: "Sign-in is not available in this build." };
    case "initializing":
      return { state: "pending", message: "Checking account..." };
    case "signingIn":
      return { state: "pending", message: "Opening sign-in..." };
    case "reauthRequired":
      return { state: "reauth", message: "Your session expired. Sign in again to add a fountain." };
    case "signedOut":
      return { state: "sign_in", message: "Sign in to add a fountain." };
  }
}
