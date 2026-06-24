import type { components } from "@fountainrank/api-client";

import { ApiError } from "../api";
import { isAuthSessionError, type AuthStatus } from "../auth/state";

type ConditionStatus = components["schemas"]["ConditionReportRequest"]["status"];

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

const CONDITION_LABELS: Record<ConditionStatus, string> = {
  working: "It's working",
  broken: "Broken / not working",
  low_pressure: "Low water pressure",
  dirty: "Dirty",
  bad_taste: "Bad taste",
  blocked: "Blocked / clogged",
  seasonal_unavailable: "Shut off for the season",
  hours_limited: "Only available certain hours",
};

export function conditionStatusLabel(status: ConditionStatus): string {
  return CONDITION_LABELS[status];
}

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
