import { makeClient, type ApiClient } from "@fountainrank/api-client";

const DEFAULT_API_BASE_URL = "http://localhost:3021";

export function resolveApiBaseUrl(env: Record<string, string | undefined> = process.env): string {
  return env["NEXT_PUBLIC_API_BASE_URL"] ?? DEFAULT_API_BASE_URL;
}

export function getApiClient(): ApiClient {
  return makeClient(resolveApiBaseUrl());
}
