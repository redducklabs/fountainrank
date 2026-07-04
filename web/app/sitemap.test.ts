import { afterEach, describe, expect, it, vi } from "vitest";

// The data chunks fetch the public place list — stub them, keep the real country/cityPath.
const { getCountriesServer, getCountryCitiesServer } = vi.hoisted(() => ({
  getCountriesServer: vi.fn(),
  getCountryCitiesServer: vi.fn(),
}));
vi.mock("../lib/places", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../lib/places")>();
  return { ...actual, getCountriesServer, getCountryCitiesServer };
});
vi.mock("../lib/server/log", () => ({ log: vi.fn() }));

import robots from "./robots";
import { GET as indexGET } from "./sitemap.xml/route";
import { GET as citiesGET } from "./sitemaps/cities.xml/route";
import { GET as coreGET } from "./sitemaps/core.xml/route";
import { GET as countriesGET } from "./sitemaps/countries.xml/route";

const APEX = "https://fountainrank.com";

afterEach(() => vi.clearAllMocks());

describe("sitemap index (/sitemap.xml)", () => {
  it("is a sitemapindex referencing the core + countries + cities chunks", async () => {
    const xml = await indexGET().text();
    expect(xml).toContain("<sitemapindex");
    expect(xml).toContain(`<loc>${APEX}/sitemaps/core.xml</loc>`);
    expect(xml).toContain(`<loc>${APEX}/sitemaps/countries.xml</loc>`);
    expect(xml).toContain(`<loc>${APEX}/sitemaps/cities.xml</loc>`);
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

describe("cities chunk (/sitemaps/cities.xml)", () => {
  it("lists /drinking-fountains/<cc>/<slug> for each ready city under each ready country", async () => {
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
      ],
      status: 200,
    });
    getCountryCitiesServer.mockResolvedValue({
      data: [
        {
          id: "c1",
          country_code: "us",
          slug: "san-diego",
          name: "San Diego",
          subtype: "locality",
          fountain_count: 40,
        },
        {
          id: "c2",
          country_code: "us",
          slug: "los-angeles",
          name: "Los Angeles",
          subtype: "locality",
          fountain_count: 30,
        },
      ],
      status: 200,
    });
    const xml = await (await citiesGET()).text();
    expect(getCountryCitiesServer).toHaveBeenCalledWith("us", expect.any(String), 1000);
    expect(xml).toContain(`<loc>${APEX}/drinking-fountains/us/san-diego</loc>`);
    expect(xml).toContain(`<loc>${APEX}/drinking-fountains/us/los-angeles</loc>`);
  });

  it("is an empty urlset when no country is ready", async () => {
    getCountriesServer.mockResolvedValue({ data: [], status: 200 });
    const xml = await (await citiesGET()).text();
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
