import type { components } from "@fountainrank/api-client";
import type React from "react";
import { Alert, Linking, Platform, Pressable, Share, StyleSheet, Text, View } from "react-native";

import { formatAverage, formatDate, formatVotes } from "../../lib/map/format";
import { fountainShareUrl, shareContent } from "../../lib/share-url";
import { colors, spacing, typography } from "../../theme";
import { AttributeList } from "./AttributeList";
import { NotesList } from "./NotesList";
import { Stars } from "./Stars";
import { StatusBlock } from "./StatusBlock";

type FountainDetailT = components["schemas"]["FountainDetail"];
type NoteOut = components["schemas"]["NoteOut"];

export function FountainDetail({
  detail,
  notes,
  notesError,
  onRetryNotes,
  adminControls,
  contribution,
  now,
  webBaseUrl,
}: {
  detail: FountainDetailT;
  notes: NoteOut[];
  notesError?: boolean;
  onRetryNotes?: () => void;
  adminControls?: React.ReactNode;
  contribution?: React.ReactNode;
  now: Date;
  webBaseUrl: string;
}) {
  const { latitude, longitude } = detail.location;
  const contextComment = detail.comments || detail.placement_note;
  const directionsUrl = `https://www.google.com/maps/dir/?api=1&destination=${latitude},${longitude}`;
  const openDirections = () => {
    Linking.openURL(directionsUrl).catch(() => {
      Alert.alert("Couldn't open maps", "No maps app is available to open directions.");
    });
  };
  const onShare = () => {
    // Share the public web URL; Android needs it in `message` (its sheet ignores `url`). A
    // user-dismissed sheet RESOLVES (dismissedAction), so a rejection here is a genuine failure —
    // log it for diagnosis rather than suppressing it silently.
    const url = fountainShareUrl(webBaseUrl, String(detail.id));
    Share.share(shareContent(url, Platform.OS)).catch((err) => {
      console.warn(`[share] fountain share failed: ${(err as Error)?.message ?? String(err)}`);
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

      {detail.average_rating != null ? (
        <View style={styles.heroRow}>
          <Text style={styles.average}>{formatAverage(detail.average_rating)}</Text>
          <View style={styles.heroStars}>
            <Stars value={detail.average_rating} size={20} />
            <Text style={styles.votes}>{formatVotes(detail.rating_count)}</Text>
          </View>
        </View>
      ) : (
        <View style={styles.heroRow}>
          <Stars value={0} size={20} label="Not yet rated" />
          <Text style={styles.notRated}>Not yet rated</Text>
        </View>
      )}

      {detail.dimensions.length > 0 ? (
        <View style={styles.dimensions}>
          {detail.dimensions.map((d) => (
            <View key={d.rating_type_id} style={styles.dimensionRow}>
              <View style={styles.dimensionTop}>
                <Text style={styles.dimensionName}>{d.name}</Text>
                {d.average_rating != null ? (
                  <View style={styles.dimensionScore}>
                    <Stars
                      value={d.average_rating}
                      size={14}
                      label={`${d.name} rated ${d.average_rating.toFixed(1)} out of 5`}
                    />
                    <Text style={styles.dimensionValue}>
                      {`${d.average_rating.toFixed(1)} (${d.vote_count})`}
                    </Text>
                  </View>
                ) : (
                  <Text style={styles.dimensionMuted}>Not yet rated</Text>
                )}
              </View>
              {d.average_rating != null ? (
                <View style={styles.meterTrack}>
                  <View
                    style={[
                      styles.meterFill,
                      { width: `${(Math.max(0, Math.min(5, d.average_rating)) / 5) * 100}%` },
                    ]}
                  />
                </View>
              ) : null}
            </View>
          ))}
        </View>
      ) : null}

      <AttributeList attributes={detail.attributes} />

      {contextComment ? (
        <View>
          <View style={styles.commentCard}>
            <Text style={styles.commentText}>{contextComment}</Text>
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

      {adminControls}

      {contribution}

      <Text style={styles.footer}>
        {`Added ${formatDate(detail.created_at)}`}
        {detail.last_rated_at ? ` · Last rated ${formatDate(detail.last_rated_at)}` : ""}
      </Text>

      <View style={styles.actions}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Get directions"
          onPress={openDirections}
          style={styles.directions}
        >
          <Text style={styles.directionsText}>Directions</Text>
        </Pressable>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Share this fountain"
          onPress={onShare}
          style={styles.share}
        >
          <Text style={styles.shareText}>Share</Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: spacing.md },
  headerBlock: { gap: spacing.xs },
  title: { ...typography.heading, color: colors.brandBlue },
  heroRow: { flexDirection: "row", alignItems: "center", gap: spacing.md },
  average: { fontSize: 34, fontWeight: "800", color: colors.brandBlue, lineHeight: 36 },
  heroStars: { gap: 2 },
  votes: { ...typography.meta, color: colors.textMuted },
  notRated: { ...typography.body, fontWeight: "600", color: colors.textMuted },
  dimensions: {
    gap: spacing.sm,
    borderTopColor: colors.border,
    borderTopWidth: 1,
    paddingTop: spacing.sm,
  },
  dimensionRow: { gap: spacing.xs },
  dimensionTop: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    gap: spacing.sm,
  },
  dimensionName: { ...typography.body, fontWeight: "600", color: colors.text },
  dimensionScore: { flexDirection: "row", alignItems: "center", gap: spacing.xs },
  dimensionValue: { ...typography.meta, fontWeight: "700", color: colors.brandBlue },
  dimensionMuted: { ...typography.meta, color: colors.textMuted },
  meterTrack: { height: 6, borderRadius: 999, backgroundColor: colors.border, overflow: "hidden" },
  meterFill: { height: "100%", borderRadius: 999, backgroundColor: "#0E4DA4" },
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
  actions: { flexDirection: "row", alignItems: "center", gap: spacing.sm, flexWrap: "wrap" },
  directions: {
    alignSelf: "flex-start",
    backgroundColor: colors.brandYellow,
    borderRadius: 999,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
  },
  directionsText: { ...typography.body, fontWeight: "700", color: colors.brandBlue },
  share: {
    alignSelf: "flex-start",
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
  },
  shareText: { ...typography.body, fontWeight: "700", color: colors.brandBlue },
});
