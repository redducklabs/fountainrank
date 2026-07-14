// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import type { ReactNode } from "react";
import { cleanup, render, screen } from "@testing-library/react";

const { getCountriesServer, getCountryCitiesServer, getCountryRegionsServer } = vi.hoisted(() => ({
  getCountriesServer: vi.fn(),
  getCountryCitiesServer: vi.fn(),
  getCountryRegionsServer: vi.fn(),
}));

vi.mock("../../lib/places", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../lib/places")>();
  return {
    ...actual,
    getCountriesServer,
    getCountryCitiesServer,
    getCountryRegionsServer,
  };
});
vi.mock("next/link", () => ({
  default: ({ children, href }: { children: ReactNode; href: string }) => (
    <a href={href}>{children}</a>
  ),
}));
vi.mock("../../components/SiteHeader", () => ({ SiteHeader: () => <div data-testid="hdr" /> }));
vi.mock("../../lib/server/log", () => ({ log: vi.fn() }));

import NearMePage, { generateMetadata } from "./page";

const US = {
  id: "1",
  parent_id: null,
  country_code: "us",
  slug: "united-states",
  name: "United States",
  subtype: "country",
  place_kind: "country",
  fountain_count: 100,
};
const CA = {
  id: "r1",
  parent_id: "1",
  country_code: "us",
  slug: "california",
  name: "California",
  subtype: "administrative",
  place_kind: "region",
  fountain_count: 90,
};
const SD = {
  id: "c1",
  parent_id: "r1",
  country_code: "us",
  slug: "san-diego",
  name: "San Diego",
  subtype: "locality",
  place_kind: "city",
  fountain_count: 40,
};

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

it("renders the heading, a map deep-link, and top cities of the busiest country", async () => {
  getCountriesServer.mockResolvedValue({ data: [US], status: 200 });
  getCountryRegionsServer.mockResolvedValue({ data: [CA], status: 200 });
  getCountryCitiesServer.mockResolvedValue({ data: [SD], status: 200 });

  render(await NearMePage());

  expect((await screen.findByRole("heading", { level: 1 })).textContent).toMatch(/near me/i);
  // A deep-link into the map (which geolocates the visitor).
  const mapLink = await screen.findByRole("link", { name: /map/i });
  expect(mapLink.getAttribute("href")).toBe("/");
  // Top cities of the most-populous country, linked to their city pages.
  const city = await screen.findByRole("link", { name: "San Diego" });
  expect(city.getAttribute("href")).toBe("/drinking-fountains/us/california/san-diego");
});

it("still renders (map link, no crash) when no places are loaded yet", async () => {
  getCountriesServer.mockResolvedValue({ data: [], status: 200 });

  render(await NearMePage());
  expect((await screen.findByRole("heading", { level: 1 })).textContent).toMatch(/near me/i);
  expect((await screen.findByRole("link", { name: /map/i })).getAttribute("href")).toBe("/");
  // No country loaded -> we never ask for its cities.
  expect(getCountryRegionsServer).not.toHaveBeenCalled();
  expect(getCountryCitiesServer).not.toHaveBeenCalled();
});

it("generateMetadata: title + canonical, always indexable (static hub page)", async () => {
  const meta = await generateMetadata();
  expect(meta.title).toMatch(/near me/i);
  expect(meta.alternates?.canonical).toBe("/drinking-fountains-near-me");
  expect(meta.robots).toBeUndefined();
});
