import type { components } from "@fountainrank/api-client";

type AddFountainRequest = components["schemas"]["AddFountainRequest"];
export type AttributeTypeOut = components["schemas"]["AttributeTypeOut"];
export type RatingTypeOut = components["schemas"]["RatingTypeOut"];

export type AddFountainInput = {
  location: { latitude: number; longitude: number };
  is_working: boolean;
  comments?: string | null;
  ratings?: { rating_type_id: number; stars: number }[];
  observations?: { attribute_type_id: number; value: string }[];
};

export type BuildResult<T> = { ok: true; value: T } | { ok: false };

function positiveInteger(value: number): boolean {
  return Number.isInteger(value) && value > 0;
}

function validLocation(location: AddFountainInput["location"]): boolean {
  return (
    location != null &&
    typeof location === "object" &&
    !Array.isArray(location) &&
    Number.isFinite(location.latitude) &&
    location.latitude >= -90 &&
    location.latitude <= 90 &&
    Number.isFinite(location.longitude) &&
    location.longitude >= -180 &&
    location.longitude <= 180
  );
}

export function legalAttributeValue(type: AttributeTypeOut, value: string): boolean {
  if (value === "unknown") return true;
  if (type.value_kind === "boolean") return value === "yes" || value === "no";
  if (type.value_kind === "enum") return Boolean(type.allowed_values?.includes(value));
  return false;
}

export function attributeOptions(type: AttributeTypeOut): string[] {
  if (type.value_kind === "enum") return [...(type.allowed_values ?? []), "unknown"];
  return ["yes", "no", "unknown"];
}

export function buildAttributeGroups(attributeTypes: AttributeTypeOut[]) {
  const sorted = [...attributeTypes]
    .filter((type) => type.place_type === "fountain")
    .sort((a, b) => a.sort_order - b.sort_order);
  const categories: string[] = [];
  const grouped = new Map<string, AttributeTypeOut[]>();
  for (const type of sorted) {
    if (!grouped.has(type.category)) {
      grouped.set(type.category, []);
      categories.push(type.category);
    }
    grouped.get(type.category)!.push(type);
  }
  return categories.map((category) => ({ category, items: grouped.get(category)! }));
}

export function buildRatingsFromStars(
  ratingTypes: RatingTypeOut[],
  starsByRatingType: Record<number, number | undefined>,
): { rating_type_id: number; stars: number }[] {
  const typeIds = new Set(ratingTypes.map((type) => type.id));
  return Object.entries(starsByRatingType)
    .map(([id, stars]) => ({ rating_type_id: Number(id), stars }))
    .filter(
      (rating): rating is { rating_type_id: number; stars: number } =>
        typeIds.has(rating.rating_type_id) && typeof rating.stars === "number",
    );
}

export function buildObservationsFromValues(
  attributeTypes: AttributeTypeOut[],
  valuesByAttributeType: Record<number, string | undefined>,
): { attribute_type_id: number; value: string }[] {
  const byId = new Map(attributeTypes.map((type) => [type.id, type]));
  return Object.entries(valuesByAttributeType)
    .map(([id, value]) => ({
      attribute_type_id: Number(id),
      value,
      type: byId.get(Number(id)),
    }))
    .filter(
      (
        observation,
      ): observation is {
        attribute_type_id: number;
        value: string;
        type: AttributeTypeOut;
      } =>
        observation.value != null &&
        observation.value !== "unknown" &&
        observation.type != null &&
        legalAttributeValue(observation.type, observation.value),
    )
    .map(({ attribute_type_id, value }) => ({ attribute_type_id, value }));
}

export function isValidAddFountainInput(input: AddFountainInput): boolean {
  if (!input || typeof input !== "object" || Array.isArray(input)) return false;
  if (!validLocation(input.location)) return false;
  if (typeof input.is_working !== "boolean") return false;
  if (input.comments != null && typeof input.comments !== "string") return false;
  if (input.ratings != null) {
    if (!Array.isArray(input.ratings)) return false;
    for (const rating of input.ratings) {
      if (!rating || typeof rating !== "object") return false;
      if (!positiveInteger(rating.rating_type_id)) return false;
      if (!Number.isInteger(rating.stars) || rating.stars < 1 || rating.stars > 5) return false;
    }
  }
  if (input.observations != null) {
    if (!Array.isArray(input.observations)) return false;
    for (const observation of input.observations) {
      if (!observation || typeof observation !== "object") return false;
      if (!positiveInteger(observation.attribute_type_id)) return false;
      if (typeof observation.value !== "string" || observation.value.trim().length === 0) {
        return false;
      }
    }
  }
  return true;
}

export function buildAddFountainPayload(input: AddFountainInput): BuildResult<AddFountainRequest> {
  if (!isValidAddFountainInput(input)) return { ok: false };
  const body: AddFountainRequest = {
    location: input.location,
    is_working: input.is_working,
  };
  const comments = input.comments?.trim();
  if (comments) body.comments = comments;
  if (input.ratings?.length) body.ratings = input.ratings;
  if (input.observations?.length) body.observations = input.observations;
  return { ok: true, value: body };
}
