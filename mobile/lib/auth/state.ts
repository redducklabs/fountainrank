export type AuthStatus =
  | "unconfigured"
  | "initializing"
  | "signedOut"
  | "signingIn"
  | "authenticated"
  | "reauthRequired";

export type SignInOutcome =
  | { status: "success" }
  | { status: "cancelled" }
  | { status: "unconfigured" }
  | { status: "error"; error: unknown };

export class AuthSessionError extends Error {
  constructor(
    public readonly code: "token_unavailable" | "reauth_required",
    options?: ErrorOptions,
  ) {
    super(
      code === "token_unavailable" ? "Authentication token unavailable" : "Reauth required",
      options,
    );
    this.name = "AuthSessionError";
  }
}

export function isAuthSessionError(error: unknown): error is AuthSessionError {
  return error instanceof AuthSessionError;
}

export function isSignInCancel(error: unknown): boolean {
  const code = (error as { code?: unknown } | null | undefined)?.code;
  const message = (error as { message?: unknown } | null | undefined)?.message;
  return (
    code === "auth_session_failed" ||
    code === "cancel" ||
    code === "dismiss" ||
    (typeof message === "string" && /cancel|dismiss|failed to finish/i.test(message))
  );
}

export async function runSignIn(
  isConfigured: boolean,
  redirectUri: string,
  signIn: (redirectUri: string) => Promise<void>,
): Promise<SignInOutcome> {
  if (!isConfigured) {
    return { status: "unconfigured" };
  }
  try {
    await signIn(redirectUri);
    return { status: "success" };
  } catch (error) {
    return isSignInCancel(error) ? { status: "cancelled" } : { status: "error", error };
  }
}

export function resolveAuthStatus(input: {
  isConfigured: boolean;
  isInitialized: boolean;
  isAuthenticated: boolean;
  isSigningIn: boolean;
  reauthRequired: boolean;
}): AuthStatus {
  if (!input.isConfigured) return "unconfigured";
  if (input.reauthRequired) return "reauthRequired";
  if (input.isSigningIn) return "signingIn";
  if (!input.isInitialized) return "initializing";
  return input.isAuthenticated ? "authenticated" : "signedOut";
}

export function shouldEnableProfileQuery(status: AuthStatus): boolean {
  return status === "authenticated";
}

export function shouldRetryProfileQuery(error: unknown, failureCount: number): boolean {
  const status = (error as { status?: unknown } | null | undefined)?.status;
  if (isAuthSessionError(error) || status === 401) {
    return false;
  }
  return failureCount < 1;
}
