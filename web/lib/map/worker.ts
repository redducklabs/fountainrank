import { getVersion, setWorkerUrl } from "maplibre-gl";
import { logMapError } from "./log";

/**
 * Point MapLibre at its Web Worker bundle. REQUIRED once, before the first `new Map()`, for
 * every bundler consumer since MapLibre v6 — see the v5→v6 migration guide ("`setWorkerUrl()`
 * is bundler-only").
 *
 * v6 is ESM-only and auto-detects the worker from `import.meta.url`, giving up whenever that
 * is not an http(s) URL:
 *
 *     const moduleUrl = import.meta.url;
 *     if (!/^https?:/.test(moduleUrl)) return '';
 *
 * A bundler always rewrites `import.meta.url` to something else (Turbopack emits the
 * build-time `file://` path of the package on disk), so the auto-detect returns "" and
 * MapLibre calls `new Worker("")`. An empty worker URL resolves against the *document* URL, so
 * the browser fetches the HTML page as the worker script and blocks it on its `text/html` MIME
 * type. Every tile fetch and parse happens in that worker, so the failure surfaces as a
 * permanently blank basemap that never fires `load` — and MapLibre emits no `error` event for
 * it. v5 needed no call because it inlined the worker as a Blob.
 *
 * The URL points at files copied by `scripts/copy-maplibre-worker.mjs` rather than at a
 * bundler asset reference, because the worker imports a sibling chunk by literal name and
 * Turbopack content-hashes each asset separately (see that script for the detail).
 */

/**
 * Same-origin, version-scoped URL of the copied worker entry. Must match the layout written by
 * `scripts/copy-maplibre-worker.mjs`; the version segment busts the cache on an upgrade.
 */
export function mapWorkerUrl(version: string): string {
  return `/maplibre/${version}/maplibre-gl-worker.mjs`;
}

let configured = false;

export function configureMapWorker(): void {
  if (configured) return; // setWorkerUrl is global; one call per page is enough
  configured = true;
  const url = mapWorkerUrl(getVersion());
  setWorkerUrl(url);
  // If the copy step ever fails to run, the only symptom is a permanently blank basemap with
  // nothing in the console. Probe the asset so the cause is greppable instead of invisible.
  void fetch(url, { method: "HEAD" }).then(
    (res) => {
      if (!res.ok) logMapError("map-worker-asset-missing", { url, status: res.status });
    },
    (err) =>
      logMapError("map-worker-asset-unreachable", { url, detail: String(err).slice(0, 120) }),
  );
}
