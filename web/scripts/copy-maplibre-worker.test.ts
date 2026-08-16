import { mkdtempSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { createRequire } from "node:module";
import { dirname, join, posix } from "node:path";
import { describe, expect, it } from "vitest";
import {
  WORKER_ENTRY,
  collectWorkerGraph,
  copyWorkerGraph,
  relativeSpecifiers,
} from "./copy-maplibre-worker.mjs";

const require = createRequire(import.meta.url);
const distDir = join(dirname(require.resolve("maplibre-gl/package.json")), "dist");

// The worker is only usable if EVERY module it imports sits beside it in the copied directory.
// MapLibre is bumped automatically, so this is derived and asserted rather than hardcoded — an
// upgrade that adds a chunk must not silently ship a worker that 404s on a missing sibling.
describe("relativeSpecifiers", () => {
  it("finds the shapes a minified bundle produces", () => {
    expect(relativeSpecifiers('import{a as b}from"./shared.mjs"')).toEqual(["./shared.mjs"]);
    expect(relativeSpecifiers('import"./side-effect.mjs"')).toEqual(["./side-effect.mjs"]);
    expect(relativeSpecifiers('const x=await import("./lazy.mjs")')).toEqual(["./lazy.mjs"]);
    expect(relativeSpecifiers('export{a}from"./re-export.mjs"')).toEqual(["./re-export.mjs"]);
  });

  it("ignores bare package specifiers, which are not sibling files", () => {
    expect(relativeSpecifiers('import fs from"node:fs";import x from"maplibre-gl"')).toEqual([]);
  });
});

describe("collectWorkerGraph", () => {
  it("includes the entry and resolves every import against the installed MapLibre", () => {
    const files = collectWorkerGraph(distDir);
    expect(files).toContain(WORKER_ENTRY);
    for (const file of files) {
      // Nothing in the graph may import a module outside the copied set. Resolve exactly as the
      // copy does — relative to the importer's own directory — so a nested graph stays correct.
      for (const spec of relativeSpecifiers(readFileSync(join(distDir, file), "utf8"))) {
        expect(files).toContain(posix.normalize(posix.join(posix.dirname(file), spec)));
      }
    }
  });

  it("follows a transitive chain", () => {
    const dir = mkdtempSync(join(tmpdir(), "mlw-"));
    writeFileSync(join(dir, WORKER_ENTRY), 'import{a}from"./one.mjs"');
    writeFileSync(join(dir, "one.mjs"), 'export{b}from"./two.mjs"');
    writeFileSync(join(dir, "two.mjs"), "export const b=1");
    expect(collectWorkerGraph(dir).sort()).toEqual([WORKER_ENTRY, "one.mjs", "two.mjs"].sort());
  });

  it("resolves a nested import relative to its importer, not the root", () => {
    const dir = mkdtempSync(join(tmpdir(), "mlw-"));
    mkdirSync(join(dir, "chunks"), { recursive: true });
    writeFileSync(join(dir, WORKER_ENTRY), 'import{a}from"./chunks/a.mjs"');
    writeFileSync(join(dir, "chunks", "a.mjs"), 'export{b}from"./b.mjs"');
    writeFileSync(join(dir, "chunks", "b.mjs"), "export const b=1");
    expect(collectWorkerGraph(dir).sort()).toEqual(
      [WORKER_ENTRY, "chunks/a.mjs", "chunks/b.mjs"].sort(),
    );
  });

  it("fails loudly when an imported module is missing instead of shipping a broken worker", () => {
    const dir = mkdtempSync(join(tmpdir(), "mlw-"));
    writeFileSync(join(dir, WORKER_ENTRY), 'import{a}from"./absent.mjs"');
    expect(() => collectWorkerGraph(dir)).toThrow(/absent\.mjs/);
  });

  it("refuses an import that escapes the dist directory", () => {
    const dir = mkdtempSync(join(tmpdir(), "mlw-"));
    writeFileSync(join(dir, WORKER_ENTRY), 'import{a}from"../outside.mjs"');
    expect(() => collectWorkerGraph(dir)).toThrow(/escapes/);
  });
});

describe("copyWorkerGraph", () => {
  it("writes the whole graph under the version directory", () => {
    const src = mkdtempSync(join(tmpdir(), "mlw-src-"));
    writeFileSync(join(src, WORKER_ENTRY), 'import{a}from"./shared.mjs"');
    writeFileSync(join(src, "shared.mjs"), "export const a=1");
    const outRoot = join(mkdtempSync(join(tmpdir(), "mlw-out-")), "maplibre");
    const files = copyWorkerGraph({ distDir: src, outRoot, version: "9.9.9" });
    expect(files.sort()).toEqual([WORKER_ENTRY, "shared.mjs"].sort());
    expect(readdirSync(join(outRoot, "9.9.9")).sort()).toEqual([WORKER_ENTRY, "shared.mjs"].sort());
  });

  it("drops a previous version so an upgrade leaves no stale worker behind", () => {
    const src = mkdtempSync(join(tmpdir(), "mlw-src-"));
    writeFileSync(join(src, WORKER_ENTRY), "export const a=1");
    const outRoot = join(mkdtempSync(join(tmpdir(), "mlw-out-")), "maplibre");
    mkdirSync(join(outRoot, "1.0.0"), { recursive: true });
    writeFileSync(join(outRoot, "1.0.0", "stale.mjs"), "stale");
    copyWorkerGraph({ distDir: src, outRoot, version: "2.0.0" });
    expect(readdirSync(outRoot)).toEqual(["2.0.0"]);
  });
});
