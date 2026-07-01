// Pure state helpers for the map search overlay (spec §7.1/§7.2). No React, no
// network - the overlay (Task 11) owns dispatch, debouncing, and the actual
// `AbortController`/`fetch`; this module only decides what the UI should show
// and which stale responses to ignore.

/** The trimmed query must reach this length before a request is dispatched. */
export const MIN_QUERY_LENGTH = 3;

export type SearchStatus = "idle" | "loading" | "results" | "empty" | "error";

/**
 * v1 has a single error condition end-to-end (spec §7.1: "Search is
 * unavailable right now") covering a `503`/`502`/`429`/network failure alike -
 * see `map-search/query.ts` `mapGeocodeError`. Kept as a union (not a bare
 * string literal) so a future distinct reason is a type-level addition, not a
 * silent string typo.
 */
export type SearchErrorReason = "unavailable";

export type SearchResultItem = {
  id: string;
  label: string;
  latitude: number;
  longitude: number;
};

export type SearchState = {
  status: SearchStatus;
  /** The raw (un-normalized) text currently in the input. */
  query: string;
  /**
   * The seq of the latest request dispatched via `requestStarted` (0 = none
   * yet). Also bumped (without a `requestStarted`) by `queryChanged` whenever
   * the EFFECTIVE (normalized) query changes - not only when it drops below
   * the minimum length - so a response still in flight for the
   * just-abandoned query can no longer match and is dropped - see the
   * stale-response guard in `resultsReceived`/`requestFailed`. A keystroke
   * that doesn't change the normalized query (e.g. a trailing space typed
   * then removed) does NOT bump `seq`, to avoid needlessly invalidating a
   * request that is still relevant.
   */
  seq: number;
  results: SearchResultItem[];
  errorReason: SearchErrorReason | null;
};

export const initialSearchState: SearchState = {
  status: "idle",
  query: "",
  seq: 0,
  results: [],
  errorReason: null,
};

export type SearchAction =
  | { type: "queryChanged"; query: string }
  | { type: "requestStarted"; seq: number }
  | { type: "resultsReceived"; seq: number; results: SearchResultItem[] }
  | { type: "requestFailed"; seq: number; reason: SearchErrorReason }
  | { type: "reset" };

/** Trim-only normalization - the single definition of "what the query means". */
export function normalizeSearchQuery(raw: string): string {
  return raw.trim();
}

export function meetsMinLength(query: string): boolean {
  return normalizeSearchQuery(query).length >= MIN_QUERY_LENGTH;
}

/**
 * The key the overlay's debounce effect should key off of, instead of the raw
 * input value: `null` below the minimum length (no debounce timer, no
 * request - callers gate on this), otherwise the normalized query. Two raw
 * inputs that normalize the same (e.g. a trailing space typed then removed)
 * derive the same key, so they don't spuriously restart the debounce/re-fire
 * a request for an unchanged effective query.
 */
export function deriveDebounceKey(query: string): string | null {
  const normalized = normalizeSearchQuery(query);
  return normalized.length >= MIN_QUERY_LENGTH ? normalized : null;
}

/**
 * The seq value the caller should dispatch on the NEXT `requestStarted`
 * action - purely derived from state so the counter needs no external mutable
 * closure. Monotonically increasing: each request gets a strictly higher seq
 * than every previous one, which is what makes the stale-drop comparison in
 * `searchReducer` correct.
 */
export function nextRequestSeq(state: SearchState): number {
  return state.seq + 1;
}

export function searchReducer(state: SearchState, action: SearchAction): SearchState {
  switch (action.type) {
    case "queryChanged": {
      // Bump `seq` whenever the EFFECTIVE (normalized) query changes - not only
      // when it drops below the minimum length - so a response still in flight
      // for the now-abandoned query can no longer match the current seq and is
      // dropped by the stale-response guard in `resultsReceived`/`requestFailed`
      // below. A keystroke that doesn't change the normalized query (e.g. a
      // trailing space typed then removed) leaves seq untouched, so a request
      // still relevant to the (unchanged) effective query isn't invalidated.
      const effectiveQueryChanged =
        normalizeSearchQuery(action.query) !== normalizeSearchQuery(state.query);
      const seq = effectiveQueryChanged ? state.seq + 1 : state.seq;
      if (!meetsMinLength(action.query)) {
        return {
          ...state,
          query: action.query,
          status: "idle",
          results: [],
          errorReason: null,
          seq,
        };
      }
      return { ...state, query: action.query, seq };
    }
    case "requestStarted":
      return { ...state, seq: action.seq, status: "loading", errorReason: null };
    case "resultsReceived": {
      // Stale-response guard (spec §7.1): a response is applied only if its
      // seq is the latest dispatched - an older/slower response never
      // overwrites newer results.
      if (action.seq !== state.seq) return state;
      return {
        ...state,
        status: action.results.length > 0 ? "results" : "empty",
        results: action.results,
        errorReason: null,
      };
    }
    case "requestFailed": {
      if (action.seq !== state.seq) return state;
      return { ...state, status: "error", errorReason: action.reason, results: [] };
    }
    case "reset":
      return initialSearchState;
  }
}
