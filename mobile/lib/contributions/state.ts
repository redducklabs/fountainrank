import { ApiError } from "../api";
import { isAuthSessionError, type AuthStatus } from "../auth/state";
export {
  CONDITION_STATUSES,
  conditionStatusLabel,
  isConditionStatus,
  PROBLEM_CONDITION_STATUSES,
} from "./conditions";

export type ContributionError =
  | "unauthenticated"
  | "validation"
  | "not_found"
  | "network"
  | "server";

export type ContributionGate =
  | { state: "ready" }
  | { state: "unavailable"; message: string }
  | { state: "pending"; message: string }
  | { state: "sign_in"; message: string }
  | { state: "reauth"; message: string };

export function mapContributionError(error: unknown): ContributionError {
  if (isAuthSessionError(error)) {
    return "unauthenticated";
  }
  if (error instanceof ApiError) {
    if (error.status === 401) return "unauthenticated";
    if (error.status === 404) return "not_found";
    if (error.status === 422) return "validation";
    return "server";
  }
  if (error instanceof TypeError) {
    return "network";
  }
  if (error instanceof Error) {
    return "server";
  }
  return "network";
}

export function contributionErrorText(error: ContributionError): string {
  switch (error) {
    case "unauthenticated":
      return "Your session expired. Please sign in again.";
    case "not_found":
      return "This fountain is no longer available.";
    case "validation":
      return "Please check your input and try again.";
    case "network":
      return "Check your connection and try again.";
    case "server":
      return "Couldn't save. Please try again.";
  }
}

export function contributionGate(status: AuthStatus): ContributionGate {
  switch (status) {
    case "authenticated":
      return { state: "ready" };
    case "unconfigured":
      return {
        state: "unavailable",
        message: "Sign-in is not available in this build.",
      };
    case "initializing":
      return { state: "pending", message: "Checking account..." };
    case "signingIn":
      return { state: "pending", message: "Opening sign-in..." };
    case "reauthRequired":
      return {
        state: "reauth",
        message: "Your session expired. Sign in again to contribute.",
      };
    case "signedOut":
      return {
        state: "sign_in",
        message: "Sign in to rate this fountain, report its status, or add a note.",
      };
  }
}
