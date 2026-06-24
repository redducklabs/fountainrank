import { createContext, useContext, useMemo, type ReactNode } from "react";

import { createApiClient, type MobileApiClient } from "../lib/api";
import type { MobileConfig } from "../lib/config";
import { useAuth } from "./auth-provider";

type ApiContextValue = { config: MobileConfig; client: MobileApiClient };

const ApiContext = createContext<ApiContextValue | null>(null);

export function ApiProvider({ config, children }: { config: MobileConfig; children: ReactNode }) {
  const auth = useAuth();
  const value = useMemo<ApiContextValue>(
    () => ({
      config,
      client: createApiClient(config.apiBaseUrl, { getAccessToken: auth.getBackendAccessToken }),
    }),
    [auth.getBackendAccessToken, config],
  );
  return <ApiContext.Provider value={value}>{children}</ApiContext.Provider>;
}

export function useApi(): ApiContextValue {
  const ctx = useContext(ApiContext);
  if (!ctx) {
    throw new Error("useApi must be used within an ApiProvider");
  }
  return ctx;
}
