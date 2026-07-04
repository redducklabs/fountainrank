// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import type { ReactNode } from "react";
import { cleanup, render, screen } from "@testing-library/react";

const { getCountriesServer, getCountryCitiesServer } = vi.hoisted(() => ({
  getCountriesServer: vi.fn(),
  getCountryCitiesServer: vi.fn(),
}));
const { notFound } = vi.hoisted(() => ({
  notFound: vi.fn(() => {
    throw new Error("NEXT_NOT_FOUND");
  }),
}));

// Keep the real pure path helpers (countryPath/cityPath); stub only the server fetches.
vi.mock("../../../lib/places", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../lib/places")>();
  return { ...actual, getCountriesServer, getCountryCitiesServer };
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
  country_code: "us",
  slug: "united-states",
  name: "United States",
  subtype: "country",
  fountain_count: 1234,
};
const SAN_DIEGO = {
  id: "00000000-0000-0000-0000-00000000sdgo",
  country_code: "us",
  slug: "san-diego",
  name: "San Diego",
  subtype: "locality",
  fountain_count: 42,
};

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

it("renders the country name, count, and links to top cities", async () => {
  getCountriesServer.mockResolvedValue({ data: [US], status: 200 });
  getCountryCitiesServer.mockResolvedValue({ data: [SAN_DIEGO], status: 200 });

  render(await CountryPage({ params: Promise.resolve({ country: "us" }) }));

  expect((await screen.findByRole("heading", { level: 1 })).textContent).toContain("United States");
  expect(await screen.findByText(/1,234/)).toBeTruthy();
  // Cities now link to their pages (Slice 3 shipped them).
  const cityLink = await screen.findByRole("link", { name: "San Diego" });
  expect(cityLink.getAttribute("href")).toBe("/drinking-fountains/us/san-diego");
  expect(screen.getByText(/42 fountains/)).toBeTruthy();
});

it("resolves the country segment case-insensitively", async () => {
  getCountriesServer.mockResolvedValue({ data: [US], status: 200 });
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
  expect(meta.title).toBe("Drinking fountains in United States");
  expect(meta.alternates?.canonical).toBe("/drinking-fountains/us");
  expect(meta.description).toContain("United States");
});

it("generateMetadata: noindex for an unknown country", async () => {
  getCountriesServer.mockResolvedValue({ data: [], status: 200 });

  const meta = await generateMetadata({ params: Promise.resolve({ country: "zz" }) });
  expect(meta.robots).toEqual({ index: false, follow: false });
  expect(meta.alternates?.canonical).toBeUndefined();
});
