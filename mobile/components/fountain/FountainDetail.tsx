import type { components } from "@fountainrank/api-client";
import type React from "react";
import { Alert, Linking, Pressable, StyleSheet, Text, View } from "react-native";

import { formatAverage, formatDate, formatDimension, formatVotes } from "../../lib/map/format";
import { colors, spacing, typography } from "../../theme";
import { AttributeList } from "./AttributeList";
import { NotesList } from "./NotesList";
import { StatusBlock } from "./StatusBlock";

type FountainDetailT = components["schemas"]["FountainDetail"];
type NoteOut = components["schemas"]["NoteOut"];

export function FountainDetail({
  detail,
  notes,
  notesError,
  onRetryNotes,
  contribution,
  now,
}: {
  detail: FountainDetailT;
  notes: NoteOut[];
  notesError?: boolean;
  onRetryNotes?: () => void;
  contribution?: React.ReactNode;
  now: Date;
}) {
  const { latitude, longitude } = detail.location;
  const directionsUrl = `https://www.google.com/maps/dir/?api=1&destination=${latitude},${longitude}`;
  const openDirections = () => {
    Linking.openURL(directionsUrl).catch(() => {
      Alert.alert("Couldn't open maps", "No maps app is available to open directions.");
    });
  };

  return (
    <View style={styles.wrap}>
      <View style={styles.headerBlock}>
        <Text style={styles.title}>Public drinking fountain</Text>
        <StatusBlock
          currentStatus={detail.current_status}
          isWorking={detail.is_working}
          lastVerifiedAt={detail.last_verified_at}
          now={now}
        />
      </View>

      {detail.placement_note ? (
        <Text style={styles.placement}>{`📍 ${detail.placement_note}`}</Text>
      ) : null}

      <View style={styles.ratingRow}>
        <Text style={styles.average}>{formatAverage(detail.average_rating ?? null)}</Text>
        {detail.average_rating != null ? (
          <Text style={styles.votes}>{` · ${formatVotes(detail.rating_count)}`}</Text>
        ) : null}
      </View>

      {detail.dimensions.length > 0 ? (
        <View style={styles.dimensions}>
          {detail.dimensions.map((d) => (
            <View key={d.rating_type_id} style={styles.dimensionRow}>
              <Text style={styles.dimensionName}>{d.name}</Text>
              <Text style={styles.dimensionValue}>
                {formatDimension(d.average_rating ?? null, d.vote_count)}
              </Text>
            </View>
          ))}
        </View>
      ) : null}

      <AttributeList attributes={detail.attributes} />

      {detail.comments ? (
        <View>
          <View style={styles.commentCard}>
            <Text style={styles.commentText}>{detail.comments}</Text>
          </View>
          <Text style={styles.commentCaption}>From the person who added this fountain</Text>
        </View>
      ) : null}

      {notesError ? (
        <View style={styles.notesError}>
          <Text style={styles.notesErrorText}>{"Community notes couldn't load."}</Text>
          {onRetryNotes ? (
            <Pressable accessibilityRole="button" onPress={onRetryNotes}>
              <Text style={styles.notesRetry}>Retry</Text>
            </Pressable>
          ) : null}
        </View>
      ) : (
        <NotesList notes={notes} now={now} />
      )}

      {contribution}

      <Text style={styles.footer}>
        {`Added ${formatDate(detail.created_at)}`}
        {detail.last_rated_at ? ` · Last rated ${formatDate(detail.last_rated_at)}` : ""}
      </Text>

      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Get directions"
        onPress={openDirections}
        style={styles.directions}
      >
        <Text style={styles.directionsText}>Directions</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: spacing.md },
  headerBlock: { gap: spacing.xs },
  title: { ...typography.heading, color: colors.brandBlue },
  placement: { ...typography.body, color: colors.textMuted },
  ratingRow: { flexDirection: "row", alignItems: "baseline" },
  average: { fontSize: 28, fontWeight: "800", color: colors.brandBlue },
  votes: { ...typography.body, color: colors.textMuted },
  dimensions: { borderTopColor: colors.border, borderTopWidth: 1 },
  dimensionRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    paddingVertical: spacing.sm,
    borderBottomColor: colors.border,
    borderBottomWidth: 1,
  },
  dimensionName: { ...typography.body, fontWeight: "600", color: colors.text },
  dimensionValue: { ...typography.body, color: colors.textMuted },
  commentCard: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: 12,
    padding: spacing.md,
  },
  commentText: { ...typography.body, color: colors.text },
  commentCaption: { ...typography.meta, color: colors.textMuted, marginTop: spacing.xs },
  notesError: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  notesErrorText: { ...typography.meta, color: colors.textMuted },
  notesRetry: { ...typography.meta, color: colors.brandBlue, fontWeight: "700" },
  footer: { ...typography.meta, color: colors.textMuted },
  directions: {
    alignSelf: "flex-start",
    backgroundColor: colors.brandYellow,
    borderRadius: 999,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
  },
  directionsText: { ...typography.body, fontWeight: "700", color: colors.brandBlue },
});
