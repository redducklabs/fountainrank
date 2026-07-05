import type { ContributeError } from "../../app/actions/contribute";

export function errorText(e: ContributeError): string {
  switch (e) {
    case "unauthenticated":
      return "Your session expired — please sign in again.";
    case "not_found":
      return "This fountain is no longer available.";
    case "validation":
      return "Please check your input and try again.";
    case "needs_name":
      return "Add a display name on your account before contributing.";
    case "photo_limit":
      return "This fountain (or your uploads here) has reached the photo limit.";
    case "rate_limited":
      return "You're doing that a lot — please wait a bit and try again.";
    case "file_invalid":
      return "That file isn't a supported photo (JPEG, PNG, or WebP, up to 10 MB).";
    default:
      return "Couldn't save — please try again.";
  }
}
