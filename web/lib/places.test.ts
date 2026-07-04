import { describe, expect, it } from "vitest";

import { cityPath, countryPath } from "./places";

describe("countryPath", () => {
  it("builds the ISO-2 country route, lowercased", () => {
    expect(countryPath("us")).toBe("/drinking-fountains/us");
    expect(countryPath("LU")).toBe("/drinking-fountains/lu");
  });
});

describe("cityPath", () => {
  it("builds the country + city-slug route, lowercasing only the country segment", () => {
    expect(cityPath("us", "san-diego")).toBe("/drinking-fountains/us/san-diego");
    // The slug is sticky and already normalized upstream — it is passed through verbatim.
    expect(cityPath("US", "san-diego")).toBe("/drinking-fountains/us/san-diego");
  });
});
