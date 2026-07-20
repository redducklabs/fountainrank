// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { ReactNode } from "react";
import { cleanup, render, screen, within } from "@testing-library/react";

const {
  getCityFountainsServer,
  getCountryCitiesServer,
  getCountryRegionsServer,
  getRegionFountainsServer,
  resolvePlaceServer,
} = vi.hoisted(() => ({
  getCityFountainsServer: vi.fn(),
  getCountryCitiesServer: vi.fn(),
  getCountryRegionsServer: vi.fn(),
  getRegionFountainsServer: vi.fn(),
  resolvePlaceServer: vi.fn(),
}));
const { notFound, permanentRedirect } = vi.hoisted(() => ({
  notFound: vi.fn(() => {
    throw new Error("NEXT_NOT_FOUND");
  }),
  permanentRedirect: vi.fn((url: string) => {
    throw new Error(`NEXT_REDIRECT:${url}`);
  }),
}));

vi.mock("../../../../lib/places", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../../lib/places")>();
  return {
    ...actual,
    getCityFountainsServer,
    getCountryCitiesServer,
    getCountryRegionsServer,
    getRegionFountainsServer,
    resolvePlaceServer,
  };
});
vi.mock("next/navigation", () => ({ notFound, permanentRedirect }));
vi.mock("next/link", () => ({
  default: ({ children, href }: { children: ReactNode; href: string }) => (
    <a href={href}>{children}</a>
  ),
}));
vi.mock("../../../../components/SiteHeader", () => ({
  SiteHeader: () => <div data-testid="hdr" />,
}));
vi.mock("../../../../components/fountain/FountainList", () => ({
  FountainList: ({ fountains }: { fountains: { id: string; rating_count: number }[] }) => (
    <ul>
      {fountains.map((f) => (
        <li key={f.id}>
          <a href={`/fountains/${f.id}`}>Drinking fountain</a>
          <span>{f.rating_count} ratings</span>
        </li>
      ))}
    </ul>
  ),
}));
vi.mock("../../../../lib/server/log", () => ({ log: vi.fn() }));

import PlaceResolverPage, { generateMetadata } from "./page";

const WASHINGTON = {
  id: "r-wa",
  parent_id: "country-us",
  country_code: "us",
  slug: "washington",
  name: "Washington",
  subtype: "administrative",
  place_kind: "region",
  fountain_count: 120,
  indexable: true,
};
const CITY = {
  id: "c-lu",
  parent_id: "country-lu",
  country_code: "lu",
  slug: "luxembourg",
  name: "Luxembourg",
  subtype: "locality",
  place_kind: "city",
  fountain_count: 12,
  indexable: true,
};
const FOUNTAIN = {
  id: "f1",
  location: { latitude: 47.6, longitude: -122.3 },
  is_working: true,
  average_rating: 4.5,
  rating_count: 8,
  ranking_score: 0.8,
  current_status: null,
  last_verified_at: null,
  distance_m: null,
};

const fountainsFor = (place: typeof WASHINGTON | typeof CITY, indexable = true) => ({
  place,
  fountains: [FOUNTAIN],
  indexable,
});
const params = (country: string, place: string) => Promise.resolve({ country, place });

// Sibling places for the RelatedPlaces block; each list includes the current place so the tests
// prove it is excluded from its own sibling list.
const SIBLING_REGIONS = [
  { ...WASHINGTON, id: "r-or", slug: "oregon", name: "Oregon", fountain_count: 80 },
  WASHINGTON,
  { ...WASHINGTON, id: "r-ca", slug: "california", name: "California", fountain_count: 200 },
];
const SIBLING_CITIES = [
  { ...CITY, id: "c-esch", slug: "esch-sur-alzette", name: "Esch-sur-Alzette", fountain_count: 5 },
  CITY,
  { ...CITY, id: "c-diff", slug: "differdange", name: "Differdange", fountain_count: 3 },
];

beforeEach(() => {
  // Safe defaults so a page render never makes a real sibling fetch; tests override as needed.
  getCountryRegionsServer.mockResolvedValue({ data: [], status: 200 });
  getCountryCitiesServer.mockResolvedValue({ data: [], status: 200 });
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

it("renders the canonical region branch and the DC disambiguation link", async () => {
  resolvePlaceServer.mockResolvedValue({
    data: {
      kind: "region",
      canonical_path: "/drinking-fountains/us/washington",
      place: WASHINGTON,
    },
    status: 200,
  });
  getRegionFountainsServer.mockResolvedValue({ data: fountainsFor(WASHINGTON), status: 200 });
  getCountryRegionsServer.mockResolvedValue({ data: SIBLING_REGIONS, status: 200 });

  render(await PlaceResolverPage({ params: params("us", "washington") }));

  expect((await screen.findByRole("heading", { level: 1 })).textContent).toContain("Washington");
  expect(getRegionFountainsServer).toHaveBeenCalledWith("us", "washington", expect.any(String));
  expect(getCityFountainsServer).not.toHaveBeenCalled();
  expect(
    await screen.findByRole("link", { name: "Looking for Washington, District of Columbia?" }),
  ).toHaveAttribute("href", "/drinking-fountains/us/district-of-columbia/washington");
  // ItemList of the one listed fountain, linking to its detail page.
  const itemList = Array.from(
    document.querySelectorAll<HTMLScriptElement>('script[type="application/ld+json"]'),
  )
    .map((s) => JSON.parse(s.textContent ?? "{}"))
    .find((s) => s["@type"] === "ItemList");
  expect(itemList?.itemListElement).toEqual([
    { "@type": "ListItem", position: 1, url: "https://fountainrank.com/fountains/f1" },
  ]);
  // Sideways links to other regions in the country, excluding Washington itself.
  const related = screen.getByRole("navigation", { name: "Other regions in US" });
  expect(within(related).getByRole("link", { name: "Oregon" })).toHaveAttribute(
    "href",
    "/drinking-fountains/us/oregon",
  );
  expect(within(related).getByRole("link", { name: "California" })).toHaveAttribute(
    "href",
    "/drinking-fountains/us/california",
  );
  expect(within(related).queryByRole("link", { name: "Washington" })).toBeNull();
});

it("renders the two-level city branch", async () => {
  resolvePlaceServer.mockResolvedValue({
    data: {
      kind: "city",
      canonical_path: "/drinking-fountains/lu/luxembourg",
      place: CITY,
    },
    status: 200,
  });
  getCityFountainsServer.mockResolvedValue({ data: fountainsFor(CITY), status: 200 });
  getCountryCitiesServer.mockResolvedValue({ data: SIBLING_CITIES, status: 200 });

  render(await PlaceResolverPage({ params: params("lu", "luxembourg") }));

  expect((await screen.findByRole("heading", { level: 1 })).textContent).toContain("Luxembourg");
  expect(getCityFountainsServer).toHaveBeenCalledWith("lu", "luxembourg", expect.any(String));
  expect(getRegionFountainsServer).not.toHaveBeenCalled();
  // Sideways links to other cities in the country, excluding Luxembourg itself.
  const related = screen.getByRole("navigation", { name: "Other cities in LU" });
  expect(within(related).getByRole("link", { name: "Esch-sur-Alzette" })).toHaveAttribute(
    "href",
    "/drinking-fountains/lu/esch-sur-alzette",
  );
  expect(within(related).getByRole("link", { name: "Differdange" })).toHaveAttribute(
    "href",
    "/drinking-fountains/lu/differdange",
  );
  expect(within(related).queryByRole("link", { name: "Luxembourg" })).toBeNull();
});

it("308s a legacy flat city URL to the canonical nested target", async () => {
  resolvePlaceServer.mockResolvedValue({
    data: {
      kind: "city",
      canonical_path: "/drinking-fountains/us/california/san-diego",
      place: { ...CITY, country_code: "us", slug: "san-diego", name: "San Diego" },
    },
    status: 200,
  });

  await expect(PlaceResolverPage({ params: params("us", "san-diego") })).rejects.toThrow(
    "NEXT_REDIRECT:/drinking-fountains/us/california/san-diego",
  );
  expect(permanentRedirect).toHaveBeenCalledWith("/drinking-fountains/us/california/san-diego");
  expect(getCityFountainsServer).not.toHaveBeenCalled();
  expect(getRegionFountainsServer).not.toHaveBeenCalled();
});

it("404s when the resolver returns not found", async () => {
  resolvePlaceServer.mockResolvedValue({ data: undefined, status: 404 });

  await expect(PlaceResolverPage({ params: params("us", "nowhere") })).rejects.toThrow(
    "NEXT_NOT_FOUND",
  );
  expect(notFound).toHaveBeenCalledOnce();
});

it.each([
  ["delaware", "Looking for Delaware, Ohio?", "/drinking-fountains/us/ohio/delaware"],
  [
    "washington",
    "Looking for Washington, District of Columbia?",
    "/drinking-fountains/us/district-of-columbia/washington",
  ],
  ["wyoming", "Looking for Wyoming, Michigan?", "/drinking-fountains/us/michigan/wyoming"],
])("renders the %s collision as a region page", async (slug, label, href) => {
  const region = { ...WASHINGTON, slug, name: slug[0].toUpperCase() + slug.slice(1) };
  resolvePlaceServer.mockResolvedValue({
    data: { kind: "region", canonical_path: `/drinking-fountains/us/${slug}`, place: region },
    status: 200,
  });
  getRegionFountainsServer.mockResolvedValue({ data: fountainsFor(region), status: 200 });

  render(await PlaceResolverPage({ params: params("us", slug) }));

  expect(permanentRedirect).not.toHaveBeenCalled();
  expect(await screen.findByRole("link", { name: label })).toHaveAttribute("href", href);
});

it("generateMetadata uses resolver canonical and backend indexability", async () => {
  resolvePlaceServer.mockResolvedValue({
    data: {
      kind: "region",
      canonical_path: "/drinking-fountains/us/washington",
      place: WASHINGTON,
    },
    status: 200,
  });
  getRegionFountainsServer.mockResolvedValue({
    data: fountainsFor(WASHINGTON, false),
    status: 200,
  });

  const meta = await generateMetadata({ params: params("us", "washington") });

  expect(meta.title).toBe("Public drinking fountains in Washington — 120 mapped");
  expect(meta.alternates?.canonical).toBe("/drinking-fountains/us/washington");
  expect(meta.robots).toEqual({ index: false, follow: true });
});
