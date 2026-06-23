import type { components } from "@fountainrank/api-client";

type NoteOut = components["schemas"]["NoteOut"];

/** A note is "edited" when its updated_at is strictly later than created_at.
 *  Mirrors the inline check in web NotesList; clock-skew (updated < created) is
 *  treated as not-edited. */
export function isNoteEdited(note: Pick<NoteOut, "created_at" | "updated_at">): boolean {
  return new Date(note.updated_at).getTime() > new Date(note.created_at).getTime();
}
