import type { components } from "@fountainrank/api-client";
import { StyleSheet, Text, View } from "react-native";

import { isNoteEdited } from "../../lib/detail/notes";
import { formatRelativeTime } from "../../lib/map/format";
import { colors, spacing, typography } from "../../theme";

type NoteOut = components["schemas"]["NoteOut"];

export function NotesList({ notes, now }: { notes: NoteOut[]; now: Date }) {
  if (notes.length === 0) return null;
  return (
    <View style={styles.wrap}>
      <Text style={styles.header}>COMMUNITY NOTES</Text>
      {notes.map((note) => (
        <View key={note.id} style={styles.card}>
          <Text style={styles.body}>{note.body}</Text>
          <Text style={styles.byline}>
            {`— ${note.author_display_name} · ${formatRelativeTime(note.created_at, now)}${
              isNoteEdited(note) ? " · edited" : ""
            }`}
          </Text>
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
  byline: { ...typography.meta, color: colors.textMuted },
});
