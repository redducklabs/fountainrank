"use client";
import { useEffect, useRef, useState, useTransition } from "react";
import type { components } from "@fountainrank/api-client";
import { reportPhoto } from "../../app/actions/contribute";
import { errorText } from "./contributeError";

type ReportCategory = components["schemas"]["ReportPhotoRequest"]["category"];

const CATEGORIES: { value: ReportCategory; label: string }[] = [
  { value: "inappropriate", label: "Inappropriate" },
  { value: "not_a_fountain", label: "Not a fountain" },
  { value: "spam", label: "Spam" },
  { value: "other", label: "Other" },
];

// Photo report dialog (docs/style-guide.md "Photo report dialog"). Follows the same
// centered-overlay shell family as `AddFountainPanel`/`DetailOverlay`: `role="dialog"`,
// `tabIndex={-1}` + focus-on-mount, Escape dismisses. `alreadyReported` short-circuits to a
// read-only notice — `PhotoCarousel`'s "Report" trigger has no per-photo disabled state of
// its own, so this dialog is what surfaces the already-reported outcome instead.
export function ReportPhotoDialog({
  fountainId,
  photoId,
  alreadyReported,
  onClose,
  onReported,
}: {
  fountainId: string;
  photoId: string;
  alreadyReported: boolean;
  onClose: () => void;
  onReported: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [category, setCategory] = useState<ReportCategory>("inappropriate");
  const [note, setNote] = useState("");
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<{ tone: "ok" | "err"; text: string } | null>(null);
  const [submitted, setSubmitted] = useState(false);

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
      const res = await reportPhoto(fountainId, photoId, category, note.trim() || undefined);
      if (res.ok) {
        setSubmitted(true);
        setMsg({ tone: "ok", text: "Thanks — this photo was reported." });
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
      aria-label="Report photo"
      tabIndex={-1}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4 outline-none"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="w-full max-w-sm rounded-lg bg-surface-raised p-4 shadow-xl">
        <h2 className="text-base font-semibold text-brand-ink">Report photo</h2>

        {alreadyReported ? (
          <>
            <p className="mt-3 text-sm text-muted">
              You&rsquo;ve already reported this photo. Thanks — our moderators will take a look.
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
              onChange={(e) => setCategory(e.target.value as ReportCategory)}
              className="mt-1 w-full rounded border border-border px-3 py-2 text-sm text-foreground"
            >
              {CATEGORIES.map((c) => (
                <option key={c.value} value={c.value}>
                  {c.label}
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
