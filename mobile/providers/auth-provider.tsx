import { LogtoProvider, useLogto } from "@logto/rn";
import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";

import { nativeAuthConfig } from "../lib/auth/config";
import { syncProfileOnSignIn } from "../lib/auth/sync";
import {
  AuthSessionError,
  resolveAuthStatus,
  runSignIn,
  type AuthStatus,
  type SignInOutcome,
} from "../lib/auth/state";
import type { MobileConfig } from "../lib/config";

type AuthContextValue = {
  status: AuthStatus;
  isConfigured: boolean;
  isAuthenticated: boolean;
  signIn: () => Promise<SignInOutcome>;
  signOut: () => Promise<void>;
  markReauthRequired: () => void;
  getBackendAccessToken: () => Promise<string | null>;
};

const AuthContext = createContext<AuthContextValue | null>(null);

function unconfiguredAuthValue(): AuthContextValue {
  return {
    status: "unconfigured",
    isConfigured: false,
    isAuthenticated: false,
    signIn: async () => ({ status: "unconfigured" }),
    signOut: async () => undefined,
    markReauthRequired: () => undefined,
    getBackendAccessToken: async () => null,
  };
}

export function AuthProvider({ config, children }: { config: MobileConfig; children: ReactNode }) {
  const authConfig = nativeAuthConfig(config);
  if (authConfig.state === "unconfigured") {
    return <AuthContext.Provider value={unconfiguredAuthValue()}>{children}</AuthContext.Provider>;
  }
  return (
    <LogtoProvider config={authConfig.logtoConfig}>
      <ConfiguredAuthProvider
        redirectUri={authConfig.redirectUri}
        audience={config.logtoAudience}
        apiBaseUrl={config.apiBaseUrl}
      >
        {children}
      </ConfiguredAuthProvider>
    </LogtoProvider>
  );
}

function ConfiguredAuthProvider({
  redirectUri,
  audience,
  apiBaseUrl,
  children,
}: {
  redirectUri: string;
  audience: string;
  apiBaseUrl: string;
  children: ReactNode;
}) {
  const logto = useLogto();
  const [isSigningIn, setIsSigningIn] = useState(false);
  const [reauthRequired, setReauthRequired] = useState(false);

  const status = resolveAuthStatus({
    isConfigured: true,
    isInitialized: logto.isInitialized,
    isAuthenticated: logto.isAuthenticated,
    isSigningIn,
    reauthRequired,
  });

  const syncAfterSignIn = useCallback(async (): Promise<void> => {
    // Best-effort profile sync (#103). Fetch the resource JWT and the opaque
    // userinfo token, then POST /me/sync so the backend writes the real
    // display_name/email/avatar. Runs while status is still "signingIn", so the
    // /me query (enabled only on "authenticated") first reads the corrected name.
    // A token-fetch failure here must never disrupt an otherwise successful sign-in.
    let resourceToken: string | null = null;
    let userinfoToken: string | null = null;
    try {
      resourceToken = await logto.getAccessToken(audience);
      userinfoToken = await logto.getAccessToken();
    } catch {
      return;
    }
    await syncProfileOnSignIn({ apiBaseUrl, resourceToken, userinfoToken });
  }, [apiBaseUrl, audience, logto]);

  const signIn = useCallback(async (): Promise<SignInOutcome> => {
    setReauthRequired(false);
    setIsSigningIn(true);
    try {
      const outcome = await runSignIn(true, redirectUri, logto.signIn);
      if (outcome.status === "success") {
        await syncAfterSignIn();
      }
      return outcome;
    } finally {
      setIsSigningIn(false);
    }
  }, [logto.signIn, redirectUri, syncAfterSignIn]);

  const signOut = useCallback(async () => {
    setReauthRequired(false);
    await logto.signOut();
  }, [logto]);

  const getBackendAccessToken = useCallback(async () => {
    if (!logto.isAuthenticated || reauthRequired) {
      return null;
    }
    try {
      return await logto.getAccessToken(audience);
    } catch (error) {
      setReauthRequired(true);
      throw new AuthSessionError("token_unavailable", { cause: error });
    }
  }, [audience, logto, reauthRequired]);

  const value = useMemo<AuthContextValue>(
    () => ({
      status,
      isConfigured: true,
      isAuthenticated: status === "authenticated",
      signIn,
      signOut,
      markReauthRequired: () => setReauthRequired(true),
      getBackendAccessToken,
    }),
    [getBackendAccessToken, signIn, signOut, status],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error("useAuth must be used within an AuthProvider");
  }
  return ctx;
}
