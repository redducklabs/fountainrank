/**
 * Copy MapLibre's worker entry + the shared chunk it imports into
 * `public/maplibre/<version>/`, so the browser can load the worker from a stable, same-origin
 * URL. Runs as the first step of `pnpm run build` / `pnpm run dev` (see package.json).
 *
 * Why a copy instead of a bundler asset reference: `maplibre-gl-worker.mjs` is not
 * self-contained — it does `import ... from "./maplibre-gl-shared.mjs"`. Turbopack copies each
 * referenced asset under its own content-hashed filename and does NOT rewrite that specifier,
 * so the worker's sibling import 404s and the worker dies on start. Keeping both files together
 * under one unhashed directory preserves the relative import. The version segment is the
 * cache-buster and keeps the served copy in lockstep with the installed package —
 * `lib/map/worker.ts` builds the same path from MapLibre's own `getVersion()`.
 */
import { copyFileSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const pkgJsonPath = require.resolve("maplibre-gl/package.json");
const distDir = join(dirname(pkgJsonPath), "dist");
const { version } = JSON.parse(readFileSync(pkgJsonPath, "utf8"));

// The worker entry plus every file it imports. `maplibre-gl-shared.mjs` has no imports of its
// own, so these two are the complete graph — re-check on a MapLibre major upgrade.
const FILES = ["maplibre-gl-worker.mjs", "maplibre-gl-shared.mjs"];

const webRoot = join(fileURLToPath(new URL(".", import.meta.url)), "..");
const outRoot = join(webRoot, "public", "maplibre");
const outDir = join(outRoot, version);

// Drop previous versions so an upgrade can't leave a stale worker behind in the image.
rmSync(outRoot, { recursive: true, force: true });
mkdirSync(outDir, { recursive: true });
for (const file of FILES) {
  copyFileSync(join(distDir, file), join(outDir, file));
}
console.log(`copy-maplibre-worker: public/maplibre/${version}/ <- ${FILES.join(", ")}`);
