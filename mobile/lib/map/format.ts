const one = (n: number) => n.toFixed(1);
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** Map rating pill label, e.g. "★ 4.2"; null when unrated (no pill drawn). */
export const formatPill = (avg: number | null) => (avg == null ? null : `★ ${one(avg)}`);

export const formatAverage = (avg: number | null) => (avg == null ? "Not yet rated" : one(avg));
export const formatVotes = (n: number) => `${n} ${n === 1 ? "rating" : "ratings"}`;
export const formatDimension = (avg: number | null, votes: number) =>
  avg == null ? "Not yet rated" : `★ ${one(avg)} (${votes})`;
export const formatDate = (iso: string) => {
  const d = new Date(iso);
  return `${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
};

export type StatusTone = "ok" | "warn" | "bad";
export interface StatusDisplay {
  chipLabel: string;
  chipTone: StatusTone;
  advisory: string | null;
}

const baseline = (isWorking: boolean): { chipLabel: string; chipTone: StatusTone } =>
  isWorking
    ? { chipLabel: "Working", chipTone: "ok" }
    : { chipLabel: "Out of order", chipTone: "bad" };

// `reported_issue` is a NON-flipping advisory — preserve the is_working baseline chip and
// surface the advisory separately. `null`/unexpected also fall back to the baseline.
export function statusDisplay(
  currentStatus: string | null | undefined,
  isWorking: boolean,
): StatusDisplay {
  switch (currentStatus) {
    case "ok":
      return { chipLabel: "Verified working", chipTone: "ok", advisory: null };
    case "degraded":
      return { chipLabel: "Working — issues reported", chipTone: "warn", advisory: null };
    case "not_working":
      return { chipLabel: "Not working", chipTone: "bad", advisory: null };
    case "reported_issue":
      return { ...baseline(isWorking), advisory: "Issue reported recently — not yet confirmed" };
    default:
      return { ...baseline(isWorking), advisory: null };
  }
}

// Day-resolution absolute date (UTC), e.g. "Jun 12, 2026" — precise enough for a trust/audit label.
export const formatDateFull = (iso: string) => {
  const d = new Date(iso);
  return `${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()}, ${d.getUTCFullYear()}`;
};

export function formatRelativeTime(iso: string, now: Date): string {
  const sec = Math.floor((now.getTime() - new Date(iso).getTime()) / 1000);
  if (sec < 60) return "just now"; // also the future/skew clamp (sec < 0)
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min} ${min === 1 ? "minute" : "minutes"} ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr} ${hr === 1 ? "hour" : "hours"} ago`;
  const day = Math.floor(hr / 24);
  if (day < 7) return `${day} ${day === 1 ? "day" : "days"} ago`;
  if (day < 28) {
    const wk = Math.floor(day / 7);
    return `${wk} ${wk === 1 ? "week" : "weeks"} ago`;
  }
  return formatDateFull(iso);
}

export const attributeValueLabel = (value: string): string => {
  if (value === "yes") return "Yes";
  if (value === "no") return "No";
  if (value === "unknown") return "Unknown";
  const spaced = value.replace(/_/g, " ");
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
};

export type AttrTone = "normal" | "muted" | "mixed";
export interface AttributeDisplay {
  text: string;
  tone: AttrTone;
  hint: string | null;
}

export function attributeDisplay(attr: {
  consensus_value: string | null;
  confidence: string;
  observation_count: number;
  latest_observation_value: string | null;
}): AttributeDisplay {
  const { consensus_value, confidence, observation_count, latest_observation_value } = attr;
  if (consensus_value != null) {
    if (confidence === "low") {
      const n = observation_count;
      return {
        text: attributeValueLabel(consensus_value),
        tone: "muted",
        hint: `(${n} ${n === 1 ? "report" : "reports"})`,
      };
    }
    return { text: attributeValueLabel(consensus_value), tone: "normal", hint: null };
  }
  if (confidence === "mixed") {
    return {
      text: "Mixed",
      tone: "mixed",
      hint:
        latest_observation_value != null
          ? `latest: ${attributeValueLabel(latest_observation_value)}`
          : null,
    };
  }
  return { text: "Unknown", tone: "muted", hint: null };
}

export type StarFill = "full" | "half" | "empty";
/** Discrete per-star fills for a 0–5 rating, rounded to the nearest half star. */
export function starFills(value: number): StarFill[] {
  const v = Math.max(0, Math.min(5, Math.round(value * 2) / 2));
  return Array.from({ length: 5 }, (_, i) => {
    const slot = i + 1;
    if (v >= slot) return "full";
    if (v >= slot - 0.5) return "half";
    return "empty";
  });
}

export type ChipVariant = "positive" | "negative" | "unknown" | "mixed" | "neutral";
/** Maps an attributeDisplay result to a chip style/icon variant (tone-aware). */
export function attributeChipVariant(d: { text: string; tone: AttrTone }): ChipVariant {
  if (d.tone === "mixed") return "mixed";
  if (d.text === "Yes") return "positive";
  if (d.text === "No") return "negative";
  if (d.text === "Unknown") return "unknown";
  return "neutral";
}

const CATEGORY_LABELS: Record<string, string> = {
  physical: "Features",
  accessibility: "Accessibility",
  access: "Access",
};

export function formatCategory(key: string): string {
  if (CATEGORY_LABELS[key]) return CATEGORY_LABELS[key];
  const spaced = key.replace(/_/g, " ");
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}
