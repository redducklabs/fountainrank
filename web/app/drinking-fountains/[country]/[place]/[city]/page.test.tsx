// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import type { ReactNode } from "react";
import { cleanup, render, screen } from "@testing-library/react";

const { getNestedCityFountainsServer, resolvePlaceServer } = vi.hoisted(() => ({
  getNestedCityFountainsServer: vi.fn(),
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

vi.mock("../../../../../lib/places", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../../../lib/places")>();
  return { ...actual, getNestedCityFountainsServer, resolvePlaceServer };
});
vi.mock("next/navigation", () => ({ notFound, permanentRedirect }));
vi.mock("next/link", () => ({
  default: ({ children, href }: { children: ReactNode; href: string }) => (
    <a href={href}>{children}</a>
  ),
}));
vi.mock("../../../../../components/SiteHeader", () => ({
  SiteHeader: () => <div data-testid="hdr" />,
}));
vi.mock("../../../../../components/fountain/FountainList", () => ({
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
vi.mock("../../../../../lib/server/log", () => ({ log: vi.fn() }));

import CityPage, { buildCityBreadcrumbStructuredData, generateMetadata } from "./page";

const REGION = {
  id: "r-ca",
  parent_id: "country-us",
  country_code: "us",
  slug: "california",
  name: "California",
  subtype: "administrative",
  place_kind: "region",
  fountain_count: 100,
};
const PLACE = {
  id: "p1",
  parent_id: "r-ca",
  country_code: "us",
  slug: "san-diego",
  name: "San Diego",
  subtype: "locality",
  place_kind: "city",
  fountain_count: 12,
};
const FOUNTAIN = {
  id: "f1",
  location: { latitude: 32.7, longitude: -117.1 },
  is_working: true,
  average_rating: 4.5,
  rating_count: 8,
  ranking_score: 0.8,
  current_status: null,
  last_verified_at: null,
  distance_m: null,
};
const CITY = { place: PLACE, fountains: [FOUNTAIN], indexable: true };

const params = (country: string, place: string, city: string) =>
  Promise.resolve({ country, place, city });

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

function mockResolvedCity(indexable = true) {
  getNestedCityFountainsServer.mockResolvedValue({
    data: { ...CITY, indexable },
    status: 200,
  });
  resolvePlaceServer.mockResolvedValue({
    data: { kind: "region", canonical_path: "/drinking-fountains/us/california", place: REGION },
    status: 200,
  });
}

it("renders the nested city page with parent-region breadcrumbs", async () => {
  mockResolvedCity();

  render(await CityPage({ params: params("us", "california", "san-diego") }));

  expect((await screen.findByRole("heading", { level: 1 })).textContent).toContain("San Diego");
  expect(getNestedCityFountainsServer).toHaveBeenCalledWith(
    "us",
    "california",
    "san-diego",
    expect.any(String),
  );
  expect(await screen.findByText(/12 public drinking fountains/)).toBeTruthy();
  expect(await screen.findByRole("link", { name: /All of California/ })).toHaveAttribute(
    "href",
    "/drinking-fountains/us/california",
  );
  const script = document.querySelector<HTMLScriptElement>('script[type="application/ld+json"]');
  expect(script).not.toBeNull();
  expect(JSON.parse(script?.textContent ?? "{}").itemListElement).toHaveLength(4);
});

it("404s when the nested city does not resolve", async () => {
  getNestedCityFountainsServer.mockResolvedValue({ data: undefined, status: 404 });
  resolvePlaceServer.mockResolvedValue({
    data: { kind: "region", canonical_path: "/drinking-fountains/us/california", place: REGION },
    status: 200,
  });

  await expect(CityPage({ params: params("us", "california", "nowhere") })).rejects.toThrow(
    "NEXT_NOT_FOUND",
  );
  expect(notFound).toHaveBeenCalledOnce();
});

it("308s non-canonical casing to the canonical nested URL", async () => {
  mockResolvedCity();

  await expect(CityPage({ params: params("US", "California", "San-Diego") })).rejects.toThrow(
    "NEXT_REDIRECT:/drinking-fountains/us/california/san-diego",
  );
  expect(permanentRedirect).toHaveBeenCalledWith("/drinking-fountains/us/california/san-diego");
});

it("does not render JSON-LD when the city is noindex", async () => {
  mockResolvedCity(false);

  render(await CityPage({ params: params("us", "california", "san-diego") }));
  await screen.findByRole("heading", { level: 1 });
  expect(document.querySelector('script[type="application/ld+json"]')).toBeNull();
});

it("generateMetadata uses the canonical nested city URL", async () => {
  mockResolvedCity();

  const meta = await generateMetadata({ params: params("us", "california", "san-diego") });
  expect(meta.title).toBe("Drinking fountains in San Diego");
  expect(meta.alternates?.canonical).toBe("/drinking-fountains/us/california/san-diego");
  expect(meta.robots).toBeUndefined();
});

it("builds breadcrumb JSON-LD from the parent region", () => {
  const data = buildCityBreadcrumbStructuredData(PLACE, REGION);
  expect(data.itemListElement).toEqual([
    {
      "@type": "ListItem",
      position: 1,
      name: "FountainRank",
      item: "https://fountainrank.com",
    },
    {
      "@type": "ListItem",
      position: 2,
      name: "Drinking fountains in US",
      item: "https://fountainrank.com/drinking-fountains/us",
    },
    {
      "@type": "ListItem",
      position: 3,
      name: "Drinking fountains in California",
      item: "https://fountainrank.com/drinking-fountains/us/california",
    },
    {
      "@type": "ListItem",
      position: 4,
      name: "Drinking fountains in San Diego",
      item: "https://fountainrank.com/drinking-fountains/us/california/san-diego",
    },
  ]);
});
