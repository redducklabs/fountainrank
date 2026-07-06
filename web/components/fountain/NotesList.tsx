import type { NoteOut } from "../../lib/fountains";
import { formatRelativeTime } from "../../lib/map/format";
import { ReportControl } from "./ReportControl";
import { REPORT_CATEGORIES } from "./reportCategories";

export function NotesList({
  notes,
  now,
  fountainId,
  isAuthenticated,
}: {
  notes: NoteOut[];
  now: Date;
  fountainId: string;
  isAuthenticated: boolean;
}) {
  if (notes.length === 0) return null;
  return (
    <section className="space-y-2">
      <h3 className="text-xs font-semibold uppercase tracking-wide text-muted">Community notes</h3>
      <ul className="space-y-2">
        {notes.map((note) => {
          const edited = new Date(note.updated_at).getTime() > new Date(note.created_at).getTime();
          return (
            <li
              key={note.id}
              className="rounded-lg border border-border bg-surface p-3 text-sm break-words text-foreground"
            >
              <p>{note.body}</p>
              <div className="mt-1 flex items-start justify-between gap-3">
                <p className="text-xs text-muted">
                  — {note.author_display_name} · {formatRelativeTime(note.created_at, now)}
                  {edited ? " · edited" : ""}
                </p>
                {isAuthenticated && (
                  <ReportControl
                    contentType="note"
                    fountainId={fountainId}
                    contentId={note.id}
                    categories={REPORT_CATEGORIES.note}
                    className="shrink-0 text-xs font-semibold text-muted hover:text-foreground"
                  />
                )}
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
