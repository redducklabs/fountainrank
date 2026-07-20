import { afterEach, describe, expect, it, vi } from "vitest";

import { logEvent, serializeEvent } from "./log";

afterEach(() => {
  vi.restoreAllMocks();
});

/**
 * The structured logging seam (spec §1). Every event serializes to exactly ONE
 * `console.warn(<json string>)`, and the payload is built from a per-event
 * ALLOWLIST by construction — a field that is not part of an event's typed
 * contract can never reach the wire, even if a caller smuggles one in via a cast.
 */
describe("logEvent", () => {
  it("emits exactly one console.warn whose single argument is a JSON string", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    logEvent({
      event: "api_timeout",
      method: "POST",
      path: "/api/v1/fountains",
      timeout_ms: 30_000,
      source: "deadline",
    });
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0]).toHaveLength(1);
    const [arg] = warn.mock.calls[0];
    expect(typeof arg).toBe("string");
    expect(() => JSON.parse(arg as string)).not.toThrow();
  });

  it("wraps every event with level + area + event envelope fields", () => {
    const parsed = JSON.parse(
      serializeEvent({
        event: "api_timeout",
        method: "GET",
        path: "/api/v1/fountains/bbox",
        timeout_ms: 15_000,
        source: "deadline",
      }),
    );
    expect(parsed.level).toBe("warn");
    expect(parsed.area).toBe("api");
    expect(parsed.event).toBe("api_timeout");
  });
});

describe("serializeEvent — api_timeout allowlist", () => {
  it("carries exactly {level, area, event, method, path, timeout_ms, source}", () => {
    const parsed = JSON.parse(
      serializeEvent({
        event: "api_timeout",
        method: "POST",
        path: "/api/v1/fountains",
        timeout_ms: 30_000,
        source: "deadline",
      }),
    );
    expect(parsed).toEqual({
      level: "warn",
      area: "api",
      event: "api_timeout",
      method: "POST",
      path: "/api/v1/fountains",
      timeout_ms: 30_000,
      source: "deadline",
    });
    expect(Object.keys(parsed).sort()).toEqual(
      ["area", "event", "level", "method", "path", "source", "timeout_ms"].sort(),
    );
  });

  it("OMITS any smuggled-in field (headers, token, query, raw message, full url)", () => {
    const line = serializeEvent({
      event: "api_timeout",
      method: "POST",
      path: "/api/v1/fountains",
      timeout_ms: 30_000,
      source: "deadline",
      // Fields a scrubbing approach might leak; the allowlist-by-construction seam
      // never copies them into the output.
      authorization: "Bearer secret-token",
      headers: { "x-dev-user": "evil" },
      query: "?lat=1&lng=2",
      url: "https://api.fountainrank.com/api/v1/fountains?lat=1&lng=2",
      message: "Network request failed at 47.6,-122.3",
    } as never);
    // The literal serialized string must contain none of the sensitive material.
    expect(line).not.toMatch(/secret-token/i);
    expect(line).not.toMatch(/authorization/i);
    expect(line).not.toMatch(/x-dev/i);
    expect(line).not.toMatch(/lat=1/i);
    expect(line).not.toMatch(/https?:\/\//i);
    expect(line).not.toMatch(/47\.6/);
    const parsed = JSON.parse(line);
    expect(Object.keys(parsed).sort()).toEqual(
      ["area", "event", "level", "method", "path", "source", "timeout_ms"].sort(),
    );
  });
});

describe("serializeEvent — add_fountain_outcome_unknown allowlist", () => {
  it("deadline case carries reason + timeout_ms only", () => {
    const parsed = JSON.parse(
      serializeEvent({
        event: "add_fountain_outcome_unknown",
        reason: "deadline",
        timeout_ms: 30_000,
      }),
    );
    expect(parsed).toEqual({
      level: "warn",
      area: "add_fountain",
      event: "add_fountain_outcome_unknown",
      reason: "deadline",
      timeout_ms: 30_000,
    });
  });

  it("network_failure case carries reason only — NO timeout_ms (a TypeError has no duration)", () => {
    const parsed = JSON.parse(
      serializeEvent({
        event: "add_fountain_outcome_unknown",
        reason: "network_failure",
      }),
    );
    expect(parsed).toEqual({
      level: "warn",
      area: "add_fountain",
      event: "add_fountain_outcome_unknown",
      reason: "network_failure",
    });
    expect("timeout_ms" in parsed).toBe(false);
  });

  it("OMITS a smuggled-in raw error message / coordinates on the outcome-unknown event", () => {
    const line = serializeEvent({
      event: "add_fountain_outcome_unknown",
      reason: "network_failure",
      message: "TypeError: Network request failed https://api/x?lat=47.6",
      coordinates: { lat: 47.6, lng: -122.3 },
    } as never);
    expect(line).not.toMatch(/network request failed/i);
    expect(line).not.toMatch(/47\.6/);
    expect(line).not.toMatch(/https?:\/\//i);
    const parsed = JSON.parse(line);
    expect(Object.keys(parsed).sort()).toEqual(["area", "event", "level", "reason"].sort());
  });
});

describe("serializeEvent — watch_start_rejected allowlist (spec §1)", () => {
  it("carries exactly {level, area: 'location', event} — the empty-payload rare-failure line", () => {
    const parsed = JSON.parse(serializeEvent({ event: "watch_start_rejected" }));
    expect(parsed).toEqual({
      level: "warn",
      area: "location",
      event: "watch_start_rejected",
    });
    expect(Object.keys(parsed).sort()).toEqual(["area", "event", "level"].sort());
  });

  it("emits exactly one console.warn JSON line", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    logEvent({ event: "watch_start_rejected" });
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0]).toHaveLength(1);
    expect(() => JSON.parse(warn.mock.calls[0][0] as string)).not.toThrow();
  });

  it("OMITS smuggled-in coordinates, raw errors, and timestamps", () => {
    const line = serializeEvent({
      event: "watch_start_rejected",
      // Fields a leak would carry — none can reach the wire via the allowlist-by-construction seam.
      coordinates: { lat: 47.6062, lng: -122.3321 },
      error: "Error: watch failed at 47.6062,-122.3321",
      timestamp: 1_700_000_000_000,
      message: "Location request failed https://example.com",
    } as never);
    expect(line).not.toMatch(/47\.6062/);
    expect(line).not.toMatch(/watch failed/i);
    expect(line).not.toMatch(/1700000000000/);
    expect(line).not.toMatch(/https?:\/\//i);
    const parsed = JSON.parse(line);
    expect(Object.keys(parsed).sort()).toEqual(["area", "event", "level"].sort());
  });
});
