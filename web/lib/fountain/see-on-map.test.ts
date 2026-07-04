import { describe, expect, it } from "vitest";
import { seeOnMapHref } from "./see-on-map";

describe("seeOnMapHref", () => {
  it("builds the flyto + focus deep link", () => {
    expect(seeOnMapHref({ id: "abc", lng: -122.42, lat: 37.77 })).toBe(
      "/?flyto=-122.42,37.77&focus=abc",
    );
  });

  it("url-encodes the focus id", () => {
    expect(seeOnMapHref({ id: "a b/c", lng: 1, lat: 2 })).toBe("/?flyto=1,2&focus=a%20b%2Fc");
  });
});
