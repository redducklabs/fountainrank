import { afterEach, describe, expect, it, vi } from "vitest";

// BASEMAP.styleUrl is read from env at import — set it before importing the module.
async function loadWith(styleUrl: string) {
  vi.resetModules();
  vi.stubEnv("NEXT_PUBLIC_BASEMAP_STYLE_URL", styleUrl);
  return import("./style");
}

afterEach(() => vi.unstubAllEnvs());

describe("styleUrlFor", () => {
  it("returns the light URL unchanged for light", async () => {
    const url = "https://cdn.example/style.light.json?v=2";
    const m = await loadWith(url);
    expect(m.styleUrlFor("light")).toBe(url);
  });
  it("swaps only the basename for dark, preserving ?v=", async () => {
    const m = await loadWith("https://cdn.example/style.light.json?v=2");
    expect(m.styleUrlFor("dark")).toBe("https://cdn.example/style.dark.json?v=2");
  });
  it("falls back to light + logs when the URL lacks the light marker", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const url = "https://cdn.example/custom-style.json";
    const m = await loadWith(url);
    expect(m.styleUrlFor("dark")).toBe(url);
    expect(spy).toHaveBeenCalledOnce();
    spy.mockRestore();
  });
});

describe("themed assets", () => {
  it("light uses base names/urls", async () => {
    const m = await loadWith("https://cdn.example/style.light.json?v=2");
    const std = m.themedPinAssets("light").find((a) => a.name === "pin-standard");
    expect(std).toEqual({ name: "pin-standard", url: "/pins/pin-standard.png" });
    expect(m.themedPillBg("light")).toEqual({ name: "pill-bg", url: "/pins/pill-bg.png" });
  });
  it("dark appends -dark to names and urls", async () => {
    const m = await loadWith("https://cdn.example/style.light.json?v=2");
    const std = m.themedPinAssets("dark").find((a) => a.name === "pin-standard-dark");
    expect(std).toEqual({ name: "pin-standard-dark", url: "/pins/pin-standard-dark.png" });
    expect(m.themedPillBg("dark")).toEqual({
      name: "pill-bg-dark",
      url: "/pins/pill-bg-dark.png",
    });
  });
});
