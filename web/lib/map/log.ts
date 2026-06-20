// Structured, public-path-only client logging (no secrets exist on the browse path).
export function logMapError(event: string, ctx: Record<string, unknown> = {}): void {
  console.error(JSON.stringify({ level: "error", area: "map", event, ...ctx }));
}
