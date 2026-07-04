// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import type { ReactNode } from "react";
import { cleanup, render, screen } from "@testing-library/react";

const { getFountainsByAttributeServer } = vi.hoisted(() => ({
  getFountainsByAttributeServer: vi.fn(),
}));

vi.mock("../../../lib/places", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../lib/places")>();
  return { ...actual, getFountainsByAttributeServer };
});
vi.mock("next/link", () => ({
  default: ({ children, href }: { children: ReactNode; href: string }) => (
    <a href={href}>{children}</a>
  ),
}));
vi.mock("../../../components/SiteHeader", () => ({ SiteHeader: () => <div data-testid="hdr" /> }));
vi.mock("../../../lib/server/log", () => ({ log: vi.fn() }));

import BottleFillersPage, { generateMetadata } from "./page";

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
const RESULT = {
  attribute: "bottle_filler",
  fountains: [FOUNTAIN],
  total_count: 42,
  indexable: true,
};

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

it("renders the heading, count, and ranked fountain links", async () => {
  getFountainsByAttributeServer.mockResolvedValue({ data: RESULT, status: 200 });

  render(await BottleFillersPage());

  expect((await screen.findByRole("heading", { level: 1 })).textContent).toMatch(/bottle filler/i);
  expect(await screen.findByText(/42/)).toBeTruthy();
  const link = await screen.findByRole("link", { name: /Drinking fountain/ });
  expect(link.getAttribute("href")).toBe("/fountains/f1");
});

it("fetches the bottle_filler attribute specifically", async () => {
  getFountainsByAttributeServer.mockResolvedValue({ data: RESULT, status: 200 });

  render(await BottleFillersPage());

  expect(getFountainsByAttributeServer).toHaveBeenCalledWith("bottle_filler", expect.any(String));
});

it("generateMetadata: title + canonical + indexable (no noindex) when above the gate", async () => {
  getFountainsByAttributeServer.mockResolvedValue({ data: RESULT, status: 200 });

  const meta = await generateMetadata();
  expect(meta.title).toMatch(/bottle filler/i);
  expect(meta.alternates?.canonical).toBe("/drinking-fountains/bottle-fillers");
  expect(meta.robots).toBeUndefined();
});

it("generateMetadata: noindex when below the thin-content gate (not indexable)", async () => {
  getFountainsByAttributeServer.mockResolvedValue({
    data: { ...RESULT, total_count: 1, indexable: false },
    status: 200,
  });

  const meta = await generateMetadata();
  expect(meta.robots).toEqual({ index: false, follow: true });
  expect(meta.alternates?.canonical).toBe("/drinking-fountains/bottle-fillers");
});

it("generateMetadata: noindex when the backend is unreachable", async () => {
  getFountainsByAttributeServer.mockResolvedValue({ data: undefined, status: 0 });

  const meta = await generateMetadata();
  expect(meta.robots).toEqual({ index: false, follow: true });
});

it("renders an error state (not the list) when the backend is unreachable", async () => {
  getFountainsByAttributeServer.mockResolvedValue({ data: undefined, status: 0 });

  render(await BottleFillersPage());
  expect(await screen.findByText(/couldn.t load/i)).toBeTruthy();
});
