import { describe, expect, it } from "vitest";

import { cityPath, countryPath, placeTitle, regionPath, roundedCountPlus } from "./places";

describe("countryPath", () => {
  it("builds the ISO-2 country route, lowercased", () => {
    expect(countryPath("us")).toBe("/drinking-fountains/us");
    expect(countryPath("LU")).toBe("/drinking-fountains/lu");
  });
});

describe("cityPath", () => {
  it("builds the two-level country + city-slug route, lowercasing only the country segment", () => {
    expect(cityPath("us", "san-diego")).toBe("/drinking-fountains/us/san-diego");
    // The slug is sticky and already normalized upstream — it is passed through verbatim.
    expect(cityPath("US", "san-diego")).toBe("/drinking-fountains/us/san-diego");
  });

  it("builds the nested region + city route when a region slug is supplied", () => {
    expect(cityPath("US", "san-diego", "california")).toBe(
      "/drinking-fountains/us/california/san-diego",
    );
  });
});

describe("regionPath", () => {
  it("builds the country + region-slug route", () => {
    expect(regionPath("US", "california")).toBe("/drinking-fountains/us/california");
  });
});

describe("placeTitle", () => {
  it("builds the intent-matched title with an en-US-formatted mapped count", () => {
    expect(placeTitle("San Diego", 42)).toBe("Public drinking fountains in San Diego — 42 mapped");
    expect(placeTitle("United States", 1234)).toBe(
      "Public drinking fountains in United States — 1,234 mapped",
    );
    // Large numbers keep the en-US thousands separators, deterministically.
    expect(placeTitle("Île-de-France", 1234567)).toBe(
      "Public drinking fountains in Île-de-France — 1,234,567 mapped",
    );
  });
});

describe("roundedCountPlus", () => {
  it("floors to a clean thousand and suffixes +", () => {
    expect(roundedCountPlus(285432)).toBe("285,000+");
    expect(roundedCountPlus(1999)).toBe("1,000+");
    expect(roundedCountPlus(1000)).toBe("1,000+");
  });

  it("shows the exact number below a thousand (no misleading 0+)", () => {
    expect(roundedCountPlus(999)).toBe("999");
    expect(roundedCountPlus(0)).toBe("0");
  });
});
