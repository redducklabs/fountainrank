import { QueryClient, QueryObserver, skipToken } from "@tanstack/react-query";
import { describe, expect, it, vi } from "vitest";

import { profileTabIcon } from "../../lib/auth/profile-tab-icon";
import type { MeProfile } from "../../lib/auth/profile";

const PROFILE: MeProfile = {
  id: "11111111-1111-1111-1111-111111111111",
  display_name: "Aron",
  email: "aron@example.com",
  avatar_url: "https://example.com/avatar.jpg",
  is_admin: false,
  created_at: "2026-01-01T00:00:00Z",
  needs_name: false,
};

/**
 * `ProfileTabIcon` reads the `["me"]` query via `useQuery({ queryKey: ["me"], queryFn: skipToken
 * })`. `useQuery` is a thin React wrapper over `@tanstack/query-core`'s `QueryObserver`, so these
 * tests exercise the exact same cache-subscription mechanics the component relies on directly against
 * `QueryObserver`, without a React Native renderer. A full component-render version of this test
 * (mounting `<ProfileTabIcon />` with `@testing-library/react-native`) was written during
 * implementation but could not be committed: this repo has no React Native component-render test
 * infrastructure for any package - `@testing-library/react-native`/`react-test-renderer` are not
 * resolved anywhere in `pnpm-lock.yaml`, and adding them was out of scope (see task-7-report.md
 * "Concerns"). The image-vs-glyph decision itself is exhaustively unit-tested in
 * `../../lib/auth/profile-tab-icon.test.ts`; this file proves the surrounding "no stray fetch, but
 * still reactive" cache contract the component depends on.
 */
describe('["me"] cache subscription contract behind ProfileTabIcon', () => {
  it("never invokes a queryFn while the observer is disabled", async () => {
    const queryFn = vi.fn();
    const client = new QueryClient();
    const observer = new QueryObserver<MeProfile>(client, {
      queryKey: ["me"],
      enabled: false,
      queryFn,
    });
    const unsubscribe = observer.subscribe(() => {});
    // Flush any microtask-queued fetch so a would-be fetch has a chance to run before we assert.
    await Promise.resolve();
    await Promise.resolve();
    expect(queryFn).not.toHaveBeenCalled();
    unsubscribe();
  });

  it("re-renders glyph -> image when NameGate populates the shared cache", () => {
    const client = new QueryClient();
    const observer = new QueryObserver<MeProfile>(client, {
      queryKey: ["me"],
      queryFn: skipToken,
    });
    const seen: ("image" | "glyph")[] = [];
    const unsubscribe = observer.subscribe((result) => {
      seen.push(profileTabIcon(result.data?.avatar_url, false));
    });

    // Before NameGate's fetch resolves, the cache is empty -> glyph.
    expect(profileTabIcon(observer.getCurrentResult().data?.avatar_url, false)).toBe("glyph");

    // NameGate's own (enabled) observer populates the same ["me"] cache entry.
    client.setQueryData(["me"], PROFILE);

    expect(seen).toContain("image");
    expect(profileTabIcon(observer.getCurrentResult().data?.avatar_url, false)).toBe("image");
    unsubscribe();
  });

  it("documents that removeQueries alone does not clear an already-mounted observer's last result", () => {
    // NOTE (see task-7-report.md "Concerns"): `removeQueries` deletes the cache *entry*, but does
    // not itself notify an already-mounted observer that still holds a reference to the
    // (now-detached) Query instance - verified here, and this is general `@tanstack/query-core`
    // behavior, not specific to `enabled: false` (an `enabled: true` observer exhibits the same
    // thing absent an explicit refetch). Concretely: `account.tsx`'s `clearProfile()` calls
    // `queryClient.removeQueries({ queryKey: ["me"] })` on sign-out, so `ProfileTabIcon`'s
    // disabled observer keeps showing the previous session's avatar until the *next* successful
    // sign-in's `setQueryData` call overwrites it (see the reactivity test above) or the app
    // restarts. `account.tsx` itself is unaffected because it branches on `auth.status`, never on
    // stale query data. This is a minor, self-healing, non-security gap (an avatar photo is not
    // secret, and browsing is already public) flagged for the team rather than silently patched
    // outside this task's file scope.
    const client = new QueryClient();
    client.setQueryData(["me"], PROFILE);
    const observer = new QueryObserver<MeProfile>(client, {
      queryKey: ["me"],
      queryFn: skipToken,
    });
    expect(profileTabIcon(observer.getCurrentResult().data?.avatar_url, false)).toBe("image");

    client.removeQueries({ queryKey: ["me"] });

    expect(profileTabIcon(observer.getCurrentResult().data?.avatar_url, false)).toBe("image");
  });
});
