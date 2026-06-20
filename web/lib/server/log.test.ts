import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { log, redact } from "./log";

afterEach(() => vi.restoreAllMocks());

describe("redact", () => {
  it("masks token-bearing keys, keeps benign ones", () => {
    const out = redact({ accessToken: "abc", authorization: "Bearer z", code: "c", user: "bob" });
    expect(out.accessToken).toBe("[redacted]");
    expect(out.authorization).toBe("[redacted]");
    expect(out.code).toBe("[redacted]");
    expect(out.user).toBe("bob");
  });

  it("redacts sensitive keys nested in objects", () => {
    expect(redact({ error: { accessToken: "x" } })).toEqual({
      error: { accessToken: "[redacted]" },
    });
  });

  it("redacts sensitive objects inside arrays", () => {
    expect(redact({ items: [{ token: "x" }, { ok: 1 }] })).toEqual({
      items: [{ token: "[redacted]" }, { ok: 1 }],
    });
  });

  it("redacts JWT-looking string values even under a benign key", () => {
    expect(redact({ note: "header.eyJhbGc.sig.part" }).note).toBe("[redacted]");
  });

  it("drops Error message/cause/stack, keeps the name", () => {
    expect(redact({ err: new TypeError("secret-in-message") })).toEqual({
      err: { name: "TypeError" },
    });
  });
});

describe("log", () => {
  it("never emits a token value", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    log(
      "warn",
      "callback failed",
      { accessToken: "supersecret" },
      { LOG_LEVEL: "info", LOG_FORMAT: "json" },
    );
    const line = spy.mock.calls.map((c) => String(c[0])).join("");
    expect(line).not.toContain("supersecret");
    expect(line).toContain("[redacted]");
  });

  it("suppresses below the configured level", () => {
    const spy = vi.spyOn(console, "log").mockImplementation(() => {});
    log("debug", "noise", {}, { LOG_LEVEL: "info" });
    expect(spy).not.toHaveBeenCalled();
  });
});
