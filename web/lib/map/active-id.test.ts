import { describe, expect, it } from "vitest";
import { activeIdFromPath, resolveActiveId, resolveFocusId } from "./active-id";

describe("resolveActiveId", () => {
  it("prefers the focus param over the path", () => {
    expect(resolveActiveId("f9", "/")).toBe("f9");
    expect(resolveActiveId("f9", "/fountains/f3")).toBe("f9");
  });

  it("falls back to the path fountain id", () => {
    expect(resolveActiveId(null, "/fountains/f3")).toBe("f3");
  });

  it("returns '' for a non-fountain path with no focus", () => {
    expect(resolveActiveId(null, "/")).toBe("");
    expect(activeIdFromPath("/drinking-fountains/us/reno")).toBe("");
    expect(activeIdFromPath(null)).toBe("");
  });
});

describe("resolveFocusId", () => {
  it("uses the direct-route focus when the query has no focus", () => {
    expect(resolveFocusId(null, "route-fountain")).toBe("route-fountain");
  });

  it("lets an explicit query focus take precedence", () => {
    expect(resolveFocusId("query-fountain", "route-fountain")).toBe("query-fountain");
  });
});
