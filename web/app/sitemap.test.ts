import { afterEach, describe, expect, it, vi } from "vitest";

// The data chunks fetch public place/fountain lists — stub them, keep the real pure path helpers.
const {
  getCountriesServer,
  getCountryCitiesServer,
  getCountryRegionsServer,
  getFountainsByAttributeServer,
  getIndexableFountainsServer,
  getRegionCitiesServer,
  getSitemapCitiesServer,
  logFn,
} = vi.hoisted(() => ({
  getCountriesServer: vi.fn(),
  getCountryCitiesServer: vi.fn(),
  getCountryRegionsServer: vi.fn(),
  getFountainsByAttributeServer: vi.fn(),
  getIndexableFountainsServer: vi.fn(),
  getRegionCitiesServer: vi.fn(),
  getSitemapCitiesServer: vi.fn(),
  logFn: vi.fn(),
}));
const { notFound, permanentRedirect } = vi.hoisted(() => ({
  notFound: vi.fn(() => {
    throw new Error("NEXT_NOT_FOUND");
  }),
  permanentRedirect: vi.fn((url: string) => {
    throw new Error(`NEXT_REDIRECT:${url}`);
  }),
}));

vi.mock("../lib/places", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../lib/places")>();
  return {
    ...actual,
    getCountriesServer,
    getCountryCitiesServer,
    getCountryRegionsServer,
    getFountainsByAttributeServer,
    getIndexableFountainsServer,
    getRegionCitiesServer,
    getSitemapCitiesServer,
  };
});
vi.mock("../lib/server/log", () => ({ log: logFn }));
vi.mock("next/navigation", () => ({ notFound, permanentRedirect }));

import robots from "./robots";
import { GET as indexGET } from "./sitemap.xml/route";
import { GET as attributesGET } from "./sitemaps/attributes.xml/route";
import { GET as legacyCitiesGET } from "./sitemaps/cities.xml/route";
import { GET as citiesChunkGET } from "./sitemaps/cities/[chunk]/route";
import { GET as coreGET } from "./sitemaps/core.xml/route";
import { GET as countriesGET } from "./sitemaps/countries.xml/route";
import { GET as legacyFountainsGET } from "./sitemaps/fountains.xml/route";
import { GET as fountainChunkGET } from "./sitemaps/fountains/[chunk]/route";
import { GET as regionsGET } from "./sitemaps/regions.xml/route";

const APEX = "https://fountainrank.com";

const country = (cc: string, name: string) => ({
  id: `country-${cc}`,
  parent_id: null,
  country_code: cc,
  slug: name.toLowerCase().replaceAll(" ", "-"),
  name,
  subtype: "country",
  place_kind: "country",
  fountain_count: 100,
  indexable: true,
});
const region = (cc: string, slug: string, name: string) => ({
  id: `region-${slug}`,
  parent_id: `country-${cc}`,
  country_code: cc,
  slug,
  name,
  subtype: "administrative",
  place_kind: "region",
  fountain_count: 80,
  indexable: true,
});
const chunkParams = (chunk: string) => ({ params: Promise.resolve({ chunk }) });

afterEach(() => vi.clearAllMocks());

describe("sitemap index (/sitemap.xml)", () => {
  it("is a sitemapindex referencing fixed chunks plus exactly-sized fountain + city chunks", async () => {
    getIndexableFountainsServer.mockResolvedValue({
      data: { fountain_ids: ["sample"], total_count: 50001 },
      status: 200,
    });
    getSitemapCitiesServer.mockResolvedValue({
      data: { cities: [], total_count: 50001 },
      status: 200,
    });

    const xml = await (await indexGET()).text();

    expect(xml).toContain("<sitemapindex");
    expect(xml).toContain(`<loc>${APEX}/sitemaps/core.xml</loc>`);
    expect(xml).toContain(`<loc>${APEX}/sitemaps/countries.xml</loc>`);
    expect(xml).toContain(`<loc>${APEX}/sitemaps/regions.xml</loc>`);
    expect(xml).toContain(`<loc>${APEX}/sitemaps/cities/0.xml</loc>`);
    expect(xml).toContain(`<loc>${APEX}/sitemaps/cities/1.xml</loc>`);
    expect(xml).not.toContain(`<loc>${APEX}/sitemaps/cities.xml</loc>`);
    expect(xml).toContain(`<loc>${APEX}/sitemaps/attributes.xml</loc>`);
    expect(xml).toContain(`<loc>${APEX}/sitemaps/fountains/0.xml</loc>`);
    expect(xml).toContain(`<loc>${APEX}/sitemaps/fountains/1.xml</loc>`);
    expect(xml).not.toContain(`<loc>${APEX}/sitemaps/fountains.xml</loc>`);
    expect(getIndexableFountainsServer).toHaveBeenCalledWith(expect.any(String), 1, 0);
    expect(getSitemapCitiesServer).toHaveBeenCalledWith(expect.any(String), 1, 0);
  });

  it("sizes fountain + city chunks exactly at 50k boundaries", async () => {
    getIndexableFountainsServer.mockResolvedValue({
      data: { fountain_ids: ["sample"], total_count: 50000 },
      status: 200,
    });
    getSitemapCitiesServer.mockResolvedValue({
      data: { cities: [], total_count: 50000 },
      status: 200,
    });
    let xml = await (await indexGET()).text();
    expect(xml).toContain(`<loc>${APEX}/sitemaps/fountains/0.xml</loc>`);
    expect(xml).not.toContain(`<loc>${APEX}/sitemaps/fountains/1.xml</loc>`);
    expect(xml).toContain(`<loc>${APEX}/sitemaps/cities/0.xml</loc>`);
    expect(xml).not.toContain(`<loc>${APEX}/sitemaps/cities/1.xml</loc>`);

    vi.clearAllMocks();
    getIndexableFountainsServer.mockResolvedValue({
      data: { fountain_ids: ["sample"], total_count: 100000 },
      status: 200,
    });
    getSitemapCitiesServer.mockResolvedValue({
      data: { cities: [], total_count: 100001 },
      status: 200,
    });
    xml = await (await indexGET()).text();
    expect(xml).toContain(`<loc>${APEX}/sitemaps/fountains/0.xml</loc>`);
    expect(xml).toContain(`<loc>${APEX}/sitemaps/fountains/1.xml</loc>`);
    expect(xml).not.toContain(`<loc>${APEX}/sitemaps/fountains/2.xml</loc>`);
    expect(xml).toContain(`<loc>${APEX}/sitemaps/cities/2.xml</loc>`);
    expect(xml).not.toContain(`<loc>${APEX}/sitemaps/cities/3.xml</loc>`);
  });

  it("omits city chunks entirely when no city is indexable (count 0)", async () => {
    getIndexableFountainsServer.mockResolvedValue({
      data: { fountain_ids: ["sample"], total_count: 10 },
      status: 200,
    });
    getSitemapCitiesServer.mockResolvedValue({
      data: { cities: [], total_count: 0 },
      status: 200,
    });

    const xml = await (await indexGET()).text();

    expect(xml).toContain(`<loc>${APEX}/sitemaps/fountains/0.xml</loc>`);
    expect(xml).not.toContain(`<loc>${APEX}/sitemaps/cities/0.xml</loc>`);
  });

  it("returns an uncacheable 503 when the fountain-count fetch fails", async () => {
    getIndexableFountainsServer.mockResolvedValue({ data: undefined, status: 0 });
    getSitemapCitiesServer.mockResolvedValue({
      data: { cities: [], total_count: 5 },
      status: 200,
    });

    const res = await indexGET();

    expect(res.status).toBe(503);
    expect(res.headers.get("cache-control")).toContain("no-store");
    expect(logFn).toHaveBeenCalledWith(
      "error",
      expect.stringMatching(/sitemap index/i),
      expect.any(Object),
    );
  });

  it("returns an uncacheable 503 when the city-count fetch fails", async () => {
    getIndexableFountainsServer.mockResolvedValue({
      data: { fountain_ids: ["sample"], total_count: 5 },
      status: 200,
    });
    getSitemapCitiesServer.mockResolvedValue({ data: undefined, status: 0 });

    const res = await indexGET();

    expect(res.status).toBe(503);
    expect(res.headers.get("cache-control")).toContain("no-store");
    expect(logFn).toHaveBeenCalledWith(
      "error",
      expect.stringMatching(/sitemap index/i),
      expect.any(Object),
    );
  });
});

describe("fountains chunks (/sitemaps/fountains/[chunk])", () => {
  it("lists /fountains/<id> for each indexable fountain", async () => {
    getIndexableFountainsServer.mockResolvedValue({
      data: { fountain_ids: ["f1", "f2"], total_count: 2 },
      status: 200,
    });

    const xml = await (
      await fountainChunkGET(new Request("https://example.com"), chunkParams("0.xml"))
    ).text();

    expect(xml).toContain(`<loc>${APEX}/fountains/f1</loc>`);
    expect(xml).toContain(`<loc>${APEX}/fountains/f2</loc>`);
    expect(getIndexableFountainsServer).toHaveBeenCalledWith(expect.any(String), 50000, 0);
  });

  it("uses zero-based chunk offsets", async () => {
    getIndexableFountainsServer.mockResolvedValue({
      data: { fountain_ids: ["f50001"], total_count: 50001 },
      status: 200,
    });

    await fountainChunkGET(new Request("https://example.com"), chunkParams("1.xml"));

    expect(getIndexableFountainsServer).toHaveBeenCalledWith(expect.any(String), 50000, 50000);
  });

  it("returns a transient, uncacheable 503 when the backend fails", async () => {
    getIndexableFountainsServer.mockResolvedValue({ data: undefined, status: 0 });

    const res = await fountainChunkGET(new Request("https://example.com"), chunkParams("0.xml"));

    expect(res.status).toBe(503);
    expect(res.headers.get("cache-control")).toContain("no-store");
    expect(logFn).toHaveBeenCalledWith(
      "error",
      expect.stringMatching(/fountains sitemap/i),
      expect.any(Object),
    );
  });

  it("404s an out-of-range chunk instead of returning an empty 200", async () => {
    getIndexableFountainsServer.mockResolvedValue({
      data: { fountain_ids: [], total_count: 50000 },
      status: 200,
    });

    await expect(
      fountainChunkGET(new Request("https://example.com"), chunkParams("1.xml")),
    ).rejects.toThrow("NEXT_NOT_FOUND");
    expect(notFound).toHaveBeenCalledOnce();
  });

  it("404s a malformed chunk segment", async () => {
    await expect(
      fountainChunkGET(new Request("https://example.com"), chunkParams("latest.xml")),
    ).rejects.toThrow("NEXT_NOT_FOUND");
    expect(getIndexableFountainsServer).not.toHaveBeenCalled();
  });

  it("308s the legacy fountains sitemap to chunk zero", async () => {
    await expect(legacyFountainsGET()).rejects.toThrow("NEXT_REDIRECT:/sitemaps/fountains/0.xml");
    expect(permanentRedirect).toHaveBeenCalledWith("/sitemaps/fountains/0.xml");
  });
});

describe("attributes chunk (/sitemaps/attributes.xml)", () => {
  it("lists indexable attribute pages + the near-me hub; omits below-gate pages", async () => {
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
    for (const p of [
      `${APEX}/`,
      `${APEX}/drinking-fountains`,
      `${APEX}/leaderboard`,
      `${APEX}/privacy`,
      `${APEX}/terms`,
    ]) {
      expect(xml).toContain(`<loc>${p}</loc>`);
    }
    expect(xml).not.toContain("/account");
    expect(xml).not.toContain("/admin");
    expect(xml).toContain("<lastmod>2026-06-30</lastmod>");
  });
});

describe("countries chunk (/sitemaps/countries.xml)", () => {
  it("lists /drinking-fountains/<cc> for each ready country", async () => {
    getCountriesServer.mockResolvedValue({
      data: [
        country("us", "United States"),
        country("lu", "Luxembourg"),
        { ...country("de", "Germany"), indexable: false },
      ],
      status: 200,
    });

    const xml = await (await countriesGET()).text();

    expect(getCountriesServer).toHaveBeenCalledWith(expect.any(String), 1000);
    expect(xml).toContain(`<loc>${APEX}/drinking-fountains/us</loc>`);
    expect(xml).toContain(`<loc>${APEX}/drinking-fountains/lu</loc>`);
    expect(xml).not.toContain(`<loc>${APEX}/drinking-fountains/de</loc>`);
  });

  it("is an empty urlset when no country is ready (>= K)", async () => {
    getCountriesServer.mockResolvedValue({ data: [], status: 200 });

    const xml = await (await countriesGET()).text();

    expect(xml).toContain("<urlset");
    expect(xml).not.toContain("<loc>");
  });
});

describe("regions chunk (/sitemaps/regions.xml)", () => {
  it("lists /drinking-fountains/<cc>/<region> for every ready region", async () => {
    getCountriesServer.mockResolvedValue({
      data: [country("us", "United States"), { ...country("de", "Germany"), indexable: false }],
      status: 200,
    });
    getCountryRegionsServer.mockResolvedValue({
      data: [region("us", "california", "California")],
      status: 200,
    });

    const xml = await (await regionsGET()).text();

    expect(getCountryRegionsServer).toHaveBeenCalledWith("us", expect.any(String), 1000);
    expect(getCountryRegionsServer).not.toHaveBeenCalledWith("de", expect.any(String), 1000);
    expect(xml).toContain(`<loc>${APEX}/drinking-fountains/us/california</loc>`);
  });
});

describe("cities chunks (/sitemaps/cities/[chunk])", () => {
  it("lists nested + two-level city URLs from the flat backend feed", async () => {
    getSitemapCitiesServer.mockResolvedValue({
      data: {
        cities: [
          { country_code: "us", slug: "san-diego", region_slug: "california" },
          { country_code: "lu", slug: "luxembourg", region_slug: null },
        ],
        total_count: 2,
      },
      status: 200,
    });

    const xml = await (
      await citiesChunkGET(new Request("https://example.com"), chunkParams("0.xml"))
    ).text();

    expect(getSitemapCitiesServer).toHaveBeenCalledWith(expect.any(String), 50000, 0);
    expect(xml).toContain(`<loc>${APEX}/drinking-fountains/us/california/san-diego</loc>`);
    expect(xml).toContain(`<loc>${APEX}/drinking-fountains/lu/luxembourg</loc>`);
  });

  it("uses zero-based chunk offsets", async () => {
    getSitemapCitiesServer.mockResolvedValue({
      data: { cities: [{ country_code: "us", slug: "x", region_slug: null }], total_count: 50001 },
      status: 200,
    });

    await citiesChunkGET(new Request("https://example.com"), chunkParams("1.xml"));

    expect(getSitemapCitiesServer).toHaveBeenCalledWith(expect.any(String), 50000, 50000);
  });

  it("returns a transient, uncacheable 503 when the backend fails", async () => {
    getSitemapCitiesServer.mockResolvedValue({ data: undefined, status: 0 });

    const res = await citiesChunkGET(new Request("https://example.com"), chunkParams("0.xml"));

    expect(res.status).toBe(503);
    expect(res.headers.get("cache-control")).toContain("no-store");
    expect(logFn).toHaveBeenCalledWith(
      "error",
      expect.stringMatching(/cities sitemap/i),
      expect.any(Object),
    );
  });

  it("404s an out-of-range chunk instead of returning an empty 200", async () => {
    getSitemapCitiesServer.mockResolvedValue({
      data: { cities: [], total_count: 50000 },
      status: 200,
    });

    await expect(
      citiesChunkGET(new Request("https://example.com"), chunkParams("1.xml")),
    ).rejects.toThrow("NEXT_NOT_FOUND");
    expect(notFound).toHaveBeenCalledOnce();
  });

  it("404s a malformed chunk segment", async () => {
    await expect(
      citiesChunkGET(new Request("https://example.com"), chunkParams("latest.xml")),
    ).rejects.toThrow("NEXT_NOT_FOUND");
    expect(getSitemapCitiesServer).not.toHaveBeenCalled();
  });

  it("308s the legacy cities sitemap to chunk zero", async () => {
    await expect(legacyCitiesGET()).rejects.toThrow("NEXT_REDIRECT:/sitemaps/cities/0.xml");
    expect(permanentRedirect).toHaveBeenCalledWith("/sitemaps/cities/0.xml");
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
