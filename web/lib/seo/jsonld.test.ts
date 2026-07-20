import { describe, expect, it } from "vitest";

import { itemListStructuredData, jsonLdScript } from "./jsonld";

describe("jsonLdScript", () => {
  it("escapes '<' so JSON-LD cannot break out of the script tag", () => {
    expect(jsonLdScript({ name: "a<b</script>" })).toBe('{"name":"a\\u003cb\\u003c/script>"}');
  });
});

describe("itemListStructuredData", () => {
  it("builds a summary-format ItemList with 1-based positions in URL order", () => {
    expect(
      itemListStructuredData([
        "https://fountainrank.com/fountains/a",
        "https://fountainrank.com/fountains/b",
      ]),
    ).toEqual({
      "@context": "https://schema.org",
      "@type": "ItemList",
      itemListElement: [
        { "@type": "ListItem", position: 1, url: "https://fountainrank.com/fountains/a" },
        { "@type": "ListItem", position: 2, url: "https://fountainrank.com/fountains/b" },
      ],
    });
  });

  it("returns null for an empty list so the caller emits no script", () => {
    expect(itemListStructuredData([])).toBeNull();
  });
});
