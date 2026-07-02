import { describe, expect, it } from "vitest";

import {
  deriveDebounceKey,
  initialSearchState,
  MIN_QUERY_LENGTH,
  nextRequestSeq,
  normalizeSearchQuery,
  searchReducer,
  type SearchResultItem,
} from "./state";

describe("normalizeSearchQuery", () => {
  it("trims leading/trailing whitespace", () => {
    expect(normalizeSearchQuery("  Main St  ")).toBe("Main St");
  });
});

describe("searchReducer - query normalization + min-length gate", () => {
  it("stays idle and issues no request below the 3-char minimum", () => {
    const state = searchReducer(initialSearchState, { type: "queryChanged", query: "  ab" });
    expect(state.status).toBe("idle");
    expect(state.query).toBe("  ab");
    expect(state.results).toEqual([]);
    expect(state.errorReason).toBeNull();
  });

  it("treats a query of only whitespace as below the minimum", () => {
    const state = searchReducer(initialSearchState, { type: "queryChanged", query: "   " });
    expect(state.status).toBe("idle");
  });

  it("does not force idle once the trimmed query reaches the 3-char minimum", () => {
    // Reaching the minimum only means a request MAY be dispatched (the caller
    // decides via meetsMinLength/nextRequestSeq) - it does not itself change status.
    const loading = searchReducer(initialSearchState, { type: "requestStarted", seq: 1 });
    const state = searchReducer(loading, { type: "queryChanged", query: "abc" });
    expect(state.status).toBe("loading");
    expect(state.query).toBe("abc");
  });

  it("MIN_QUERY_LENGTH is 3", () => {
    expect(MIN_QUERY_LENGTH).toBe(3);
  });
});

describe("deriveDebounceKey", () => {
  it("returns null below the minimum length (no debounce/search should fire)", () => {
    expect(deriveDebounceKey("  ab")).toBeNull();
    expect(deriveDebounceKey("")).toBeNull();
  });

  it("returns the normalized (trimmed) query once at/above the minimum", () => {
    expect(deriveDebounceKey("  Main St  ")).toBe("Main St");
  });

  it("produces the same key for inputs that normalize the same (trailing space typed/removed)", () => {
    expect(deriveDebounceKey("Main St")).toBe(deriveDebounceKey("Main St "));
  });
});

describe("nextRequestSeq", () => {
  it("starts at 1 from the initial state", () => {
    expect(nextRequestSeq(initialSearchState)).toBe(1);
  });

  it("increments from the current state.seq", () => {
    const started = searchReducer(initialSearchState, { type: "requestStarted", seq: 1 });
    expect(nextRequestSeq(started)).toBe(2);
  });
});

describe("searchReducer - monotonic sequence stale-drop", () => {
  const item: SearchResultItem = { id: "1,2,0", label: "Main St", latitude: 1, longitude: 2 };

  it("applies a result whose seq matches the latest dispatched request", () => {
    const started = searchReducer(initialSearchState, { type: "requestStarted", seq: 1 });
    const state = searchReducer(started, {
      type: "resultsReceived",
      seq: 1,
      results: [item],
    });
    expect(state.status).toBe("results");
    expect(state.results).toEqual([item]);
  });

  it("drops an older-seq response after a newer request has started (no out-of-order overwrite)", () => {
    // Two requests dispatched in a row (seq 1 then seq 2) before either resolves.
    const afterFirst = searchReducer(initialSearchState, { type: "requestStarted", seq: 1 });
    const afterSecond = searchReducer(afterFirst, { type: "requestStarted", seq: 2 });
    expect(afterSecond.status).toBe("loading");

    // The slow seq=1 response arrives late and must be dropped.
    const afterStaleResult = searchReducer(afterSecond, {
      type: "resultsReceived",
      seq: 1,
      results: [item],
    });
    expect(afterStaleResult.status).toBe("loading");
    expect(afterStaleResult.results).toEqual([]);

    // The current seq=2 response arrives next and IS applied.
    const afterCurrentResult = searchReducer(afterStaleResult, {
      type: "resultsReceived",
      seq: 2,
      results: [item],
    });
    expect(afterCurrentResult.status).toBe("results");
    expect(afterCurrentResult.results).toEqual([item]);
  });

  it("drops an older-seq error the same way a stale result is dropped", () => {
    const afterFirst = searchReducer(initialSearchState, { type: "requestStarted", seq: 1 });
    const afterSecond = searchReducer(afterFirst, { type: "requestStarted", seq: 2 });
    const afterStaleError = searchReducer(afterSecond, {
      type: "requestFailed",
      seq: 1,
      reason: "unavailable",
    });
    expect(afterStaleError.status).toBe("loading");
    expect(afterStaleError.errorReason).toBeNull();
  });

  it("bumps seq on a valid-to-valid query change, dropping a stale in-flight response for the old query", () => {
    const typedMain = searchReducer(initialSearchState, { type: "queryChanged", query: "main" });
    const loading = searchReducer(typedMain, { type: "requestStarted", seq: 1 });
    expect(loading.status).toBe("loading");

    const retyped = searchReducer(loading, { type: "queryChanged", query: "main st" });
    expect(retyped.status).toBe("loading");
    expect(retyped.seq).not.toBe(loading.seq);

    const afterStaleResult = searchReducer(retyped, {
      type: "resultsReceived",
      seq: 1,
      results: [item],
    });
    expect(afterStaleResult).toBe(retyped);
    expect(afterStaleResult.status).toBe("loading");
    expect(afterStaleResult.results).toEqual([]);
  });

  it("does not bump seq for a keystroke that doesn't change the normalized query (trailing space)", () => {
    const typedMain = searchReducer(initialSearchState, {
      type: "queryChanged",
      query: "main st",
    });
    const loading = searchReducer(typedMain, { type: "requestStarted", seq: 1 });

    const trailingSpace = searchReducer(loading, { type: "queryChanged", query: "main st " });
    expect(trailingSpace.seq).toBe(loading.seq);
    expect(trailingSpace.status).toBe("loading");

    // The still-in-flight response for the (effectively unchanged) query is NOT
    // stale and must still apply - no needless invalidation.
    const applied = searchReducer(trailingSpace, {
      type: "resultsReceived",
      seq: 1,
      results: [item],
    });
    expect(applied.status).toBe("results");
    expect(applied.results).toEqual([item]);
  });
});

describe("searchReducer - result set to results/empty", () => {
  it("maps a non-empty result array to status results", () => {
    const started = searchReducer(initialSearchState, { type: "requestStarted", seq: 1 });
    const state = searchReducer(started, {
      type: "resultsReceived",
      seq: 1,
      results: [{ id: "1,2,0", label: "Main St", latitude: 1, longitude: 2 }],
    });
    expect(state.status).toBe("results");
  });

  it("maps an empty result array to status empty", () => {
    const started = searchReducer(initialSearchState, { type: "requestStarted", seq: 1 });
    const state = searchReducer(started, { type: "resultsReceived", seq: 1, results: [] });
    expect(state.status).toBe("empty");
    expect(state.results).toEqual([]);
  });
});

describe("searchReducer - error", () => {
  it("maps a matching-seq failure to status error carrying the reason", () => {
    const started = searchReducer(initialSearchState, { type: "requestStarted", seq: 1 });
    const state = searchReducer(started, {
      type: "requestFailed",
      seq: 1,
      reason: "unavailable",
    });
    expect(state.status).toBe("error");
    expect(state.errorReason).toBe("unavailable");
    expect(state.results).toEqual([]);
  });
});

describe("searchReducer - stale response dropped after abandoning the query below the minimum", () => {
  const item: SearchResultItem = { id: "1,2,0", label: "Main St", latitude: 1, longitude: 2 };

  it("ignores a resultsReceived for the seq that was in flight when the query was abandoned", () => {
    const loading = searchReducer(initialSearchState, { type: "requestStarted", seq: 1 });
    const abandoned = searchReducer(loading, { type: "queryChanged", query: "ab" });
    expect(abandoned.status).toBe("idle");

    const afterLateResult = searchReducer(abandoned, {
      type: "resultsReceived",
      seq: 1,
      results: [item],
    });
    expect(afterLateResult.status).toBe("idle");
    expect(afterLateResult.results).toEqual([]);
  });
});

describe("searchReducer - reset", () => {
  it("returns to the initial idle state", () => {
    const started = searchReducer(initialSearchState, { type: "requestStarted", seq: 1 });
    const withResults = searchReducer(started, {
      type: "resultsReceived",
      seq: 1,
      results: [{ id: "1,2,0", label: "Main St", latitude: 1, longitude: 2 }],
    });
    const state = searchReducer(withResults, { type: "reset" });
    expect(state).toEqual(initialSearchState);
  });
});

describe("SearchResultItem - optional boundingBox (§2/§4.1)", () => {
  it("accepts an item with no boundingBox (provider hit had none)", () => {
    const item: SearchResultItem = { id: "1,2,0", label: "Main St", latitude: 1, longitude: 2 };
    expect(item.boundingBox).toBeUndefined();
  });

  it("accepts an item carrying a boundingBox", () => {
    const item: SearchResultItem = {
      id: "1,2,0",
      label: "Springfield",
      latitude: 1,
      longitude: 2,
      boundingBox: { south: 0, west: 1, north: 2, east: 3 },
    };
    expect(item.boundingBox).toEqual({ south: 0, west: 1, north: 2, east: 3 });
  });
});
