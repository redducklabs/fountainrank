import type { components } from "@fountainrank/api-client";
import type { QueryClient } from "@tanstack/react-query";

import { fountainPinFromDetail, insertPinIntoBboxCaches } from "../map/pin-cache";
import type { AddFountainResult } from "./state";

type FountainDetail = components["schemas"]["FountainDetail"];

/**
 * Seed the caches from the full detail the create POST already returned (spec §3), so the newly
 * added fountain cannot vanish when a subsequent refetch fails and the post-add detail screen
 * renders without a blocking round-trip.
 *
 * 1. Detail cache — the authenticated NON-ADMIN key `["fountain", id, true, "public"]`. The adder
 *    is authenticated by construction; a non-admin post-add detail screen renders instantly. The
 *    detail is stored UNMODIFIED (the exact server object) so the kept background revalidation
 *    produces no flicker. Admins read the `"admin"` key, so they still fetch (accepted limitation).
 * 2. Map-pin cache — insert a `FountainPin` built from the detail into every cached bbox entry that
 *    contains it (default filters only), via the pure `insertPinIntoBboxCaches` helper. A cached
 *    entry that later fails its refetch retains this seeded pin, so the pin cannot vanish.
 */
export function seedCachesFromCreatedFountain(
  queryClient: QueryClient,
  detail: FountainDetail,
): void {
  queryClient.setQueryData(["fountain", detail.id, true, "public"], detail);
  const pin = fountainPinFromDetail(detail);
  const entries = queryClient.getQueriesData({ queryKey: ["fountains", "bbox"] });
  for (const [key, data] of insertPinIntoBboxCaches(entries, pin)) {
    queryClient.setQueryData(key, data);
  }
}

/**
 * The add mutation's `onSuccess` effect (spec §3): on a successful create, seed the detail + pin
 * caches FIRST, then invalidate exactly as before so eventual server consistency remains the end
 * state (invalidation overrides `staleTime`, and the kept `["fountain", id]` prefix invalidation
 * revalidates the seeded detail). The bbox + contributions invalidations fire on every resolved
 * mutation (including a duplicate); the fountain-prefix invalidation only on a real create.
 */
export function handleAddSuccess(queryClient: QueryClient, result: AddFountainResult): void {
  if (result.ok) {
    seedCachesFromCreatedFountain(queryClient, result.detail);
  }
  void queryClient.invalidateQueries({ queryKey: ["fountains", "bbox"] });
  void queryClient.invalidateQueries({ queryKey: ["me", "contributions"] });
  if (result.ok) {
    void queryClient.invalidateQueries({ queryKey: ["fountain", result.fountainId] });
  }
}
