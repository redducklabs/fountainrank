import type { components } from "@fountainrank/api-client";
import { useEffect, useReducer, useState } from "react";
import {
  AccessibilityInfo,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";

import {
  buildAddFountainPayload,
  buildObservationsFromValues,
  buildRatingsFromStars,
  PLACEMENT_NOTE_MAX,
  type AddFountainInput,
} from "../../lib/add-fountain/payloads";
import {
  boundFromFix,
  canPlace,
  inBound,
  type Bound,
  type LngLat,
  type ViewportBounds,
} from "../../lib/add-fountain/placement";
import {
  addFountainErrorText,
  addFountainReducer,
  initialAddFountainState,
  type AddFountainResult,
} from "../../lib/add-fountain/state";
import type { RawBounds } from "../../lib/map/bounds";
import { isMapConfigured, type MobileConfig } from "../../lib/config";
import { PLACE_MIN_ZOOM } from "../../lib/map/constants";
import { colors, spacing, typography } from "../../theme";
import { AddFountainMap } from "./AddFountainMap";
import { AttributeFields } from "./AttributeFields";
import { RatingFields } from "./RatingFields";

type AttributeTypeOut = components["schemas"]["AttributeTypeOut"];
type RatingTypeOut = components["schemas"]["RatingTypeOut"];

type CatalogState<T> = {
  data: T[];
  isLoading: boolean;
  isError: boolean;
  onRetry: () => void;
};

type Message = { tone: "ok" | "err"; text: string } | null;

export function AddFountainForm({
  config,
  userLocation,
  ratingCatalog,
  attributeCatalog,
  pending,
  onNeedCatalogs,
  onSubmit,
  onViewFountain,
}: {
  config: MobileConfig;
  userLocation: { latitude: number; longitude: number; accuracy: number | null } | null;
  ratingCatalog: CatalogState<RatingTypeOut>;
  attributeCatalog: CatalogState<AttributeTypeOut>;
  pending: boolean;
  onNeedCatalogs: () => void;
  onSubmit: (input: AddFountainInput) => Promise<AddFountainResult>;
  onViewFountain: (fountainId: string) => void;
}) {
  const [state, dispatch] = useReducer(addFountainReducer, initialAddFountainState);
  const [region, setRegion] = useState<{ bounds: ViewportBounds; zoom: number } | null>(null);
  const [message, setMessage] = useState<Message>(null);
  const [ratings, setRatings] = useState<Record<number, number | undefined>>({});
  const [attributes, setAttributes] = useState<Record<number, string | undefined>>({});
  const [comments, setComments] = useState("");
  const [placementNote, setPlacementNote] = useState("");

  useEffect(() => {
    if (!region) return;
    const fix =
      userLocation != null
        ? {
            ok: true as const,
            latitude: userLocation.latitude,
            longitude: userLocation.longitude,
            accuracy: userLocation.accuracy,
          }
        : ({ ok: false } as const);
    dispatch({ type: "setBound", bound: boundFromFix(fix, region.bounds) });
  }, [region, userLocation]);

  useEffect(() => {
    if (message && Platform.OS !== "android") {
      AccessibilityInfo.announceForAccessibility(message.text);
    }
  }, [message]);

  const pinInBound = state.pin != null && state.bound != null && inBound(state.pin, state.bound);
  const placeable = canPlace(region?.zoom ?? 0, state.bound) && pinInBound;
  const submitting = pending || state.phase === "submitting";

  const place = (point: LngLat) => {
    setMessage(null);
    dispatch({ type: "dropPin", point });
  };

  const useCurrentLocation = () => {
    if (!userLocation) return;
    place({ lng: userLocation.longitude, lat: userLocation.latitude });
  };

  const placeAtCenter = () => {
    if (!region) return;
    place({
      lng: (region.bounds.west + region.bounds.east) / 2,
      lat: (region.bounds.south + region.bounds.north) / 2,
    });
  };

  const goDetails = () => {
    onNeedCatalogs();
    dispatch({ type: "next" });
  };

  const submit = async () => {
    setMessage(null);
    if (!state.pin) {
      setMessage({ tone: "err", text: "Choose where the fountain is." });
      return;
    }
    const payload = buildAddFountainPayload({
      location: { latitude: state.pin.lat, longitude: state.pin.lng },
      is_working: state.isWorking,
      comments,
      placement_note: placementNote,
      ratings: buildRatingsFromStars(ratingCatalog.data, ratings),
      observations: buildObservationsFromValues(attributeCatalog.data, attributes),
    });
    if (!payload.ok) {
      setMessage({ tone: "err", text: "Please check the fountain details and try again." });
      return;
    }
    dispatch({ type: "submitStart" });
    const result = await onSubmit(payload.value);
    if (result.ok) {
      dispatch({ type: "created", fountainId: result.fountainId });
      setMessage({ tone: "ok", text: "Fountain added." });
      onViewFountain(result.fountainId);
      return;
    }
    if (result.error === "duplicate") {
      dispatch({ type: "duplicate", fountainId: result.fountainId });
      setMessage({ tone: "err", text: "A fountain already exists here." });
      return;
    }
    dispatch({ type: "submitError", error: result.error });
    setMessage({ tone: "err", text: addFountainErrorText(result.error) });
  };

  if (!isMapConfigured(config)) {
    return (
      <View style={styles.stateBox}>
        <Text style={styles.title}>Map unavailable</Text>
        <Text style={styles.note}>The map is not configured for this build.</Text>
      </View>
    );
  }

  if (state.phase === "duplicate" && state.duplicateId) {
    return (
      <View style={styles.stateBox}>
        <Text style={styles.title}>A fountain already exists here</Text>
        <Text style={styles.note}>View the existing fountain and add details there.</Text>
        <PrimaryButton
          label="View existing fountain"
          disabled={false}
          onPress={() => onViewFountain(state.duplicateId!)}
        />
        <SecondaryButton
          label="Add another location"
          disabled={false}
          onPress={() => dispatch({ type: "reset" })}
        />
        <LiveMessage message={message} />
      </View>
    );
  }

  if (state.phase === "created") {
    return (
      <View style={styles.stateBox}>
        <Text style={styles.title}>Fountain added</Text>
        <Text style={styles.note}>Opening the new fountain...</Text>
        <LiveMessage message={message} />
      </View>
    );
  }

  return (
    <View style={styles.wrap}>
      {state.phase === "placing" ? (
        <View style={styles.step}>
          <Text style={styles.title}>Choose the fountain location</Text>
          <View style={styles.mapFrame}>
            <AddFountainMap
              styleUrl={config.basemapStyleUrl!}
              userCoords={userLocation}
              showUserLocation={userLocation != null}
              bound={state.bound}
              pin={state.pin}
              onPlace={place}
              onRegionChange={(bounds: RawBounds, zoom: number) => setRegion({ bounds, zoom })}
            />
          </View>
          <Text style={styles.note}>
            {placementInstruction(placeable, state.bound, region?.zoom, state.pin, pinInBound)}
          </Text>
          {state.pin ? (
            <Text style={styles.coord}>
              {state.pin.lat.toFixed(5)}, {state.pin.lng.toFixed(5)}
            </Text>
          ) : null}
          <View style={styles.actions}>
            <SecondaryButton
              label="Use current location"
              disabled={!userLocation || submitting}
              onPress={useCurrentLocation}
            />
            <SecondaryButton
              label="Place at map center"
              disabled={!region || submitting}
              onPress={placeAtCenter}
            />
          </View>
          <View style={styles.nudgeGrid}>
            <SecondaryButton
              label="North"
              disabled={!state.pin || submitting}
              onPress={() => dispatch({ type: "nudge", direction: "n" })}
            />
            <View style={styles.actions}>
              <SecondaryButton
                label="West"
                disabled={!state.pin || submitting}
                onPress={() => dispatch({ type: "nudge", direction: "w" })}
              />
              <SecondaryButton
                label="East"
                disabled={!state.pin || submitting}
                onPress={() => dispatch({ type: "nudge", direction: "e" })}
              />
            </View>
            <SecondaryButton
              label="South"
              disabled={!state.pin || submitting}
              onPress={() => dispatch({ type: "nudge", direction: "s" })}
            />
          </View>
          <PrimaryButton
            label="Next: details"
            disabled={!state.pin || !placeable || submitting}
            onPress={goDetails}
          />
        </View>
      ) : (
        <View style={styles.step}>
          <Text style={styles.title}>Fountain details</Text>
          <Text style={styles.label}>Is it working?</Text>
          <View style={styles.actions}>
            <ChoiceButton
              label="Yes"
              selected={state.isWorking}
              disabled={submitting}
              onPress={() => dispatch({ type: "setWorking", isWorking: true })}
            />
            <ChoiceButton
              label="No"
              selected={!state.isWorking}
              disabled={submitting}
              onPress={() => dispatch({ type: "setWorking", isWorking: false })}
            />
          </View>
          <CatalogNotice title="Rating options" catalog={ratingCatalog} />
          <RatingFields
            ratingTypes={ratingCatalog.data}
            values={ratings}
            disabled={submitting}
            onChange={setRatings}
          />
          <CatalogNotice title="Attribute options" catalog={attributeCatalog} />
          <AttributeFields
            attributeTypes={attributeCatalog.data}
            values={attributes}
            disabled={submitting}
            onChange={setAttributes}
          />
          <Text style={styles.label}>Comment</Text>
          <TextInput
            accessibilityLabel="Comment"
            editable={!submitting}
            multiline
            value={comments}
            onChangeText={setComments}
            style={[styles.input, styles.textArea]}
          />
          <Text style={styles.label}>Placement note</Text>
          <TextInput
            accessibilityLabel="Placement note"
            editable={!submitting}
            value={placementNote}
            maxLength={PLACEMENT_NOTE_MAX}
            onChangeText={setPlacementNote}
            style={styles.input}
          />
          <Text style={styles.count}>{`${placementNote.length}/${PLACEMENT_NOTE_MAX}`}</Text>
          <View style={styles.actions}>
            <SecondaryButton
              label="Back"
              disabled={submitting}
              onPress={() => dispatch({ type: "back" })}
            />
            <PrimaryButton label="Add fountain" disabled={submitting} onPress={submit} />
          </View>
        </View>
      )}
      <LiveMessage message={message} />
    </View>
  );
}

function placementInstruction(
  placeable: boolean,
  bound: Bound | null,
  zoom: number | undefined,
  pin: LngLat | null,
  pinInBound: boolean,
) {
  if (!bound) return "Move the map to the fountain area.";
  if ((zoom ?? 0) < PLACE_MIN_ZOOM) return "Zoom in to place the fountain accurately.";
  if (pin && !pinInBound) return "Move the pin back inside the current placement area.";
  if (!placeable) return "Zoom in closer before placing a fountain without confirmed location.";
  if (bound.kind === "circle") return "Place the pin near your current location.";
  return "We couldn't confirm your location - make sure the pin is exactly where the fountain is.";
}

function CatalogNotice<T>({ title, catalog }: { title: string; catalog: CatalogState<T> }) {
  if (catalog.isLoading) return <Text style={styles.note}>{title} loading...</Text>;
  if (catalog.isError) {
    return (
      <View style={styles.catalogRow}>
        <Text style={styles.note}>{title} could not load. You can still add the fountain.</Text>
        <SecondaryButton label="Retry" disabled={false} onPress={catalog.onRetry} />
      </View>
    );
  }
  return null;
}

function LiveMessage({ message }: { message: Message }) {
  if (!message) return null;
  return (
    <Text
      accessibilityLiveRegion="polite"
      style={[styles.message, message.tone === "ok" ? styles.ok : styles.err]}
    >
      {message.text}
    </Text>
  );
}

function PrimaryButton({
  label,
  disabled,
  onPress,
}: {
  label: string;
  disabled: boolean;
  onPress: () => void | Promise<void>;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={() => {
        void onPress();
      }}
      style={({ pressed }) => [
        styles.primaryButton,
        disabled ? styles.disabled : null,
        pressed && !disabled ? styles.pressed : null,
      ]}
    >
      <Text style={styles.primaryText}>{label}</Text>
    </Pressable>
  );
}

function SecondaryButton({
  label,
  disabled,
  onPress,
}: {
  label: string;
  disabled: boolean;
  onPress: () => void | Promise<void>;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={() => {
        void onPress();
      }}
      style={({ pressed }) => [
        styles.secondaryButton,
        disabled ? styles.disabled : null,
        pressed && !disabled ? styles.pressed : null,
      ]}
    >
      <Text style={styles.secondaryText}>{label}</Text>
    </Pressable>
  );
}

function ChoiceButton({
  label,
  selected,
  disabled,
  onPress,
}: {
  label: string;
  selected: boolean;
  disabled: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected, disabled }}
      disabled={disabled}
      onPress={onPress}
      style={[
        styles.choiceButton,
        selected ? styles.choiceSelected : null,
        disabled ? styles.disabled : null,
      ]}
    >
      <Text style={[styles.choiceText, selected ? styles.choiceTextSelected : null]}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: spacing.md },
  step: { gap: spacing.md },
  stateBox: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: 8,
    padding: spacing.md,
    gap: spacing.sm,
  },
  title: { ...typography.title, color: colors.brandBlue },
  note: { ...typography.body, color: colors.textMuted },
  label: { ...typography.body, color: colors.textMuted, fontWeight: "700" },
  coord: { ...typography.meta, color: colors.text },
  mapFrame: {
    height: 320,
    overflow: "hidden",
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: 8,
  },
  actions: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm, alignItems: "center" },
  nudgeGrid: { alignItems: "center", gap: spacing.xs },
  primaryButton: {
    alignSelf: "flex-start",
    minHeight: 44,
    justifyContent: "center",
    backgroundColor: colors.brandBlue,
    borderRadius: 8,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  primaryText: { ...typography.body, color: colors.onBrand, fontWeight: "700" },
  secondaryButton: {
    minHeight: 44,
    justifyContent: "center",
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  secondaryText: { ...typography.body, color: colors.brandBlue, fontWeight: "700" },
  choiceButton: {
    minHeight: 44,
    minWidth: 80,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  choiceSelected: { borderColor: colors.brandBlue, backgroundColor: colors.brandBlue },
  choiceText: { ...typography.body, color: colors.text },
  choiceTextSelected: { color: colors.onBrand, fontWeight: "700" },
  disabled: { opacity: 0.5 },
  pressed: { opacity: 0.8 },
  input: {
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: 8,
    padding: spacing.sm,
    color: colors.text,
    backgroundColor: colors.background,
  },
  textArea: { minHeight: 96, textAlignVertical: "top" },
  count: { ...typography.meta, color: colors.textMuted, alignSelf: "flex-end" },
  catalogRow: { gap: spacing.sm },
  message: { ...typography.meta },
  ok: { color: "#047857" },
  err: { color: colors.danger },
});
