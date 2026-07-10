"use client";
import { createContext, useCallback, useContext, useMemo, useState } from "react";

// Only the fields the draft actually needs (the dirty check + building the rating payload). The full
// DimensionSummary from FountainDetail is structurally assignable to this.
type Dimension = { rating_type_id: number; your_rating?: number | null };

type RatingDraft = {
  /** The dimensions the draft is for — carried here so PhotoUpload (which has no dimensions prop)
   *  can run the dirty check when deciding whether to flush the rating before uploading (#1). */
  dimensions: Dimension[];
  /** The user's explicit star taps, keyed by rating_type_id (not merged with your_rating). */
  edits: Record<number, number>;
  setEdit: (ratingTypeId: number, value: number) => void;
  clear: () => void;
};

const RatingDraftContext = createContext<RatingDraft | null>(null);

/** Read the rating draft lifted above the detail tabs. Throws outside a RatingDraftProvider. */
export function useRatingDraft(): RatingDraft {
  const ctx = useContext(RatingDraftContext);
  if (!ctx) throw new Error("useRatingDraft must be used within RatingDraftProvider");
  return ctx;
}

/** Holds the unsaved rating draft above the tabs so "Add photo" — which lives in a separate tab from
 *  the rating form — can submit it before uploading (#1). Mirrors the useFountainDetailTabs pattern. */
export function RatingDraftProvider({
  dimensions,
  children,
}: {
  dimensions: Dimension[];
  children: React.ReactNode;
}) {
  const [edits, setEdits] = useState<Record<number, number>>({});
  // Stable identities so a consumer that keys an effect on setEdit/clear (or the value object) does
  // not re-run every render — an unmemoized setEdit caused an infinite effect loop in tests.
  const setEdit = useCallback(
    (ratingTypeId: number, value: number) =>
      setEdits((current) => ({ ...current, [ratingTypeId]: value })),
    [],
  );
  const clear = useCallback(() => setEdits({}), []);
  const value = useMemo(
    () => ({ dimensions, edits, setEdit, clear }),
    [dimensions, edits, setEdit, clear],
  );
  return <RatingDraftContext.Provider value={value}>{children}</RatingDraftContext.Provider>;
}
