import type { components } from "@fountainrank/api-client";

export type AdminContributionEvent = components["schemas"]["AdminContributionEventOut"];

const EVENT_LABELS: Record<string, string> = {
  add_fountain: "Added fountain",
  rate: "Rated fountain",
  verify_working: "Verified working status",
  report_condition: "Reported condition",
  observe_attribute: "Observed attribute",
  add_note: "Added note",
  add_photo: "Added photo",
  first_fountain_bonus: "First fountain bonus",
  first_in_area_bonus: "First in area bonus",
  first_rating_bonus: "First rating bonus",
};

export function contributionEventLabel(eventType: string): string {
  return EVENT_LABELS[eventType] ?? eventType.replaceAll("_", " ");
}

export function signedContributionPoints(points: number, status: "awarded" | "reversed"): string {
  const value = status === "reversed" ? -Math.abs(points) : points;
  return `${value >= 0 ? "+" : ""}${value}`;
}
