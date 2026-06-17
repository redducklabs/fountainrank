import { describe, expect, it } from "vitest";

import { makeClient } from "./index";

describe("makeClient", () => {
  it("returns typed data from GET /healthz", async () => {
    const fetchMock: typeof fetch = async () =>
      new Response(JSON.stringify({ status: "ok" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });

    const client = makeClient("http://test", { fetch: fetchMock });
    const { data, error } = await client.GET("/healthz");

    expect(error).toBeUndefined();
    expect(data).toEqual({ status: "ok" });
  });
});
