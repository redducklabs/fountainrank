import type { components } from "@fountainrank/api-client";
import type { AwardedPoints } from "@fountainrank/contributions";

export type AddFountainInput = {
  location: { latitude: number; longitude: number };
  is_working: boolean;
  comments?: string | null;
  ratings?: { rating_type_id: number; stars: number }[];
  observations?: { attribute_type_id: number; value: string }[];
};

export type AddFountainError = "unauthenticated" | "validation" | "needs_name" | "server";
export type AddFountainResult =
  // pointsAwarded (#204): the server's actual award, which INCLUDES the conditional
  // first_fountain / first_in_area bonuses the client cannot predict. Previously the add-fountain
  // award was never returned to the client at all, so it celebrated with no number.
  | { ok: true; fountainId: string; pointsAwarded: AwardedPoints }
  | { ok: false; error: "duplicate"; fountainId: string }
  | { ok: false; error: AddFountainError };

export const COMMENTS_MAX = 1000;

const UUID_RE = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

export function isUuid(v: unknown): v is string {
  return typeof v === "string" && UUID_RE.test(v);
}

// A Server Action argument is client-originated regardless of its TS type — validate as hostile
// before any API call (spec §8). Returns true only when every field is well-formed.
export function isValidAddFountainInput(input: AddFountainInput): boolean {
  if (!input || typeof input !== "object" || Array.isArray(input)) return false;
  const loc = input.location;
  if (!loc || typeof loc !== "object" || Array.isArray(loc)) return false;
  const { latitude, longitude } = loc;
  if (!Number.isFinite(latitude) || latitude < -90 || latitude > 90) return false;
  if (!Number.isFinite(longitude) || longitude < -180 || longitude > 180) return false;
  if (typeof input.is_working !== "boolean") return false;
  if (input.comments != null) {
    if (typeof input.comments !== "string") return false;
    if (input.comments.trim().length > COMMENTS_MAX) return false;
  }
  if (input.ratings != null) {
    if (!Array.isArray(input.ratings)) return false;
    for (const r of input.ratings) {
      if (!r || typeof r !== "object") return false;
      if (!Number.isInteger(r.rating_type_id) || r.rating_type_id <= 0) return false;
      if (!Number.isInteger(r.stars) || r.stars < 1 || r.stars > 5) return false;
    }
  }
  if (input.observations != null) {
    if (!Array.isArray(input.observations)) return false;
    for (const o of input.observations) {
      if (!o || typeof o !== "object") return false;
      if (!Number.isInteger(o.attribute_type_id) || o.attribute_type_id <= 0) return false;
      if (typeof o.value !== "string" || o.value.trim().length === 0) return false;
    }
  }
  return true;
}

// Assemble the API body, dropping empty optionals (spec §8 step 3).
export function toAddFountainBody(
  input: AddFountainInput,
): components["schemas"]["AddFountainRequest"] {
  const body: components["schemas"]["AddFountainRequest"] = {
    location: { latitude: input.location.latitude, longitude: input.location.longitude },
    is_working: input.is_working,
  };
  const comments = input.comments?.trim();
  if (comments) body.comments = comments;
  if (input.ratings && input.ratings.length) body.ratings = input.ratings;
  if (input.observations && input.observations.length) body.observations = input.observations;
  return body;
}
