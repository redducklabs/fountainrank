// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import type { ReactNode } from "react";
import { cleanup, render, screen } from "@testing-library/react";

const { getFountainsByAttributeServer } = vi.hoisted(() => ({
  getFountainsByAttributeServer: vi.fn(),
}));

vi.mock("../../lib/places", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../lib/places")>();
  return { ...actual, getFountainsByAttributeServer };
});
vi.mock("next/link", () => ({
  default: ({ children, href }: { children: ReactNode; href: string }) => (
    <a href={href}>{children}</a>
  ),
}));
vi.mock("../../components/SiteHeader", () => ({ SiteHeader: () => <div data-testid="hdr" /> }));
vi.mock("../../lib/server/log", () => ({ log: vi.fn() }));

import WheelchairPage, { generateMetadata } from "./page";

const RESULT = {
  attribute: "wheelchair_reachable",
  fountains: [
    {
      id: "f9",
      location: { latitude: 0, longitude: 0 },
      is_working: true,
      average_rating: 4.0,
      rating_count: 3,
      ranking_score: 0.7,
      current_status: null,
      last_verified_at: null,
      distance_m: null,
    },
  ],
  total_count: 15,
  indexable: true,
};

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

it("fetches wheelchair_reachable and renders its heading + fountain links", async () => {
  getFountainsByAttributeServer.mockResolvedValue({ data: RESULT, status: 200 });

  render(await WheelchairPage());

  expect(getFountainsByAttributeServer).toHaveBeenCalledWith(
    "wheelchair_reachable",
    expect.any(String),
  );
  expect((await screen.findByRole("heading", { level: 1 })).textContent).toMatch(/wheelchair/i);
  expect(
    (await screen.findByRole("link", { name: /Drinking fountain/ })).getAttribute("href"),
  ).toBe("/fountains/f9");
});

it("generateMetadata: title + canonical + indexable above the gate", async () => {
  getFountainsByAttributeServer.mockResolvedValue({ data: RESULT, status: 200 });

  const meta = await generateMetadata();
  expect(meta.title).toMatch(/wheelchair/i);
  expect(meta.alternates?.canonical).toBe("/wheelchair-accessible-drinking-fountains");
  expect(meta.robots).toBeUndefined();
});

it("generateMetadata: noindex when below the thin-content gate", async () => {
  getFountainsByAttributeServer.mockResolvedValue({
    data: { ...RESULT, total_count: 0, indexable: false },
    status: 200,
  });

  const meta = await generateMetadata();
  expect(meta.robots).toEqual({ index: false, follow: true });
});
