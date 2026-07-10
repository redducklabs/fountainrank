import type { components } from "@fountainrank/api-client";

import { isConditionStatus } from "./conditions";

type AttributeTypeOut = components["schemas"]["AttributeTypeOut"];
type ConditionReportRequest = components["schemas"]["ConditionReportRequest"];
type ObserveAttributesRequest = components["schemas"]["ObserveAttributesRequest"];
type RateRequest = components["schemas"]["RateRequest"];
type AddNoteRequest = components["schemas"]["AddNoteRequest"];

type BuildResult<T> = { ok: true; value: T } | { ok: false };

const UUID_RE = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;
const NOTE_MAX = 1000;

function validFountainId(fountainId: string): boolean {
  return UUID_RE.test(fountainId);
}

function positiveInteger(value: number): boolean {
  return Number.isInteger(value) && value > 0;
}

export type ContributionCoords = { latitude: number; longitude: number };

// Only latitude/longitude reach the wire (the client-side Coords also carries `accuracy`, which the
// API does not accept). Returns {} when no coords, so it spreads cleanly into a request body.
function coordFields(
  coords?: ContributionCoords | null,
): ContributionCoords | Record<string, never> {
  return coords == null ? {} : { latitude: coords.latitude, longitude: coords.longitude };
}

export function buildRatingPayload(
  fountainId: string,
  starsByRatingType: Record<number, number | undefined>,
  coords?: ContributionCoords | null,
): BuildResult<RateRequest> {
  if (!validFountainId(fountainId)) return { ok: false };
  const ratings = Object.entries(starsByRatingType)
    .map(([ratingTypeId, stars]) => ({
      rating_type_id: Number(ratingTypeId),
      stars,
    }))
    .filter(
      (rating): rating is { rating_type_id: number; stars: number } =>
        typeof rating.stars === "number" && rating.stars > 0,
    );
  if (
    ratings.length === 0 ||
    !ratings.every(
      (rating) =>
        positiveInteger(rating.rating_type_id) &&
        Number.isInteger(rating.stars) &&
        rating.stars >= 1 &&
        rating.stars <= 5,
    )
  ) {
    return { ok: false };
  }
  return { ok: true, value: { ratings, ...coordFields(coords) } };
}

export function buildConditionPayload(
  fountainId: string,
  status: string,
  coords?: ContributionCoords | null,
): BuildResult<ConditionReportRequest> {
  if (!validFountainId(fountainId) || !isConditionStatus(status)) {
    return { ok: false };
  }
  // is_proximate is derived server-side now (#3) — do not send it.
  return { ok: true, value: { status, ...coordFields(coords) } };
}

export function attributeOptions(type: AttributeTypeOut): string[] {
  if (type.value_kind === "enum") {
    return [...(type.allowed_values ?? []), "unknown"];
  }
  return ["yes", "no", "unknown"];
}

export function legalAttributeValue(type: AttributeTypeOut, value: string): boolean {
  if (value === "unknown") return true;
  if (type.value_kind === "boolean") {
    return value === "yes" || value === "no";
  }
  return Boolean(type.allowed_values?.includes(value));
}

export function buildAttributePayload(
  fountainId: string,
  attributeTypes: AttributeTypeOut[],
  valuesByAttributeType: Record<number, string | undefined>,
): BuildResult<ObserveAttributesRequest> {
  if (!validFountainId(fountainId)) return { ok: false };
  const byId = new Map(attributeTypes.map((type) => [type.id, type]));
  const observations = Object.entries(valuesByAttributeType)
    .map(([attributeTypeId, value]) => ({
      attribute_type_id: Number(attributeTypeId),
      value,
      type: byId.get(Number(attributeTypeId)),
    }))
    .filter(
      (
        observation,
      ): observation is {
        attribute_type_id: number;
        value: string;
        type: AttributeTypeOut;
      } => observation.value != null,
    );
  if (
    observations.length === 0 ||
    !observations.every(
      (observation) =>
        positiveInteger(observation.attribute_type_id) &&
        observation.type != null &&
        legalAttributeValue(observation.type, observation.value),
    )
  ) {
    return { ok: false };
  }
  return {
    ok: true,
    value: {
      observations: observations.map(({ attribute_type_id, value }) => ({
        attribute_type_id,
        value,
      })),
    },
  };
}

export function buildNotePayload(fountainId: string, body: string): BuildResult<AddNoteRequest> {
  if (!validFountainId(fountainId)) return { ok: false };
  const trimmed = body.trim();
  if (trimmed.length < 1 || trimmed.length > NOTE_MAX) {
    return { ok: false };
  }
  return { ok: true, value: { body: trimmed } };
}
