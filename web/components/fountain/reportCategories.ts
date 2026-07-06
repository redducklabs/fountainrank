// Shared, environment-agnostic report-category vocabulary (#11). Imported by BOTH the client
// report UI (`ReportContentDialog` / `ReportControl`) and the server `reportContent` action so
// the categories a frontend offers and the set the action validates against never drift. Keep
// this module free of `"use client"`/`server-only` imports so it stays importable from either
// side. The DB CHECK + backend chokepoint remain the ultimate backstop (spec §6).
export type ReportContentType = "photo" | "note" | "fountain";

// Per-type allowed categories (spec §6). Order is the display order in the dialog select.
export const REPORT_CATEGORIES: Record<ReportContentType, readonly string[]> = {
  photo: ["inappropriate", "not_a_fountain", "spam", "other"],
  note: ["spam", "abuse", "inappropriate", "inaccurate", "other"],
  fountain: ["not_a_fountain", "spam", "inappropriate", "inaccurate", "other"],
};

// Human labels for every category in the superset CHECK; the dialog maps a `categories` value
// through this to render each `<option>`.
export const REPORT_CATEGORY_LABELS: Record<string, string> = {
  inappropriate: "Inappropriate",
  not_a_fountain: "Not a fountain",
  spam: "Spam",
  abuse: "Abuse",
  inaccurate: "Inaccurate",
  other: "Other",
};
