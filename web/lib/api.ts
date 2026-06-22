import { makeClient, type ApiClient } from "@fountainrank/api-client";

const DEFAULT_API_BASE_URL = "http://localhost:3021";

export function resolveApiBaseUrl(envOverride?: Record<string, string | undefined>): string {
  // Read `process.env.NEXT_PUBLIC_API_BASE_URL` via a LITERAL static member access so Next.js
  // inlines it into the client (and server) bundle at build time. The previous impl aliased
  // `process.env` and used bracket access (`env["NEXT_PUBLIC_API_BASE_URL"]`), which Next does
  // NOT statically replace — so in the browser it was `undefined` and the app silently fell back
  // to localhost:3021 in production (the prod web called localhost for the API). `envOverride`
  // exists only for tests; runtime callers pass nothing and get the inlined value.
  if (envOverride) {
    return envOverride["NEXT_PUBLIC_API_BASE_URL"] ?? DEFAULT_API_BASE_URL;
  }
  return process.env.NEXT_PUBLIC_API_BASE_URL ?? DEFAULT_API_BASE_URL;
}

export function getApiClient(): ApiClient {
  return makeClient(resolveApiBaseUrl());
}
