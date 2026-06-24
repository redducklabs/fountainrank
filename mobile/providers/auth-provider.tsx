import { LogtoProvider, useLogto } from "@logto/rn";
import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";

import { nativeAuthConfig } from "../lib/auth/config";
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
      <ConfiguredAuthProvider redirectUri={authConfig.redirectUri} audience={config.logtoAudience}>
        {children}
      </ConfiguredAuthProvider>
    </LogtoProvider>
  );
}

function ConfiguredAuthProvider({
  redirectUri,
  audience,
  children,
}: {
  redirectUri: string;
  audience: string;
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

  const signIn = useCallback(async (): Promise<SignInOutcome> => {
    setReauthRequired(false);
    setIsSigningIn(true);
    try {
      return await runSignIn(true, redirectUri, logto.signIn);
    } finally {
      setIsSigningIn(false);
    }
  }, [logto.signIn, redirectUri]);

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
