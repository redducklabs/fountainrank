"use client";
// The ever-present web header search box (design doc
// docs/specs/2026-07-01-web-search-and-mobile-polish-design.md §4.1/§4.2). Debounced,
// abortable geocode lookups driven by the shared pure `lib/search/state` reducer (identical
// contract to mobile's `lib/map-search/state`); on select it writes the canonical
// `flyto`/`bbox` query-string contract (`lib/search/flyto.ts`) and navigates to the
// map-relative `/` so a selection works from any page, not just the map page itself.
//
// This component owns the reducer, the debounce timer, the `AbortController`, and the
// dropdown open/highlight state - `lib/search/state.ts` only decides WHAT to show.

import { useEffect, useReducer, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { mapGeocodeError, searchGeocode } from "../lib/search/geocode-client";
import { buildFlyToQuery } from "../lib/search/flyto";
import {
  deriveDebounceKey,
  initialSearchState,
  nextRequestSeq,
  searchReducer,
  type SearchResultItem,
  type SearchState,
} from "../lib/search/state";

/** Mirrors mobile's SearchOverlay - the same LocationIQ ToS attribution page (spec §12). */
const ATTRIBUTION_URL = "https://locationiq.com/attribution";
const DEBOUNCE_MS = 300;

export function HeaderSearch() {
  const router = useRouter();
  const [state, dispatch] = useReducer(searchReducer, initialSearchState);
  const [open, setOpen] = useState(false);
  const [highlight, setHighlight] = useState(-1);
  const containerRef = useRef<HTMLDivElement>(null);

  // Reset the keyboard highlight whenever a NEW result set arrives, without a
  // `useEffect` (React's "adjust state during render" pattern - see
  // https://react.dev/learn/you-might-not-need-an-effect#adjusting-some-state-when-a-prop-changes -
  // an effect here would be a same-render "setState synchronously within an effect" cascade for
  // no benefit, since `state.results` only changes via `dispatch`, which already happens inside
  // event handlers/timer callbacks, never mid-render).
  const [syncedResults, setSyncedResults] = useState(state.results);
  if (syncedResults !== state.results) {
    setSyncedResults(state.results);
    setHighlight(-1);
  }

  // Updated after every render (no dep array) so the debounce effect below can read the
  // CURRENT seq without depending on `state` itself - mirrors
  // mobile/app/(tabs)/index.tsx's `searchStateRef` (and its doc comment): `state` changes as a
  // *result* of the debounce effect (dispatching requestStarted/resultsReceived), so including
  // it as a dependency would tear down and restart the debounce/abort purely because of the
  // response it just received.
  const stateRef = useRef(state);
  useEffect(() => {
    stateRef.current = state;
  });

  // Debounced, abortable geocode request. Keyed off `deriveDebounceKey` (not the raw query) so
  // an edit that normalizes to the same trimmed text doesn't restart the timer/cancel the
  // in-flight request for an unchanged effective query.
  const debounceKey = deriveDebounceKey(state.query);
  useEffect(() => {
    if (debounceKey == null) return;
    const controller = new AbortController();
    const seq = nextRequestSeq(stateRef.current);
    const timer = setTimeout(() => {
      dispatch({ type: "requestStarted", seq });
      searchGeocode({ q: debounceKey }, controller.signal)
        .then((results) => {
          dispatch({ type: "resultsReceived", seq, results });
        })
        .catch((error: unknown) => {
          // An aborted request's rejection carries no useful reason - it was superseded, not
          // "failed"; the stale-seq guard in the reducer would drop it anyway, but skip the
          // dispatch entirely for clarity.
          if (controller.signal.aborted) return;
          dispatch({ type: "requestFailed", seq, reason: mapGeocodeError(error) });
        });
    }, DEBOUNCE_MS);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [debounceKey]);

  // Click-away: mirrors AuthControl.tsx's proven document-mousedown + Escape pattern.
  useEffect(() => {
    if (!open) return;
    function onDocMouseDown(e: MouseEvent) {
      if (!containerRef.current?.contains(e.target as Node)) setOpen(false);
    }
    function onDocKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onDocMouseDown);
    document.addEventListener("keydown", onDocKeyDown);
    return () => {
      document.removeEventListener("mousedown", onDocMouseDown);
      document.removeEventListener("keydown", onDocKeyDown);
    };
  }, [open]);

  function select(item: SearchResultItem) {
    setOpen(false);
    setHighlight(-1);
    const query = buildFlyToQuery({
      lng: item.longitude,
      lat: item.latitude,
      bbox: item.boundingBox,
    });
    router.push(`/?${query}`);
  }

  const showDropdown = open && state.status !== "idle";
  const activeOptionId =
    state.status === "results" && highlight >= 0 && highlight < state.results.length
      ? `header-search-option-${state.results[highlight].id}`
      : undefined;

  return (
    <div
      ref={containerRef}
      className="relative w-full"
      // Blur/Tab-away dismiss: a mousedown-driven close (above) never sees a plain Tab key
      // press, so this covers the keyboard-only "tab past the search box" case. `relatedTarget`
      // is the element ABOUT to receive focus; if it's still inside this box (e.g. a result
      // row), keep the dropdown open so the click/Enter selection isn't lost mid-flight.
      onBlur={(e) => {
        const next = e.relatedTarget as Node | null;
        if (next && containerRef.current?.contains(next)) return;
        setOpen(false);
      }}
    >
      <label htmlFor="header-search-input" className="sr-only">
        Search address or city
      </label>
      <input
        id="header-search-input"
        type="text"
        role="combobox"
        aria-expanded={showDropdown}
        aria-controls="header-search-listbox"
        aria-autocomplete="list"
        aria-activedescendant={activeOptionId}
        placeholder="Search address or city"
        autoComplete="off"
        autoCorrect="off"
        spellCheck={false}
        value={state.query}
        onChange={(e) => {
          dispatch({ type: "queryChanged", query: e.target.value });
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onKeyDown={(e) => {
          if (e.key === "Escape") {
            setOpen(false);
            return;
          }
          if (state.status !== "results") return;
          if (e.key === "ArrowDown") {
            e.preventDefault();
            setOpen(true);
            setHighlight((i) => (i + 1 >= state.results.length ? 0 : i + 1));
          } else if (e.key === "ArrowUp") {
            e.preventDefault();
            setOpen(true);
            setHighlight((i) => (i - 1 < 0 ? state.results.length - 1 : i - 1));
          } else if (e.key === "Enter" && highlight >= 0 && highlight < state.results.length) {
            e.preventDefault();
            select(state.results[highlight]!);
          }
        }}
        className="w-full rounded-full border border-white/30 bg-white/10 px-4 py-2 text-sm text-white placeholder-white/60 outline-none transition focus-visible:border-white focus-visible:bg-white/20 focus-visible:ring-2 focus-visible:ring-white/60"
      />
      {showDropdown && (
        <div
          id="header-search-listbox"
          role="listbox"
          aria-label="Search results"
          className="absolute inset-x-0 top-full z-50 mt-2 max-h-80 overflow-auto rounded-lg border border-slate-200 bg-white text-left shadow-lg"
        >
          <SearchDropdownBody state={state} highlight={highlight} onSelect={select} />
        </div>
      )}
    </div>
  );
}

function SearchDropdownBody({
  state,
  highlight,
  onSelect,
}: {
  state: SearchState;
  highlight: number;
  onSelect: (item: SearchResultItem) => void;
}) {
  switch (state.status) {
    case "idle":
      return null;
    case "loading":
      return (
        <p role="status" className="px-4 py-3 text-sm text-slate-500">
          Searching…
        </p>
      );
    case "empty":
      return <p className="px-4 py-3 text-sm text-slate-500">No matches</p>;
    case "error":
      return (
        <p role="alert" className="px-4 py-3 text-sm text-red-600">
          Search is unavailable right now
        </p>
      );
    case "results":
      return (
        <>
          <ul>
            {state.results.map((item, index) => (
              <li key={item.id}>
                <button
                  id={`header-search-option-${item.id}`}
                  type="button"
                  role="option"
                  aria-selected={index === highlight}
                  onClick={() => onSelect(item)}
                  className={
                    "block w-full px-4 py-2 text-left text-sm text-slate-700 hover:bg-slate-50 focus-visible:bg-slate-50 focus-visible:outline-none" +
                    (index === highlight ? " bg-slate-50" : "")
                  }
                >
                  {item.label}
                </button>
              </li>
            ))}
          </ul>
          <SearchAttribution />
        </>
      );
  }
}

/** Persistent, tappable attribution shown whenever results render (spec §12/§4.1). */
function SearchAttribution() {
  return (
    <p className="border-t border-slate-100 px-4 py-2 text-xs text-slate-400">
      <a
        href={ATTRIBUTION_URL}
        target="_blank"
        rel="noopener noreferrer"
        className="font-semibold text-[#0C44A0] underline"
      >
        Search by LocationIQ
      </a>
      {" · © OpenStreetMap contributors"}
    </p>
  );
}
