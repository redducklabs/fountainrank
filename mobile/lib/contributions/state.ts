import { ApiError, ApiTimeoutError } from "../api";
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
  | "needs_name"
  | "network"
  | "server"
  // Rating-only: 403 outside_rating_radius — the client's location is >50 mi from the fountain (#3).
  | "too_far"
  // Photo-upload-only conflict: `photo_limit_fountain`/`photo_limit_user` (distinct from the
  // shared `needs_name` 409 gate) — see `mapPhotoUploadError` in `lib/detail/photo-upload.ts`.
  | "photo_limit"
  | "rate_limited"
  // Photo-upload-only: 413 (too large) / 415 (unsupported type) — a client-input problem, but
  // distinct from `validation` (422) so the UI can show file-specific guidance.
  | "file_invalid";

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
    if (error.status === 403) return "too_far"; // rating outside the 50 mi radius (#3)
    if (error.status === 404) return "not_found";
    if (error.status === 422) return "validation";
    // These detail writes have only ONE 409 shape — the name gate (require_named_user).
    if (error.status === 409) return "needs_name";
    if (error.status === 429) return "rate_limited";
    return "server";
  }
  // A timed-out contribution write maps to the network bucket (existing retry copy):
  // rating/condition/note writes are UPSERTs server-side, so an unchanged retry is safe
  // and non-duplicating — no reconciliation branch is needed here (spec §2).
  if (error instanceof ApiTimeoutError) {
    return "network";
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
    case "needs_name":
      return "Add a display name on the Profile tab to contribute.";
    case "too_far":
      return "You need to be within 50 mi of this fountain to rate it.";
    case "network":
      return "Check your connection and try again.";
    case "server":
      return "Couldn't save. Please try again.";
    case "photo_limit":
      return "This fountain (or your uploads here) has reached the photo limit.";
    case "rate_limited":
      return "You're doing that a lot — please wait a bit and try again.";
    case "file_invalid":
      return "That file isn't a supported photo (JPEG, PNG, or WebP, up to 10 MB).";
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
