import type { components } from "@fountainrank/api-client";
import type { AwardedPoints } from "@fountainrank/contributions";
import { QueryClient, QueryObserver } from "@tanstack/react-query";
import { afterEach, describe, expect, it, vi } from "vitest";

import { BBOX_STALE_TIME_MS } from "../map/constants";
import { DEFAULT_FILTERS, fountainsQueryKey } from "../map/filters";
import type { BboxResult } from "../map/pin-cache";
import { handleAddSuccess, seedCachesFromCreatedFountain } from "./seed";

type FountainPin = components["schemas"]["FountainPin"];
type FountainDetail = components["schemas"]["FountainDetail"];

const PARAMS = { min_lat: 47, min_lng: -123, max_lat: 48, max_lng: -122 };

function makePin(id: string, lat: number, lng: number): FountainPin {
  return {
    id,
    location: { latitude: lat, longitude: lng },
    is_working: true,
    average_rating: null,
    rating_count: 0,
  };
}

function makeDetail(id: string, lat: number, lng: number): FountainDetail {
  return {
    id,
    location: { latitude: lat, longitude: lng },
    is_working: true,
    comments: null,
    average_rating: null,
    rating_count: 0,
    ranking_score: null,
    created_at: "2026-07-17T00:00:00Z",
    last_rated_at: null,
    dimensions: [],
    attributes: [],
  };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("seedCachesFromCreatedFountain", () => {
  it("seeds the detail at the authed NON-ADMIN key as the EXACT server object (identity)", () => {
    const client = new QueryClient();
    const detail = makeDetail("f-1", 47.6, -122.4);
    seedCachesFromCreatedFountain(client, detail);
    // Identity, not a copy/reshape — so background revalidation produces no flicker.
    expect(client.getQueryData(["fountain", "f-1", true, "public"])).toBe(detail);
    // The admin key is NOT seeded, so an admin viewer still fetches (accepted limitation).
    expect(client.getQueryData(["fountain", "f-1", true, "admin"])).toBeUndefined();
    client.clear();
  });

  it("inserts the pin into an existing bbox entry but never fabricates a new one", () => {
    const client = new QueryClient();
    const key = fountainsQueryKey(PARAMS, DEFAULT_FILTERS);
    client.setQueryData<BboxResult>(key, { pins: [], truncated: false });
    seedCachesFromCreatedFountain(client, makeDetail("f-1", 47.5, -122.5));
    expect((client.getQueryData(key) as BboxResult).pins.map((p) => p.id)).toEqual(["f-1"]);
    // No cached bbox entry other than the one that already existed.
    const bboxEntries = client
      .getQueriesData({ queryKey: ["fountains", "bbox"] })
      .filter(([, data]) => data !== undefined);
    expect(bboxEntries).toHaveLength(1);
    client.clear();
  });

  it("does not fabricate a bbox entry when none is cached (a future new-key fetch has no seed)", () => {
    const client = new QueryClient();
    seedCachesFromCreatedFountain(client, makeDetail("f-1", 47.5, -122.5));
    const bboxEntries = client
      .getQueriesData({ queryKey: ["fountains", "bbox"] })
      .filter(([, data]) => data !== undefined);
    expect(bboxEntries).toHaveLength(0);
    client.clear();
  });
});

describe("handleAddSuccess", () => {
  it("on a successful create: seeds, then fires the bbox + contributions + fountain-prefix invalidations", () => {
    const client = new QueryClient();
    const spy = vi.spyOn(client, "invalidateQueries");
    const detail = makeDetail("f-1", 47.6, -122.4);
    handleAddSuccess(client, {
      ok: true,
      fountainId: "f-1",
      pointsAwarded: 0 as AwardedPoints,
      detail,
    });
    expect(client.getQueryData(["fountain", "f-1", true, "public"])).toBe(detail);
    expect(spy).toHaveBeenCalledWith({ queryKey: ["fountains", "bbox"] });
    expect(spy).toHaveBeenCalledWith({ queryKey: ["me", "contributions"] });
    expect(spy).toHaveBeenCalledWith({ queryKey: ["fountain", "f-1"] });
    client.clear();
  });

  it("on a duplicate: no seed, still invalidates bbox + contributions, NOT the fountain key", () => {
    const client = new QueryClient();
    const spy = vi.spyOn(client, "invalidateQueries");
    handleAddSuccess(client, { ok: false, error: "duplicate", fountainId: "dup-1" });
    expect(client.getQueryData(["fountain", "dup-1", true, "public"])).toBeUndefined();
    expect(spy).toHaveBeenCalledWith({ queryKey: ["fountains", "bbox"] });
    expect(spy).toHaveBeenCalledWith({ queryKey: ["me", "contributions"] });
    expect(spy).not.toHaveBeenCalledWith({ queryKey: ["fountain", "dup-1"] });
    client.clear();
  });
});

describe("cache behavior at the QueryClient level (spec §2/§3)", () => {
  it("a cached bbox entry that fails its post-seed refetch RETAINS the seeded pin and reports isError", async () => {
    const client = new QueryClient();
    const key = fountainsQueryKey(PARAMS, DEFAULT_FILTERS);
    // A prior successful fetch primed this viewport.
    client.setQueryData<BboxResult>(key, {
      pins: [makePin("existing", 47.5, -122.5)],
      truncated: false,
    });
    // The create seeds the new pin into that cached entry.
    seedCachesFromCreatedFountain(client, makeDetail("new", 47.6, -122.4));

    // A mounted observer whose refetch FAILS. staleTime:Infinity so mount does not refetch;
    // the invalidation below forces the (failing) refetch.
    const queryFn = vi.fn(async (): Promise<BboxResult> => {
      throw new Error("refetch failed");
    });
    const observer = new QueryObserver<BboxResult>(client, {
      queryKey: key,
      queryFn,
      retry: false,
      staleTime: Infinity,
    });
    const unsubscribe = observer.subscribe(() => {});

    await client.invalidateQueries({ queryKey: ["fountains", "bbox"] });
    await vi.waitFor(() => expect(observer.getCurrentResult().isError).toBe(true));

    const result = observer.getCurrentResult();
    expect(result.isError).toBe(true);
    // The seeded pin (and the pre-add pin) survive the failed refetch — the vanish fix.
    expect(result.data?.pins.map((p) => p.id)).toEqual(expect.arrayContaining(["existing", "new"]));
    unsubscribe();
    client.clear();
  });

  it("a NEW-key query that fails substitutes no placeholder data (falls to the no-data error state)", async () => {
    const client = new QueryClient();
    const key = fountainsQueryKey(PARAMS, DEFAULT_FILTERS);
    // No cached data for this key, and seeding fabricated none (tested above).
    const queryFn = vi.fn(async (): Promise<BboxResult> => {
      throw new Error("new-key fetch failed");
    });
    const observer = new QueryObserver<BboxResult>(client, {
      queryKey: key,
      queryFn,
      retry: false,
      placeholderData: (prev) => prev, // keepPreviousData semantics: nothing previous to keep
    });
    const unsubscribe = observer.subscribe(() => {});
    await vi.waitFor(() => expect(observer.getCurrentResult().isError).toBe(true));
    expect(observer.getCurrentResult().data).toBeUndefined();
    unsubscribe();
    client.clear();
  });

  it("bbox staleTime suppresses a refetch on pan-back to a fresh, non-invalidated key", async () => {
    const client = new QueryClient();
    const key = fountainsQueryKey(PARAMS, DEFAULT_FILTERS);
    const queryFn = vi.fn(async (): Promise<BboxResult> => ({ pins: [], truncated: false }));

    const first = new QueryObserver<BboxResult>(client, {
      queryKey: key,
      queryFn,
      staleTime: BBOX_STALE_TIME_MS,
    });
    const unsub1 = first.subscribe(() => {});
    await vi.waitFor(() => expect(first.getCurrentResult().isSuccess).toBe(true));
    expect(queryFn).toHaveBeenCalledTimes(1);
    unsub1();

    // Pan away and back within the stale window: a fresh observer on the same key must NOT refetch.
    const second = new QueryObserver<BboxResult>(client, {
      queryKey: key,
      queryFn,
      staleTime: BBOX_STALE_TIME_MS,
    });
    const unsub2 = second.subscribe(() => {});
    await Promise.resolve();
    await Promise.resolve();
    expect(queryFn).toHaveBeenCalledTimes(1);
    unsub2();
    client.clear();
  });
});
