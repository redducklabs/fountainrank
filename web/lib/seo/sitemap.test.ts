import { describe, expect, it } from "vitest";

import { buildSitemapIndex, buildUrlset, escapeXml, sitemapResponse } from "./sitemap";

describe("escapeXml", () => {
  it("escapes the five XML metacharacters", () => {
    expect(escapeXml(`a&b<c>d"e'f`)).toBe("a&amp;b&lt;c&gt;d&quot;e&apos;f");
  });
});

describe("buildUrlset", () => {
  it("emits a namespaced urlset with loc/lastmod/changefreq/priority", () => {
    const xml = buildUrlset([
      { loc: "https://x/", changefreq: "daily", priority: 1 },
      { loc: "https://x/privacy", lastmod: "2026-06-30", changefreq: "yearly", priority: 0.3 },
    ]);
    expect(xml).toContain('<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">');
    expect(xml).toContain("<loc>https://x/</loc>");
    expect(xml).toContain("<priority>1.0</priority>");
    expect(xml).toContain("<lastmod>2026-06-30</lastmod>");
    expect(xml).toContain("<priority>0.3</priority>");
    expect(xml.trim().endsWith("</urlset>")).toBe(true);
  });

  it("escapes special characters in loc", () => {
    expect(buildUrlset([{ loc: "https://x/?a=1&b=2" }])).toContain(
      "<loc>https://x/?a=1&amp;b=2</loc>",
    );
  });
});

describe("buildSitemapIndex", () => {
  it("emits a namespaced sitemapindex referencing each chunk", () => {
    const xml = buildSitemapIndex([
      "https://x/sitemaps/core.xml",
      "https://x/sitemaps/countries.xml",
    ]);
    expect(xml).toContain('<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">');
    expect(xml).toContain("<sitemap><loc>https://x/sitemaps/core.xml</loc></sitemap>");
    expect(xml).toContain("<sitemap><loc>https://x/sitemaps/countries.xml</loc></sitemap>");
  });
});

describe("sitemapResponse", () => {
  it("sets an XML content type and a public cache window", async () => {
    const res = sitemapResponse("<x/>");
    expect(res.headers.get("content-type")).toContain("application/xml");
    expect(res.headers.get("cache-control")).toContain("public");
    expect(await res.text()).toBe("<x/>");
  });
});
