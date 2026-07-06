import type { components } from "@fountainrank/api-client";
import { Pressable, StyleSheet, Text, View } from "react-native";

import { isNoteEdited } from "../../lib/detail/notes";
import { formatRelativeTime } from "../../lib/map/format";
import { colors, spacing, typography } from "../../theme";

type NoteOut = components["schemas"]["NoteOut"];

export function NotesList({
  notes,
  now,
  onReportNote,
}: {
  notes: NoteOut[];
  now: Date;
  /** When provided (signed-in reader), each note row shows a "Report" trigger (#11). */
  onReportNote?: (note: NoteOut) => void;
}) {
  if (notes.length === 0) return null;
  return (
    <View style={styles.wrap}>
      <Text style={styles.header}>COMMUNITY NOTES</Text>
      {notes.map((note) => (
        <View key={note.id} style={styles.card}>
          <Text style={styles.body}>{note.body}</Text>
          <View style={styles.footer}>
            <Text style={styles.byline}>
              {`— ${note.author_display_name} · ${formatRelativeTime(note.created_at, now)}${
                isNoteEdited(note) ? " · edited" : ""
              }`}
            </Text>
            {onReportNote ? (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Report this note"
                onPress={() => onReportNote(note)}
                style={styles.reportButton}
                hitSlop={spacing.xs}
              >
                <Text style={styles.reportText}>Report</Text>
              </Pressable>
            ) : null}
          </View>
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: spacing.sm },
  header: { ...typography.meta, color: colors.textMuted, fontWeight: "600", letterSpacing: 0.5 },
  card: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: 12,
    padding: spacing.md,
    gap: spacing.xs,
  },
  body: { ...typography.body, color: colors.text },
  footer: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: spacing.sm,
  },
  byline: { ...typography.meta, color: colors.textMuted, flexShrink: 1 },
  reportButton: { paddingHorizontal: spacing.xs, paddingVertical: 2 },
  reportText: { ...typography.meta, color: colors.textMuted, fontWeight: "700" },
});
