import * as FileSystem from "expo-file-system/legacy";
import { createContext, useContext, useMemo, type ReactNode } from "react";

import { createApiClient, type MobileApiClient, type NativeFileUpload } from "../lib/api";
import type { MobileConfig } from "../lib/config";
import { useAuth } from "./auth-provider";

type ApiContextValue = { config: MobileConfig; client: MobileApiClient };

/**
 * Native multipart uploader backing `client.uploadMultipart` — adapts `expo-file-system`'s
 * `uploadAsync` to the injectable `NativeFileUpload` shape. Kept at module scope (stable identity)
 * so it never churns the `useMemo` below. This is why photo upload works on RN's New Architecture:
 * it streams the file natively instead of a `fetch`+`FormData` upload, which throws
 * `Error: Unsupported FormDataPart implementation` on the bridgeless networking layer.
 */
const uploadFile: NativeFileUpload = async (url, fileUri, options) => {
  const result = await FileSystem.uploadAsync(url, fileUri, {
    httpMethod: options.httpMethod,
    uploadType: FileSystem.FileSystemUploadType.MULTIPART,
    fieldName: options.fieldName,
    mimeType: options.mimeType,
    headers: options.headers,
  });
  return { status: result.status, body: result.body };
};

const ApiContext = createContext<ApiContextValue | null>(null);

export function ApiProvider({ config, children }: { config: MobileConfig; children: ReactNode }) {
  const auth = useAuth();
  const value = useMemo<ApiContextValue>(
    () => ({
      config,
      client: createApiClient(config.apiBaseUrl, {
        getAccessToken: auth.getBackendAccessToken,
        uploadFile,
      }),
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
