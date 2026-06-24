import { isAuthSessionError } from "./auth/state";

export type ViewState = "loading" | "offline" | "error" | "empty" | "ready";

export type ViewStateInput = {
  isLoading: boolean;
  isError: boolean;
  error?: unknown;
  isEmpty?: boolean;
};

/**
 * Map a TanStack-Query-style result into a discrete UI state. An error that
 * carries a numeric HTTP `status` (an ApiError) is a server-side "error";
 * auth/session errors are also app errors; other errors without a status are
 * network "offline" failures.
 */
export function resolveViewState(input: ViewStateInput): ViewState {
  if (input.isLoading) return "loading";
  if (input.isError) {
    if (isAuthSessionError(input.error)) {
      return "error";
    }
    const status = (input.error as { status?: unknown } | null | undefined)?.status;
    return typeof status === "number" ? "error" : "offline";
  }
  if (input.isEmpty) return "empty";
  return "ready";
}
