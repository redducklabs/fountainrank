import "server-only";

export type LogLevel = "debug" | "info" | "warn" | "error";

const ORDER: Record<LogLevel, number> = { debug: 10, info: 20, warn: 30, error: 40 };
const MAX_DEPTH = 4;

// Substrings that mark a field KEY as sensitive (matched case-insensitively).
const SENSITIVE = [
  "token", "authorization", "cookie", "secret", "jwt", "code", "password", "query",
  "session", "credential", "apikey", "api_key", "clientid", "client_id",
];

// A JWT-shaped substring — redact such VALUES even under a benign key.
const JWT_RE = /eyJ[\w-]+\.[\w-]+\.[\w-]+/;

function isSensitiveKey(key: string): boolean {
  const lower = key.toLowerCase();
  return SENSITIVE.some((s) => lower.includes(s));
}

function redactValue(value: unknown, depth: number): unknown {
  if (depth >= MAX_DEPTH) return "[truncated]";
  if (typeof value === "string") return JWT_RE.test(value) ? "[redacted]" : value;
  // Error message/cause/stack can carry secrets — keep only the type name.
  if (value instanceof Error) return { name: value.name };
  if (Array.isArray(value)) return value.map((v) => redactValue(v, depth + 1));
  if (value && typeof value === "object") {
    return redactObject(value as Record<string, unknown>, depth + 1);
  }
  return value;
}

function redactObject(obj: Record<string, unknown>, depth: number): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(obj)) {
    out[key] = isSensitiveKey(key) ? "[redacted]" : redactValue(value, depth);
  }
  return out;
}

export function redact(fields: Record<string, unknown>): Record<string, unknown> {
  return redactObject(fields, 0);
}

export function log(
  level: LogLevel,
  message: string,
  fields: Record<string, unknown> = {},
  env: Record<string, string | undefined> = process.env,
): void {
  const threshold = ORDER[(env.LOG_LEVEL as LogLevel) ?? "info"] ?? ORDER.info;
  if (ORDER[level] < threshold) {
    return;
  }
  const safe = redact(fields);
  const payload =
    (env.LOG_FORMAT ?? "json") === "json"
      ? JSON.stringify({ level, msg: message, service: "web", ...safe })
      : `${level.toUpperCase()} ${message} ${JSON.stringify(safe)}`;
  // console is the stdout/stderr sink here (DOKS captures it) — not an ad-hoc diagnostic.
  (level === "warn" || level === "error" ? console.error : console.log)(payload);
}
