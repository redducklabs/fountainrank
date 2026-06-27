import { useQueryClient } from "@tanstack/react-query";
import { LogtoProvider, useLogto } from "@logto/rn";
import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";

import { nativeAuthConfig } from "../lib/auth/config";
import { syncProfileOnSignIn, type ProfileSyncResult } from "../lib/auth/sync";
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
  const queryClient = useQueryClient();
  const [isSigningIn, setIsSigningIn] = useState(false);
  const [reauthRequired, setReauthRequired] = useState(false);

  const status = resolveAuthStatus({
    isConfigured: true,
    isInitialized: logto.isInitialized,
    isAuthenticated: logto.isAuthenticated,
    isSigningIn,
    reauthRequired,
  });

  const syncAfterSignIn = useCallback(async (): Promise<ProfileSyncResult> => {
    // Best-effort profile sync (#103). Fetch the resource JWT and the opaque
    // userinfo token, then POST /me/sync so the backend writes the real
    // display_name/email/avatar. A token-fetch failure is swallowed (skip the sync)
    // — it must never disrupt an otherwise successful sign-in.
    let resourceToken: string | null = null;
    let userinfoToken: string | null = null;
    try {
      resourceToken = await logto.getAccessToken(audience);
      userinfoToken = await logto.getAccessToken();
    } catch {
      return "skipped";
    }
    return syncProfileOnSignIn({ apiBaseUrl, resourceToken, userinfoToken });
  }, [apiBaseUrl, audience, logto]);

  const signIn = useCallback(async (): Promise<SignInOutcome> => {
    setReauthRequired(false);
    setIsSigningIn(true);
    try {
      const outcome = await runSignIn(true, redirectUri, logto.signIn);
      if (outcome.status === "success") {
        // Fire-and-forget so the sync NEVER blocks sign-in completion (#103). The
        // /me query enables as soon as status flips to "authenticated" (it may first
        // read the backend first-seen `sub`); once the sync writes the real profile
        // we invalidate ["me"] so the profile + points refetch with the real values.
        void syncAfterSignIn().then((result) => {
          if (result === "synced") {
            void queryClient.invalidateQueries({ queryKey: ["me"] });
          }
        });
      }
      return outcome;
    } finally {
      setIsSigningIn(false);
    }
  }, [logto.signIn, queryClient, redirectUri, syncAfterSignIn]);

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
