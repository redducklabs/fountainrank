import { describe, expect, it } from "vitest";
import { mapWorkerUrl } from "./worker";

// The URL must stay same-origin (a cross-origin worker script is blocked) and version-scoped
// (an upgrade must not serve a cached worker from the previous MapLibre release). It also has
// to match the directory layout written by scripts/copy-maplibre-worker.mjs.
describe("mapWorkerUrl", () => {
  it("points at the copied worker entry for the given version", () => {
    expect(mapWorkerUrl("6.2.0")).toBe("/maplibre/6.2.0/maplibre-gl-worker.mjs");
  });

  it("is root-relative so the worker is always same-origin", () => {
    const url = mapWorkerUrl("6.2.0");
    expect(url.startsWith("/")).toBe(true);
    expect(url.startsWith("//")).toBe(false); // protocol-relative would leave the origin
  });

  it("puts the version in the path so an upgrade busts the cache", () => {
    expect(mapWorkerUrl("6.3.0")).not.toBe(mapWorkerUrl("6.2.0"));
  });

  it("keeps the worker beside its sibling chunk in one directory", () => {
    // maplibre-gl-worker.mjs does `import ... from "./maplibre-gl-shared.mjs"`, so both files
    // must resolve within the same version directory.
    expect(mapWorkerUrl("6.2.0")).toBe(
      new URL("./maplibre-gl-worker.mjs", "http://x/maplibre/6.2.0/").pathname,
    );
  });
});
