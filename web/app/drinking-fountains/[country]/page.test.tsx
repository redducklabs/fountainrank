// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import type { ReactNode } from "react";
import { cleanup, render, screen } from "@testing-library/react";

const { getCountriesServer, getCountryCitiesServer, getCountryRegionsServer } = vi.hoisted(() => ({
  getCountriesServer: vi.fn(),
  getCountryCitiesServer: vi.fn(),
  getCountryRegionsServer: vi.fn(),
}));
const { notFound } = vi.hoisted(() => ({
  notFound: vi.fn(() => {
    throw new Error("NEXT_NOT_FOUND");
  }),
}));

// Keep the real pure path helpers (countryPath/cityPath); stub only the server fetches.
vi.mock("../../../lib/places", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../lib/places")>();
  return { ...actual, getCountriesServer, getCountryCitiesServer, getCountryRegionsServer };
});
vi.mock("next/navigation", () => ({ notFound }));
vi.mock("next/link", () => ({
  default: ({ children, href }: { children: ReactNode; href: string }) => (
    <a href={href}>{children}</a>
  ),
}));
vi.mock("../../../components/SiteHeader", () => ({ SiteHeader: () => <div data-testid="hdr" /> }));
vi.mock("../../../lib/server/log", () => ({ log: vi.fn() }));

import CountryPage, { generateMetadata } from "./page";

const US = {
  id: "00000000-0000-0000-0000-0000000000us",
  parent_id: null,
  country_code: "us",
  slug: "united-states",
  name: "United States",
  subtype: "country",
  place_kind: "country",
  fountain_count: 1234,
  indexable: true,
};
const CALIFORNIA = {
  id: "00000000-0000-0000-0000-00000000cali",
  parent_id: US.id,
  country_code: "us",
  slug: "california",
  name: "California",
  subtype: "administrative",
  place_kind: "region",
  fountain_count: 100,
  indexable: true,
};
const SAN_DIEGO = {
  id: "00000000-0000-0000-0000-00000000sdgo",
  parent_id: CALIFORNIA.id,
  country_code: "us",
  slug: "san-diego",
  name: "San Diego",
  subtype: "locality",
  place_kind: "city",
  fountain_count: 42,
  indexable: true,
};

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

it("renders the country name, count, and links to regions when present", async () => {
  getCountriesServer.mockResolvedValue({ data: [US], status: 200 });
  getCountryRegionsServer.mockResolvedValue({ data: [CALIFORNIA], status: 200 });
  getCountryCitiesServer.mockResolvedValue({ data: [SAN_DIEGO], status: 200 });

  render(await CountryPage({ params: Promise.resolve({ country: "us" }) }));

  expect((await screen.findByRole("heading", { level: 1 })).textContent).toContain("United States");
  expect(await screen.findByText(/1,234/)).toBeTruthy();
  const regionLink = await screen.findByRole("link", { name: "California" });
  expect(regionLink.getAttribute("href")).toBe("/drinking-fountains/us/california");
  expect(screen.getByText(/100 fountains/)).toBeTruthy();
  expect(screen.queryByRole("link", { name: "San Diego" })).toBeNull();
  // ItemList of the listed child places (regions), each linking to its region page.
  const itemList = Array.from(
    document.querySelectorAll<HTMLScriptElement>('script[type="application/ld+json"]'),
  )
    .map((s) => JSON.parse(s.textContent ?? "{}"))
    .find((s) => s["@type"] === "ItemList");
  expect(itemList?.itemListElement).toEqual([
    {
      "@type": "ListItem",
      position: 1,
      url: "https://fountainrank.com/drinking-fountains/us/california",
    },
  ]);
});

it("falls back to two-level city links when a country has no regions", async () => {
  getCountriesServer.mockResolvedValue({ data: [US], status: 200 });
  getCountryRegionsServer.mockResolvedValue({ data: [], status: 200 });
  getCountryCitiesServer.mockResolvedValue({ data: [SAN_DIEGO], status: 200 });

  render(await CountryPage({ params: Promise.resolve({ country: "us" }) }));

  const cityLink = await screen.findByRole("link", { name: "San Diego" });
  expect(cityLink.getAttribute("href")).toBe("/drinking-fountains/us/san-diego");
  // ItemList of the listed child places (two-level cities), each linking to its city page.
  const itemList = Array.from(
    document.querySelectorAll<HTMLScriptElement>('script[type="application/ld+json"]'),
  )
    .map((s) => JSON.parse(s.textContent ?? "{}"))
    .find((s) => s["@type"] === "ItemList");
  expect(itemList?.itemListElement).toEqual([
    {
      "@type": "ListItem",
      position: 1,
      url: "https://fountainrank.com/drinking-fountains/us/san-diego",
    },
  ]);
});

it("emits no structured data for a rendered-but-noindex country", async () => {
  getCountriesServer.mockResolvedValue({ data: [{ ...US, indexable: false }], status: 200 });
  getCountryRegionsServer.mockResolvedValue({ data: [CALIFORNIA], status: 200 });
  getCountryCitiesServer.mockResolvedValue({ data: [SAN_DIEGO], status: 200 });

  render(await CountryPage({ params: Promise.resolve({ country: "us" }) }));

  await screen.findByRole("heading", { level: 1 });
  // A below-gate country still renders, but both the BreadcrumbList and the ItemList are gated on
  // indexability, so it emits no structured data at all.
  expect(document.querySelector('script[type="application/ld+json"]')).toBeNull();
});

it("resolves the country segment case-insensitively", async () => {
  getCountriesServer.mockResolvedValue({ data: [US], status: 200 });
  getCountryRegionsServer.mockResolvedValue({ data: [], status: 200 });
  getCountryCitiesServer.mockResolvedValue({ data: [], status: 200 });

  render(await CountryPage({ params: Promise.resolve({ country: "US" }) }));
  expect((await screen.findByRole("heading", { level: 1 })).textContent).toContain("United States");
});

it("404s an unknown or below-gate country", async () => {
  getCountriesServer.mockResolvedValue({ data: [], status: 200 });

  await expect(CountryPage({ params: Promise.resolve({ country: "zz" }) })).rejects.toThrow(
    "NEXT_NOT_FOUND",
  );
  expect(notFound).toHaveBeenCalledOnce();
});

it("generateMetadata: title + canonical for a known country", async () => {
  getCountriesServer.mockResolvedValue({ data: [US], status: 200 });

  const meta = await generateMetadata({ params: Promise.resolve({ country: "us" }) });
  expect(meta.title).toBe("Public drinking fountains in United States — 1,234 mapped");
  expect(meta.alternates?.canonical).toBe("/drinking-fountains/us");
  expect(meta.description).toContain("United States");
  expect(meta.robots).toBeUndefined();
});

it("generateMetadata: noindex for a known but not-ready country", async () => {
  getCountriesServer.mockResolvedValue({ data: [{ ...US, indexable: false }], status: 200 });

  const meta = await generateMetadata({ params: Promise.resolve({ country: "us" }) });
  expect(meta.title).toBe("Public drinking fountains in United States — 1,234 mapped");
  expect(meta.alternates?.canonical).toBe("/drinking-fountains/us");
  expect(meta.robots).toEqual({ index: false, follow: true });
});

it("generateMetadata: noindex for an unknown country", async () => {
  getCountriesServer.mockResolvedValue({ data: [], status: 200 });

  const meta = await generateMetadata({ params: Promise.resolve({ country: "zz" }) });
  expect(meta.robots).toEqual({ index: false, follow: false });
  expect(meta.alternates?.canonical).toBeUndefined();
});
