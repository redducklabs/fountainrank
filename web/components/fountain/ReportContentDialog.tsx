"use client";
import { useEffect, useRef, useState, useTransition } from "react";
import { reportContent } from "../../app/actions/contribute";
import { errorText } from "./contributeError";
import { REPORT_CATEGORY_LABELS, type ReportContentType } from "./reportCategories";

// Per-content-type dialog copy. The category `<option>` labels come from
// `REPORT_CATEGORY_LABELS` (shared with the note/fountain report affordances).
const DIALOG_TITLE: Record<ReportContentType, string> = {
  photo: "Report photo",
  note: "Report note",
  fountain: "Report this fountain",
};
const CONTENT_NOUN: Record<ReportContentType, string> = {
  photo: "photo",
  note: "note",
  fountain: "fountain",
};

// Generalized content report dialog (docs/style-guide.md "Content report dialog"). Generalizes
// the former photo-only `ReportPhotoDialog` to any reportable content (#11) — photos, notes, or
// the fountain itself — parameterized by `{ contentType, fountainId, contentId, categories }`.
// Follows the same centered-overlay shell family as `AddFountainPanel`/`DetailOverlay`:
// `role="dialog"`, `tabIndex={-1}` + focus-on-mount, Escape dismisses. `alreadyReported`
// short-circuits to a read-only notice (there is no "did I already report this" read endpoint,
// so the caller tracks it client-side for the session).
export function ReportContentDialog({
  contentType,
  fountainId,
  contentId,
  categories,
  alreadyReported,
  onClose,
  onReported,
}: {
  contentType: ReportContentType;
  fountainId: string;
  contentId: string;
  categories: readonly string[];
  alreadyReported: boolean;
  onClose: () => void;
  onReported: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [category, setCategory] = useState<string>(categories[0]);
  const [note, setNote] = useState("");
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<{ tone: "ok" | "err"; text: string } | null>(null);
  const [submitted, setSubmitted] = useState(false);
  const noun = CONTENT_NOUN[contentType];

  useEffect(() => {
    ref.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  function submit() {
    start(async () => {
      const res = await reportContent(
        contentType,
        fountainId,
        contentId,
        category,
        note.trim() || undefined,
      );
      if (res.ok) {
        setSubmitted(true);
        setMsg({ tone: "ok", text: `Thanks — this ${noun} was reported.` });
        onReported();
      } else {
        setMsg({ tone: "err", text: errorText(res.error) });
      }
    });
  }

  return (
    <div
      ref={ref}
      role="dialog"
      aria-label={DIALOG_TITLE[contentType]}
      tabIndex={-1}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4 outline-none"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="w-full max-w-sm rounded-lg bg-surface-raised p-4 shadow-xl">
        <h2 className="text-base font-semibold text-brand-ink">{DIALOG_TITLE[contentType]}</h2>

        {alreadyReported ? (
          <>
            <p className="mt-3 text-sm text-muted">
              You&rsquo;ve already reported this {noun}. Thanks — our moderators will take a look.
            </p>
            <div className="mt-4 flex justify-end">
              <button
                type="button"
                onClick={onClose}
                className="rounded-full border border-border px-4 py-2 text-sm font-semibold text-muted hover:bg-surface"
              >
                Close
              </button>
            </div>
          </>
        ) : (
          <>
            <label
              htmlFor="report-category"
              className="mt-3 block text-sm font-medium text-foreground"
            >
              Reason
            </label>
            <select
              id="report-category"
              value={category}
              disabled={pending || submitted}
              onChange={(e) => setCategory(e.target.value)}
              className="mt-1 w-full rounded border border-border px-3 py-2 text-sm text-foreground"
            >
              {categories.map((c) => (
                <option key={c} value={c}>
                  {REPORT_CATEGORY_LABELS[c] ?? c}
                </option>
              ))}
            </select>

            <label htmlFor="report-note" className="mt-3 block text-sm font-medium text-foreground">
              Note (optional)
            </label>
            <textarea
              id="report-note"
              maxLength={500}
              rows={3}
              value={note}
              disabled={pending || submitted}
              onChange={(e) => setNote(e.target.value)}
              className="mt-1 w-full rounded border border-border px-3 py-2 text-sm break-words text-foreground"
            />

            <div className="mt-4 flex justify-end gap-2">
              <button
                type="button"
                onClick={onClose}
                disabled={pending}
                className="rounded-full border border-border px-4 py-2 text-sm font-semibold text-muted hover:bg-surface"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={submit}
                disabled={pending || submitted}
                className="rounded-full bg-brand-mid px-4 py-2 text-sm font-bold text-white hover:bg-brand disabled:opacity-50"
              >
                {pending ? "Submitting…" : "Submit report"}
              </button>
            </div>
          </>
        )}

        {msg && (
          <p
            role="status"
            aria-live="polite"
            className={`mt-2 text-sm ${msg.tone === "ok" ? "text-emerald-700 dark:text-emerald-300" : "text-danger"}`}
          >
            {msg.text}
          </p>
        )}
      </div>
    </div>
  );
}
