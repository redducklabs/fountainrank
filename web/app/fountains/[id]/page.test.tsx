// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const getDetail = vi.fn();
const getAdminDetail = vi.fn();
const getNotes = vi.fn();
const getPhotos = vi.fn();
const getPlaceFn = vi.fn();
const getViewerFn = vi.fn();
const getTokenFn = vi.fn();
const logFn = vi.fn();
const notFoundFn = vi.fn(() => {
  throw new Error("NEXT_NOT_FOUND");
});

vi.mock("../../../lib/fountains", () => ({
  getFountainDetailServer: (...a: unknown[]) => getDetail(...a),
  getFountainNotesServer: (...a: unknown[]) => getNotes(...a),
  getFountainPhotosServer: (...a: unknown[]) => getPhotos(...a),
}));
// Keep the real pure helpers (fountainPath); stub only the public place fetch.
vi.mock("../../../lib/places", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../lib/places")>();
  return { ...actual, getFountainPlaceServer: (...a: unknown[]) => getPlaceFn(...a) };
});
vi.mock("../../../lib/server/admin", () => ({
  getAdminFountainDetailServer: (...a: unknown[]) => getAdminDetail(...a),
}));
vi.mock("../../../lib/server/viewer", () => ({
  getViewer: (...a: unknown[]) => getViewerFn(...a),
}));
vi.mock("../../../lib/server/api", () => ({
  getViewerAccessToken: (...a: unknown[]) => getTokenFn(...a),
}));
vi.mock("../../../lib/server/log", () => ({ log: (...a: unknown[]) => logFn(...a) }));
vi.mock("next/navigation", () => ({ notFound: () => notFoundFn() }));
vi.mock("next/link", () => ({
  default: ({ children, href }: { children: ReactNode; href: string }) => (
    <a href={href}>{children}</a>
  ),
}));
vi.mock("../../../components/admin/FountainAdminControls", () => ({
  FountainAdminControls: () => <div data-testid="admin-controls" />,
}));
vi.mock("../../../components/fountain/FountainDetail", () => ({
  FountainDetail: ({
    notes,
    isAuthenticated,
    adminControls,
    locationLabel,
  }: {
    notes: unknown[];
    isAuthenticated: boolean;
    adminControls?: ReactNode;
    locationLabel?: string;
  }) => (
    <div
      data-testid="detail"
      data-authed={String(isAuthenticated)}
      data-location={locationLabel ?? ""}
    >
      notes:{notes.length}
      {adminControls}
    </div>
  ),
}));
vi.mock("../../../components/contributions/ContributionStatusOverlay", () => ({
  ContributionStatusOverlay: () => <div data-testid="contribution-status" />,
}));
vi.mock("../../../components/SiteHeader", () => ({
  SiteHeader: () => <div data-testid="site-header" />,
}));

import FountainPage, {
  buildFountainBreadcrumbStructuredData,
  buildFountainStructuredData,
  generateMetadata,
} from "./page";

const params = Promise.resolve({ id: "f1" });
const detail = {
  id: "f1",
  location: { latitude: 40.78, longitude: -73.96 },
  is_working: true,
  comments: null,
  average_rating: 4.5,
  rating_count: 8,
  ranking_score: 0.9,
  created_at: "2026-06-01T00:00:00Z",
  last_rated_at: "2026-06-12T00:00:00Z",
  current_status: "ok",
  last_verified_at: "2026-06-12T00:00:00Z",
  placement_note: null,
  dimensions: [],
  attributes: [
    {
      attribute_type_id: 1,
      key: "bottle_filler",
      name: "Bottle filler",
      category: "features",
      consensus_value: "yes",
      confidence: "high",
      yes_count: 5,
      no_count: 0,
      unknown_count: 0,
      value_counts: null,
      observation_count: 5,
      latest_observation_value: "yes",
    },
  ],
};

// A minimal /place response for the h1 + metadata (public data only).
const placeIn = (city: { name: string; country_code: string } | null, indexable: boolean) => ({
  data: {
    fountain_id: "f1",
    city: city
      ? { id: "c1", slug: "manhattan", subtype: "locality", fountain_count: 5, ...city }
      : null,
    country: null,
    indexable,
  },
  status: 200,
});

beforeEach(() => {
  getDetail.mockReset();
  getAdminDetail.mockReset();
  getNotes.mockReset();
  getPhotos.mockReset();
  getPlaceFn.mockReset();
  getViewerFn.mockReset();
  getTokenFn.mockReset();
  logFn.mockReset();
  notFoundFn.mockClear();
  getViewerFn.mockResolvedValue({ state: "anonymous" });
  getTokenFn.mockResolvedValue(null);
  getPhotos.mockResolvedValue({ data: [], status: 200 });
  getDetail.mockResolvedValue({ data: undefined, status: 0 });
  // Default: no place resolved (backend down / no city) — the h1 falls back, metadata noindexes.
  getPlaceFn.mockResolvedValue({ data: undefined, status: 0 });
});

describe("FountainPage route (standalone)", () => {
  it("passes fetched notes through to the detail on success", async () => {
    getDetail.mockResolvedValue({ data: { id: "f1" }, status: 200 });
    getNotes.mockResolvedValue({ data: [{ id: "n1" }, { id: "n2" }], status: 200 });
    render(await FountainPage({ params }));
    expect(await screen.findByTestId("detail")).toHaveTextContent("notes:2");
    expect(logFn).not.toHaveBeenCalled();
  });
  it("non-fatal notes: 503 renders detail with notes=[] and a constrained warn log", async () => {
    getDetail.mockResolvedValue({ data: { id: "f1" }, status: 200 });
    getNotes.mockResolvedValue({ data: undefined, status: 503 });
    render(await FountainPage({ params }));
    expect(await screen.findByTestId("detail")).toHaveTextContent("notes:0");
    expect(logFn).toHaveBeenCalledWith("warn", expect.stringMatching(/notes/i), {
      requestId: expect.any(String),
      id: "f1",
      status: 503,
    });
  });
  it("detail 404 calls notFound() and does not render the detail", async () => {
    getDetail.mockResolvedValue({ data: undefined, status: 404 });
    getNotes.mockResolvedValue({ data: [], status: 200 });
    await expect(FountainPage({ params })).rejects.toThrow("NEXT_NOT_FOUND");
    expect(notFoundFn).toHaveBeenCalled();
  });
  it("detail network failure (!data) renders the error UI, not a blank/crash", async () => {
    getDetail.mockResolvedValue({ data: undefined, status: 0 });
    getNotes.mockResolvedValue({ data: undefined, status: 0 });
    render(await FountainPage({ params }));
    expect(await screen.findByText(/Couldn.t load this fountain/i)).toBeInTheDocument();
  });
  it("passes isAuthenticated=true when viewer.state is authed", async () => {
    getDetail.mockResolvedValue({ data: { id: "f1" }, status: 200 });
    getNotes.mockResolvedValue({ data: [], status: 200 });
    getViewerFn.mockResolvedValue({
      state: "authed",
      displayName: "Sam",
      avatarUrl: null,
      isAdmin: false,
    });
    render(await FountainPage({ params }));
    expect(await screen.findByTestId("detail")).toHaveAttribute("data-authed", "true");
  });
  it("renders contribution status on authenticated standalone pages", async () => {
    getDetail.mockResolvedValue({ data: { id: "f1" }, status: 200 });
    getNotes.mockResolvedValue({ data: [], status: 200 });
    getViewerFn.mockResolvedValue({
      state: "authed",
      displayName: "Sam",
      avatarUrl: null,
      isAdmin: false,
    });
    render(await FountainPage({ params }));
    expect(await screen.findByTestId("contribution-status")).toBeInTheDocument();
  });
  it("passes isAuthenticated=false when viewer.state is anonymous", async () => {
    getDetail.mockResolvedValue({ data: { id: "f1" }, status: 200 });
    getNotes.mockResolvedValue({ data: [], status: 200 });
    getViewerFn.mockResolvedValue({ state: "anonymous" });
    render(await FountainPage({ params }));
    expect(await screen.findByTestId("detail")).toHaveAttribute("data-authed", "false");
  });
  it("forwards the viewer token to the detail fetch when authenticated (#114)", async () => {
    getDetail.mockResolvedValue({ data: { id: "f1" }, status: 200 });
    getNotes.mockResolvedValue({ data: [], status: 200 });
    getViewerFn.mockResolvedValue({
      state: "authed",
      displayName: "Sam",
      avatarUrl: null,
      isAdmin: false,
    });
    getTokenFn.mockResolvedValue("tok-123");
    render(await FountainPage({ params }));
    expect(getDetail).toHaveBeenCalledWith("f1", expect.any(String), "tok-123");
  });
  it("fetches the detail anonymously (null token) when signed out (#114)", async () => {
    getDetail.mockResolvedValue({ data: { id: "f1" }, status: 200 });
    getNotes.mockResolvedValue({ data: [], status: 200 });
    getTokenFn.mockResolvedValue(null);
    render(await FountainPage({ params }));
    expect(getDetail).toHaveBeenCalledWith("f1", expect.any(String), null);
  });
  it("admin viewer uses the admin detail endpoint and renders admin controls", async () => {
    getViewerFn.mockResolvedValue({
      state: "authed",
      displayName: "Mod",
      avatarUrl: null,
      isAdmin: true,
    });
    getAdminDetail.mockResolvedValue({
      data: { id: "f1", notes: [{ id: "hidden-note", is_hidden: true }] },
      status: 200,
    });
    render(await FountainPage({ params }));
    expect(getAdminDetail).toHaveBeenCalledWith("f1", expect.any(String));
    expect(getDetail).not.toHaveBeenCalled();
    expect(getNotes).not.toHaveBeenCalled();
    expect(await screen.findByTestId("detail")).toHaveTextContent("notes:1");
    expect(await screen.findByTestId("admin-controls")).toBeInTheDocument();
  });

  it("passes a city location label to the detail h1 when the place resolves (public data)", async () => {
    getDetail.mockResolvedValue({ data: detail, status: 200 });
    getNotes.mockResolvedValue({ data: [], status: 200 });
    getPlaceFn.mockResolvedValue(placeIn({ name: "Manhattan", country_code: "us" }, true));
    render(await FountainPage({ params }));
    expect(await screen.findByTestId("detail")).toHaveAttribute(
      "data-location",
      "Public drinking fountain in Manhattan",
    );
    // The h1 label uses PUBLIC place data, not the viewer/admin detail path.
    expect(getPlaceFn).toHaveBeenCalledWith("f1", expect.any(String));
  });

  it("links an indexable fountain detail page back to its city page", async () => {
    getDetail.mockResolvedValue({ data: detail, status: 200 });
    getNotes.mockResolvedValue({ data: [], status: 200 });
    getPlaceFn.mockResolvedValue(placeIn({ name: "Manhattan", country_code: "us" }, true));
    render(await FountainPage({ params }));
    expect(
      await screen.findByRole("link", { name: /drinking fountains in Manhattan/i }),
    ).toHaveAttribute("href", "/drinking-fountains/us/manhattan");
  });

  it("renders JSON-LD for indexable public detail pages", async () => {
    getDetail.mockResolvedValue({ data: detail, status: 200 });
    getNotes.mockResolvedValue({ data: [], status: 200 });
    getPlaceFn.mockResolvedValue(placeIn({ name: "Manhattan", country_code: "us" }, true));
    render(await FountainPage({ params }));
    await screen.findByTestId("detail");
    const script = document.querySelector<HTMLScriptElement>('script[type="application/ld+json"]');
    expect(script).not.toBeNull();
    const data = JSON.parse(script?.textContent ?? "[]");
    expect(data).toHaveLength(2);
    expect(data[0]["@type"]).toBe("Place");
    expect(data[1]["@type"]).toBe("BreadcrumbList");
  });

  it("does not render JSON-LD for noindex detail pages", async () => {
    getDetail.mockResolvedValue({ data: detail, status: 200 });
    getNotes.mockResolvedValue({ data: [], status: 200 });
    getPlaceFn.mockResolvedValue(placeIn({ name: "Manhattan", country_code: "us" }, false));
    render(await FountainPage({ params }));
    await screen.findByTestId("detail");
    expect(document.querySelector('script[type="application/ld+json"]')).toBeNull();
  });

  it("does not render JSON-LD for admin detail pages", async () => {
    getViewerFn.mockResolvedValue({
      state: "authed",
      displayName: "Mod",
      avatarUrl: null,
      isAdmin: true,
    });
    getAdminDetail.mockResolvedValue({ data: detail, status: 200 });
    getPlaceFn.mockResolvedValue(placeIn({ name: "Manhattan", country_code: "us" }, true));
    render(await FountainPage({ params }));
    await screen.findByTestId("detail");
    expect(document.querySelector('script[type="application/ld+json"]')).toBeNull();
  });

  it("builds conservative JSON-LD for indexable public detail pages", () => {
    const place = placeIn({ name: "Manhattan", country_code: "us" }, true).data;
    const data = buildFountainStructuredData({ id: "f1", place, detail });
    expect(data["@type"]).toBe("Place");
    expect(data.name).toBe("Public drinking fountain in Manhattan");
    expect(data.geo).toEqual({
      "@type": "GeoCoordinates",
      latitude: 40.78,
      longitude: -73.96,
    });
    expect(data.aggregateRating).toEqual({
      "@type": "AggregateRating",
      ratingValue: 4.5,
      ratingCount: 8,
      bestRating: 5,
      worstRating: 1,
    });
    expect(data.additionalProperty).toContainEqual({
      "@type": "PropertyValue",
      name: "Bottle filler",
      value: "Yes",
    });
  });

  it("builds breadcrumb JSON-LD from home to city to fountain", () => {
    const place = placeIn({ name: "Manhattan", country_code: "us" }, true).data;
    const data = buildFountainBreadcrumbStructuredData({ id: "f1", place });
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
        name: "Drinking fountains in Manhattan",
        item: "https://fountainrank.com/drinking-fountains/us/manhattan",
      },
      {
        "@type": "ListItem",
        position: 3,
        name: "Public drinking fountain in Manhattan",
        item: "https://fountainrank.com/fountains/f1",
      },
    ]);
  });

  it("omits the location label when no city resolves (fallback h1)", async () => {
    getDetail.mockResolvedValue({ data: { id: "f1" }, status: 200 });
    getNotes.mockResolvedValue({ data: [], status: 200 });
    getPlaceFn.mockResolvedValue(placeIn(null, false));
    render(await FountainPage({ params }));
    expect(await screen.findByTestId("detail")).toHaveAttribute("data-location", "");
  });
});

describe("FountainPage generateMetadata", () => {
  it("city + indexable: richer city title, description, canonical, no noindex override", async () => {
    getPlaceFn.mockResolvedValue(placeIn({ name: "Manhattan", country_code: "us" }, true));
    getDetail.mockResolvedValue({ data: detail, status: 200 });
    const meta = await generateMetadata({ params });
    expect(meta.title).toBe("4.5-rated drinking fountain in Manhattan");
    expect(meta.description).toContain("Verified working.");
    expect(meta.description).toContain("Rated 4.5 from 8 ratings.");
    expect(meta.description).toContain("Reported features include bottle filler.");
    expect(meta.alternates?.canonical).toBe("/fountains/f1");
    expect(meta.robots).toBeUndefined();
  });

  it("below the §7 predicate (indexable=false): rendered but noindex, still followable", async () => {
    getPlaceFn.mockResolvedValue(placeIn({ name: "Manhattan", country_code: "us" }, false));
    const meta = await generateMetadata({ params });
    expect(meta.title).toBe("Public drinking fountain in Manhattan");
    expect(meta.robots).toEqual({ index: false, follow: true });
  });

  it("no city resolves: generic title, still canonical", async () => {
    getPlaceFn.mockResolvedValue(placeIn(null, false));
    const meta = await generateMetadata({ params });
    expect(meta.title).toBe("Public drinking fountain");
    expect(meta.alternates?.canonical).toBe("/fountains/f1");
    expect(meta.robots).toEqual({ index: false, follow: true });
  });

  it("hidden / unknown / backend-down (no data): fully noindex, nofollow", async () => {
    getPlaceFn.mockResolvedValue({ data: undefined, status: 404 });
    const meta = await generateMetadata({ params });
    expect(meta.robots).toEqual({ index: false, follow: false });
  });
});
