import type { NoteOut } from "../../lib/fountains";
import { formatRelativeTime } from "../../lib/map/format";

export function NotesList({ notes, now }: { notes: NoteOut[]; now: Date }) {
  if (notes.length === 0) return null;
  return (
    <section className="space-y-2">
      <h3 className="text-xs font-semibold uppercase tracking-wide text-muted">
        Community notes
      </h3>
      <ul className="space-y-2">
        {notes.map((note) => {
          const edited = new Date(note.updated_at).getTime() > new Date(note.created_at).getTime();
          return (
            <li
              key={note.id}
              className="rounded-lg border border-border bg-surface p-3 text-sm break-words text-foreground"
            >
              <p>{note.body}</p>
              <p className="mt-1 text-xs text-muted">
                — {note.author_display_name} · {formatRelativeTime(note.created_at, now)}
                {edited ? " · edited" : ""}
              </p>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
