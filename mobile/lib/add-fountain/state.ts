import { ApiError } from "../api";
import { isAuthSessionError, type AuthStatus } from "../auth/state";
import { normalizeFountainId } from "../detail/id";
import { clampToBound, nudgePoint, type Bound, type LngLat } from "./placement";

export type AddFountainError = "unauthenticated" | "validation" | "network" | "server";
export type DuplicateConflict = { fountain_id?: unknown };
export type AddFountainResult =
  | { ok: true; fountainId: string }
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
  if (error instanceof TypeError) return "network";
  if (error instanceof Error) return "server";
  return "network";
}

export function duplicateFountainId(error: DuplicateConflict | undefined): string | null {
  return normalizeFountainId(
    typeof error?.fountain_id === "string" ? error.fountain_id : undefined,
  );
}

export function addFountainErrorText(error: AddFountainError): string {
  switch (error) {
    case "unauthenticated":
      return "Your session expired. Please sign in again.";
    case "validation":
      return "Please check the fountain details and try again.";
    case "network":
      return "Check your connection and try again.";
    case "server":
      return "Couldn't add the fountain. Please try again.";
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
