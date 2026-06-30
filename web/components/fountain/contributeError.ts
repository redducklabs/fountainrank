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
    default:
      return "Couldn't save — please try again.";
  }
}
