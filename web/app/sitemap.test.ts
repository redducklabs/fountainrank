import { afterEach, describe, expect, it, vi } from "vitest";

// The data chunks fetch the public place list — stub them, keep the real country/cityPath.
const { getCountriesServer, getCountryCitiesServer, getFountainsByAttributeServer } = vi.hoisted(
  () => ({
    getCountriesServer: vi.fn(),
    getCountryCitiesServer: vi.fn(),
    getFountainsByAttributeServer: vi.fn(),
  }),
);
vi.mock("../lib/places", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../lib/places")>();
  return { ...actual, getCountriesServer, getCountryCitiesServer, getFountainsByAttributeServer };
});
vi.mock("../lib/server/log", () => ({ log: vi.fn() }));

import robots from "./robots";
import { GET as indexGET } from "./sitemap.xml/route";
import { GET as attributesGET } from "./sitemaps/attributes.xml/route";
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
    expect(xml).toContain(`<loc>${APEX}/sitemaps/attributes.xml</loc>`);
  });
});

describe("attributes chunk (/sitemaps/attributes.xml)", () => {
  it("lists indexable attribute pages + the near-me hub; omits below-gate pages", async () => {
    // bottle_filler is ready (indexable); wheelchair_reachable is below the gate (noindex).
    getFountainsByAttributeServer.mockImplementation((attribute: string) => {
      const indexable = attribute === "bottle_filler";
      return Promise.resolve({
        data: { attribute, fountains: [], total_count: indexable ? 10 : 1, indexable },
        status: 200,
      });
    });
    const xml = await (await attributesGET()).text();
    expect(xml).toContain(`<loc>${APEX}/drinking-fountains/bottle-fillers</loc>`);
    expect(xml).not.toContain(`<loc>${APEX}/wheelchair-accessible-drinking-fountains</loc>`);
    // The static hub is always indexable, regardless of attribute data.
    expect(xml).toContain(`<loc>${APEX}/drinking-fountains-near-me</loc>`);
  });

  it("still lists near-me when the backend is unreachable (attribute pages omitted)", async () => {
    getFountainsByAttributeServer.mockResolvedValue({ data: undefined, status: 0 });
    const xml = await (await attributesGET()).text();
    expect(xml).toContain(`<loc>${APEX}/drinking-fountains-near-me</loc>`);
    expect(xml).not.toContain("bottle-fillers");
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
    // Fetch ALL countries at the API cap so none are silently dropped (not the helper's 200 default).
    expect(getCountriesServer).toHaveBeenCalledWith(expect.any(String), 1000);
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
    expect(getCountriesServer).toHaveBeenCalledWith(expect.any(String), 1000);
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
