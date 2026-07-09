// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import type { ReactNode } from "react";
import { cleanup, render, screen } from "@testing-library/react";

const { getCityFountainsServer } = vi.hoisted(() => ({ getCityFountainsServer: vi.fn() }));
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
  return { ...actual, getCityFountainsServer };
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

import CityPage, { buildCityBreadcrumbStructuredData, generateMetadata } from "./page";

const PLACE = {
  id: "p1",
  country_code: "us",
  slug: "san-diego",
  name: "San Diego",
  subtype: "locality",
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

const params = (country: string, city: string) => Promise.resolve({ country, city });

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

it("renders the city name, count, and ranked fountain links", async () => {
  getCityFountainsServer.mockResolvedValue({ data: CITY, status: 200 });

  render(await CityPage({ params: params("us", "san-diego") }));

  expect((await screen.findByRole("heading", { level: 1 })).textContent).toContain("San Diego");
  expect(await screen.findByText(/12 public drinking fountains/)).toBeTruthy();
  expect(await screen.findByText(/community rating, working status, and location/i)).toBeTruthy();
  const fountainLink = await screen.findByRole("link", { name: /Drinking fountain/ });
  expect(fountainLink.getAttribute("href")).toBe("/fountains/f1");
  expect(screen.getByText(/8 ratings/)).toBeTruthy();
});

it("404s when the city does not resolve", async () => {
  getCityFountainsServer.mockResolvedValue({ data: undefined, status: 404 });

  await expect(CityPage({ params: params("us", "nowhere") })).rejects.toThrow("NEXT_NOT_FOUND");
  expect(notFound).toHaveBeenCalledOnce();
});

it("301s a non-canonical (uppercase) URL to the canonical lowercase slug", async () => {
  getCityFountainsServer.mockResolvedValue({ data: CITY, status: 200 });

  await expect(CityPage({ params: params("US", "San-Diego") })).rejects.toThrow(
    "NEXT_REDIRECT:/drinking-fountains/us/san-diego",
  );
  expect(permanentRedirect).toHaveBeenCalledWith("/drinking-fountains/us/san-diego");
});

it("renders an error (not a 404) when the backend is unreachable", async () => {
  getCityFountainsServer.mockResolvedValue({ data: undefined, status: 0 });

  render(await CityPage({ params: params("us", "san-diego") }));
  expect(await screen.findByText(/Couldn.t load this city/)).toBeTruthy();
  expect(notFound).not.toHaveBeenCalled();
});

it("generateMetadata: title + canonical + indexable for a ready city", async () => {
  getCityFountainsServer.mockResolvedValue({ data: CITY, status: 200 });

  const meta = await generateMetadata({ params: params("us", "san-diego") });
  expect(meta.title).toBe("Drinking fountains in San Diego");
  expect(meta.alternates?.canonical).toBe("/drinking-fountains/us/san-diego");
  expect(meta.description).toContain("public drinking fountains and water bottle refill stations");
  expect(meta.description).toContain("community ratings, working status, and locations");
  expect(meta.robots).toBeUndefined(); // indexable -> no noindex override
});

it("builds breadcrumb JSON-LD for a city page", () => {
  const data = buildCityBreadcrumbStructuredData(PLACE);
  expect(data["@type"]).toBe("BreadcrumbList");
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
      name: "Drinking fountains in San Diego",
      item: "https://fountainrank.com/drinking-fountains/us/san-diego",
    },
  ]);
});

it("generateMetadata: noindex when below the thin-content gate", async () => {
  // This also covers a not-ready scope (#127 Slice 1e): the readiness gate is entirely backend —
  // a not-ready scope makes the backend return `indexable: false` on the exact same field, so it
  // is behaviorally identical here to the below-K case. No separate web-side assertion is needed.
  getCityFountainsServer.mockResolvedValue({
    data: { ...CITY, indexable: false },
    status: 200,
  });

  const meta = await generateMetadata({ params: params("us", "san-diego") });
  expect(meta.robots).toEqual({ index: false, follow: true });
  expect(meta.alternates?.canonical).toBe("/drinking-fountains/us/san-diego");
});

it("generateMetadata: noindex for an unknown city (404)", async () => {
  getCityFountainsServer.mockResolvedValue({ data: undefined, status: 404 });

  const meta = await generateMetadata({ params: params("us", "nowhere") });
  expect(meta.robots).toEqual({ index: false, follow: false });
});
