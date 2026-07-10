import { useQueryClient } from "@tanstack/react-query";
import { LogtoProvider, useLogto } from "@logto/rn";
import * as WebBrowser from "expo-web-browser";
import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";

import { nativeAuthConfig } from "../lib/auth/config";
import { endSessionUrl } from "../lib/auth/logout";
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

/** Resolve Logto's RP-initiated logout endpoint from OIDC discovery, falling back to the
 *  conventional path. Network I/O, so it lives here (not in the pure logout.ts). Never throws:
 *  any failure resolves to the fallback so sign-out is never blocked by discovery (#6). */
async function discoverEndSessionEndpoint(logtoEndpoint: string): Promise<string> {
  const base = logtoEndpoint.replace(/\/$/, "");
  const fallback = `${base}/oidc/session/end`;
  try {
    const res = await fetch(`${base}/oidc/.well-known/openid-configuration`);
    if (!res.ok) return fallback;
    const json = (await res.json()) as { end_session_endpoint?: unknown };
    return typeof json.end_session_endpoint === "string" ? json.end_session_endpoint : fallback;
  } catch {
    return fallback;
  }
}

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
        logtoEndpoint={config.logtoEndpoint}
        clientId={authConfig.logtoConfig.appId}
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
  logtoEndpoint,
  clientId,
  children,
}: {
  redirectUri: string;
  audience: string;
  apiBaseUrl: string;
  logtoEndpoint: string;
  clientId: string;
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
    // 1) Clear the LOCAL session first (revokes the refresh token + wipes secure storage). This must
    //    not depend on any network step below — local sign-out has to be durable (#6).
    await logto.signOut();
    // 2) Best-effort RP-initiated logout to end the Logto IdP session — the step @logto/rn's signOut
    //    skips. Without it the Logto session cookie survives and the next sign-in silently reuses it.
    //    prompt=login (see lib/auth/config.ts) is the safety net if this fails. Every failure mode
    //    (discovery, browser reject when the post-logout URI isn't registered yet) is swallowed so a
    //    failed provider logout never makes sign-out appear to fail or leave the UI authenticated.
    try {
      const endpoint = await discoverEndSessionEndpoint(logtoEndpoint);
      const url = endSessionUrl({
        endSessionEndpoint: endpoint,
        clientId,
        postLogoutRedirectUri: redirectUri,
      });
      await WebBrowser.openAuthSessionAsync(url, redirectUri);
      console.info("[auth] sign-out: provider session ended");
    } catch (error) {
      // Named so the "locally signed out; provider session may remain" state is diagnosable from
      // logs. No tokens, no claims — just the failure name.
      console.warn("[auth] sign-out: end-session failed", (error as Error)?.name);
    }
  }, [logto, logtoEndpoint, clientId, redirectUri]);

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
