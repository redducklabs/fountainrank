/**
 * Copy MapLibre's worker entry and every module it statically imports into
 * `public/maplibre/<version>/`, so the browser can load the worker from a stable, same-origin
 * URL. Runs as the first step of `pnpm run build` / `pnpm run dev` (see package.json).
 *
 * Why a copy instead of a bundler asset reference: `maplibre-gl-worker.mjs` is not
 * self-contained — it does `import ... from "./maplibre-gl-shared.mjs"`. Turbopack copies each
 * referenced asset under its own content-hashed filename and does NOT rewrite that specifier,
 * so the worker's sibling import 404s and the worker dies on start. Keeping the whole graph
 * together under one unhashed directory preserves the relative imports. The version segment is
 * the cache-buster and keeps the served copy in lockstep with the installed package —
 * `lib/map/worker.ts` builds the same path from MapLibre's own `getVersion()`.
 *
 * The graph is DERIVED, never hardcoded: a MapLibre upgrade that splits the worker into more
 * chunks is picked up automatically, and an import that cannot be resolved fails the build
 * loudly instead of silently shipping a worker that 404s on a missing sibling (which would
 * look exactly like the blank map this whole mechanism exists to prevent).
 */
import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, posix } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

/** The worker entry MapLibre loads; everything else is reached through its imports. */
export const WORKER_ENTRY = "maplibre-gl-worker.mjs";

/**
 * Every relative module specifier in an ES module's source. Matches the shapes a minified
 * bundle actually produces — `}from"./x.mjs"`, `import"./x.mjs"`, `import("./x.mjs")` — and
 * deliberately ignores bare specifiers, which are package imports rather than sibling files.
 * @param {string} code
 * @returns {string[]}
 */
export function relativeSpecifiers(code) {
  const pattern =
    /\bfrom\s*["']([^"']+)["']|\bimport\s*\(\s*["']([^"']+)["']\s*\)|\bimport\s*["']([^"']+)["']/g;
  const found = [];
  for (const m of code.matchAll(pattern)) {
    const spec = m[1] ?? m[2] ?? m[3];
    if (spec && (spec.startsWith("./") || spec.startsWith("../"))) found.push(spec);
  }
  return found;
}

/**
 * Walk the worker's static import graph, returning every file to copy (dist-relative, POSIX).
 * Throws if an import cannot be resolved inside `distDir` — see the module comment.
 * @param {string} distDir
 * @param {string} entry
 * @returns {string[]}
 */
export function collectWorkerGraph(distDir, entry = WORKER_ENTRY) {
  const seen = new Set();
  const queue = [entry];
  while (queue.length > 0) {
    const rel = /** @type {string} */ (queue.shift());
    if (seen.has(rel)) continue;
    const abs = join(distDir, rel);
    if (!existsSync(abs)) {
      throw new Error(
        `copy-maplibre-worker: "${rel}" is imported by the MapLibre worker but is missing from ${distDir}`,
      );
    }
    seen.add(rel);
    for (const spec of relativeSpecifiers(readFileSync(abs, "utf8"))) {
      const next = posix.normalize(posix.join(posix.dirname(rel), spec));
      if (next.startsWith("..")) {
        throw new Error(
          `copy-maplibre-worker: "${rel}" imports "${spec}", which escapes ${distDir}`,
        );
      }
      queue.push(next);
    }
  }
  return [...seen];
}

/**
 * Copy the derived graph into `<outRoot>/<version>/`, replacing any previous contents so an
 * upgrade cannot leave a stale worker behind in the image.
 * @param {{ distDir: string, outRoot: string, version: string }} opts
 * @returns {string[]} the copied files, dist-relative
 */
export function copyWorkerGraph({ distDir, outRoot, version }) {
  const files = collectWorkerGraph(distDir);
  const outDir = join(outRoot, version);
  rmSync(outRoot, { recursive: true, force: true });
  mkdirSync(outDir, { recursive: true });
  for (const file of files) {
    mkdirSync(dirname(join(outDir, file)), { recursive: true });
    copyFileSync(join(distDir, file), join(outDir, file));
  }
  return files;
}

// Run only when invoked directly, so the helpers above stay importable from tests.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const require = createRequire(import.meta.url);
  const pkgJsonPath = require.resolve("maplibre-gl/package.json");
  const { version } = JSON.parse(readFileSync(pkgJsonPath, "utf8"));
  const webRoot = join(fileURLToPath(new URL(".", import.meta.url)), "..");
  const files = copyWorkerGraph({
    distDir: join(dirname(pkgJsonPath), "dist"),
    outRoot: join(webRoot, "public", "maplibre"),
    version,
  });
  console.log(`copy-maplibre-worker: public/maplibre/${version}/ <- ${files.join(", ")}`);
}
