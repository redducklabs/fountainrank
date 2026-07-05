import { describe, expect, it } from "vitest";
import { MAP_COLORS, mapColorsFor } from "./colors";

describe("MAP_COLORS", () => {
  it("light matches the current hardcoded paint", () => {
    expect(MAP_COLORS.light.cluster).toBe("#0C44A0");
    expect(MAP_COLORS.light.clusterStroke).toBe("#FFFFFF");
    expect(MAP_COLORS.light.pillText).toBe("#0A357E");
    expect(MAP_COLORS.light.pillBg).toBe("pill-bg");
    expect(MAP_COLORS.light.selectedPin).toBe("pin-selected");
    expect(MAP_COLORS.light.halo).toBe("#0C44A0");
  });
  it("dark brightens paint + uses -dark asset names", () => {
    expect(MAP_COLORS.dark.cluster).toBe("#4C82F0");
    expect(MAP_COLORS.dark.clusterStroke).toBe("#0B1220");
    expect(MAP_COLORS.dark.pillText).toBe("#E7F0FF");
    expect(MAP_COLORS.dark.pillBg).toBe("pill-bg-dark");
    expect(MAP_COLORS.dark.selectedPin).toBe("pin-selected-dark");
    expect(MAP_COLORS.dark.halo).toBe("#5FC5F0");
  });
  it("mapColorsFor selects by theme", () => {
    expect(mapColorsFor("light")).toBe(MAP_COLORS.light);
    expect(mapColorsFor("dark")).toBe(MAP_COLORS.dark);
  });
});
