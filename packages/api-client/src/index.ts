import createClient, { type Client, type ClientOptions } from "openapi-fetch";

import type { paths } from "./schema";

export type ApiClient = Client<paths>;

export function makeClient(baseUrl: string, options?: Omit<ClientOptions, "baseUrl">): ApiClient {
  return createClient<paths>({ baseUrl, ...options });
}

export type { paths, components } from "./schema";
