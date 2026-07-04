import { afterEach, describe, expect, it, vi } from "vitest";

// The countries chunk fetches the public place list — stub it, keep the real countryPath.
const { getCountriesServer } = vi.hoisted(() => ({ getCountriesServer: vi.fn() }));
vi.mock("../lib/places", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../lib/places")>();
  return { ...actual, getCountriesServer };
});

import robots from "./robots";
import { GET as indexGET } from "./sitemap.xml/route";
import { GET as coreGET } from "./sitemaps/core.xml/route";
import { GET as countriesGET } from "./sitemaps/countries.xml/route";

const APEX = "https://fountainrank.com";

afterEach(() => vi.clearAllMocks());

describe("sitemap index (/sitemap.xml)", () => {
  it("is a sitemapindex referencing the core + countries chunks", async () => {
    const xml = await indexGET().text();
    expect(xml).toContain("<sitemapindex");
    expect(xml).toContain(`<loc>${APEX}/sitemaps/core.xml</loc>`);
    expect(xml).toContain(`<loc>${APEX}/sitemaps/countries.xml</loc>`);
  });
});

describe("core chunk (/sitemaps/core.xml)", () => {
  it("lists the static public pages and no auth-gated routes", async () => {
    const xml = await coreGET().text();
    for (const p of [`${APEX}/`, `${APEX}/leaderboard`, `${APEX}/privacy`, `${APEX}/terms`]) {
      expect(xml).toContain(`<loc>${p}</loc>`);
    }
    expect(xml).not.toContain("/account");
    expect(xml).not.toContain("/admin");
    // Legal pages carry their real lastmod; data-driven pages omit it.
    expect(xml).toContain("<lastmod>2026-06-30</lastmod>");
  });
});

describe("countries chunk (/sitemaps/countries.xml)", () => {
  it("lists /drinking-fountains/<cc> for each ready country", async () => {
    getCountriesServer.mockResolvedValue({
      data: [
        {
          id: "1",
          country_code: "us",
          slug: "united-states",
          name: "United States",
          subtype: "country",
          fountain_count: 100,
        },
        {
          id: "2",
          country_code: "lu",
          slug: "luxembourg",
          name: "Luxembourg",
          subtype: "country",
          fountain_count: 50,
        },
      ],
      status: 200,
    });
    const xml = await (await countriesGET()).text();
    expect(xml).toContain(`<loc>${APEX}/drinking-fountains/us</loc>`);
    expect(xml).toContain(`<loc>${APEX}/drinking-fountains/lu</loc>`);
  });

  it("is an empty urlset when no country is ready (>= K)", async () => {
    getCountriesServer.mockResolvedValue({ data: [], status: 200 });
    const xml = await (await countriesGET()).text();
    expect(xml).toContain("<urlset");
    expect(xml).not.toContain("<loc>");
  });
});

describe("robots", () => {
  const result = robots();
  const rule = Array.isArray(result.rules) ? result.rules[0] : result.rules;

  it("allows crawling and references the apex sitemap index", () => {
    expect(rule?.allow).toBe("/");
    expect(result.sitemap).toBe(`${APEX}/sitemap.xml`);
  });

  it("disallows the auth-gated routes", () => {
    expect(rule?.disallow).toEqual(expect.arrayContaining(["/account", "/admin"]));
  });
});
