import type { components } from "@fountainrank/api-client";

type ConditionStatus = components["schemas"]["ConditionReportRequest"]["status"];

const CONDITION_LABELS = {
  working: "It's working",
  broken: "Broken / not working",
  low_pressure: "Low water pressure",
  dirty: "Dirty",
  bad_taste: "Bad taste",
  blocked: "Blocked / clogged",
  seasonal_unavailable: "Shut off for the season",
  hours_limited: "Only available certain hours",
} satisfies Record<ConditionStatus, string>;

export const CONDITION_STATUSES = Object.keys(CONDITION_LABELS) as ConditionStatus[];

export const PROBLEM_CONDITION_STATUSES = CONDITION_STATUSES.filter(
  (status): status is Exclude<ConditionStatus, "working"> => status !== "working",
);

const CONDITION_STATUS_SET: ReadonlySet<string> = new Set(CONDITION_STATUSES);

export function conditionStatusLabel(status: ConditionStatus): string {
  return CONDITION_LABELS[status];
}

export function isConditionStatus(status: string): status is ConditionStatus {
  return CONDITION_STATUS_SET.has(status);
}
