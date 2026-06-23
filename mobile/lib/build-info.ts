export function formatBuildInfo(
  version: string | null | undefined,
  build: string | null | undefined,
): string {
  return `v${version ?? "0.0.0"} (build ${build ?? "unknown"})`;
}
