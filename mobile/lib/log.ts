/**
 * Structured logging seam for the mobile client (spec §1).
 *
 * The project logging standard is a server-runtime contract (`LOG_LEVEL`/`LOG_FORMAT`,
 * JSON to stdout). A shipped native binary has no equivalent runtime control, so the
 * mobile client's DOCUMENTED deviation is: rare failure events are always emitted as a
 * single structured JSON line to the JS console (Metro in dev, the OS log via React
 * Native in production) at `warn` level — never via ad-hoc multi-argument `console.*`.
 *
 * Redaction is by CONSTRUCTION, not by scrubbing: each event has a typed payload and
 * `serializeEvent` copies only that event's allowlisted fields into the output. A field
 * that is not part of an event's contract (a header, token, query string, raw error
 * message, or coordinate) can never reach the wire, even if a caller smuggles one in via
 * a cast — there is no spread of caller-supplied objects.
 */

/** Deadline expiry on a bounded request (transport). Path only — never the query/origin. */
export type ApiTimeoutEvent = {
  event: "api_timeout";
  method: string;
  path: string;
  timeout_ms: number;
  source: "deadline";
};

/**
 * The add-fountain create timed out or failed mid-flight and its server outcome is
 * unknown (recovered by reconciliation, spec §2). `timeout_ms` exists only for the
 * deadline case — a mid-flight `TypeError` has no duration. The raw error message is
 * never carried (RN network errors can embed URLs); no coordinates, no body.
 */
export type AddFountainOutcomeUnknownEvent = {
  event: "add_fountain_outcome_unknown";
} & ({ reason: "deadline"; timeout_ms: number } | { reason: "network_failure" });

export type LogEvent = ApiTimeoutEvent | AddFountainOutcomeUnknownEvent;

type LogArea = "api" | "add_fountain";

/** Build the single serialized JSON line for an event from its allowlist alone. */
export function serializeEvent(event: LogEvent): string {
  let area: LogArea;
  let fields: Record<string, string | number>;
  switch (event.event) {
    case "api_timeout":
      area = "api";
      fields = {
        method: event.method,
        path: event.path,
        timeout_ms: event.timeout_ms,
        source: event.source,
      };
      break;
    case "add_fountain_outcome_unknown":
      area = "add_fountain";
      fields =
        event.reason === "deadline"
          ? { reason: event.reason, timeout_ms: event.timeout_ms }
          : { reason: event.reason };
      break;
  }
  return JSON.stringify({ level: "warn", area, event: event.event, ...fields });
}

/** Emit one structured `warn` line for the event. The only console call the seam makes. */
export function logEvent(event: LogEvent): void {
  console.warn(serializeEvent(event));
}
