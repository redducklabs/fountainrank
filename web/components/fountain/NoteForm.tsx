"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { notePointsPreview, type ViewerAwardStateT } from "@fountainrank/contributions";
import { submitNote } from "../../app/actions/contribute";
import { dispatchContribution } from "../../lib/contribution-event";
import { PointsPreview } from "../contributions/PointsPreview";
import { SpinnerButton } from "../ui/SpinnerButton";
import { errorText } from "./contributeError";

export function NoteForm({
  fountainId,
  viewerAwardState,
}: {
  fountainId: string;
  viewerAwardState?: ViewerAwardStateT | null;
}) {
  const router = useRouter();
  const [body, setBody] = useState("");
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<{ tone: "ok" | "err"; text: string } | null>(null);
  const trimmed = body.trim();

  function submit() {
    if (trimmed.length < 1 || trimmed.length > 1000) {
      setMsg({ tone: "err", text: "Please enter 1–1000 characters." });
      return;
    }
    start(async () => {
      const res = await submitNote(fountainId, trimmed);
      if (res.ok) {
        const earned = res.pointsAwarded; // `dk_note` is once-ever per fountain (#204)
        setMsg({
          tone: "ok",
          text:
            earned > 0
              ? `Your note was saved — you earned ${earned} points.`
              : "Comment saved. You already earned points for a comment on this fountain.",
        });
        setBody("");
        dispatchContribution(earned);
        router.refresh();
      } else {
        setMsg({ tone: "err", text: errorText(res.error) });
      }
    });
  }

  return (
    <div>
      <h3 className="text-sm font-semibold text-foreground">Your note</h3>
      <textarea
        value={body}
        maxLength={1000}
        rows={3}
        aria-label="Your note"
        onChange={(e) => setBody(e.target.value)}
        className="mt-1 w-full break-words rounded border border-border p-2 text-sm"
      />
      <div className="flex items-center justify-between">
        <span className="text-xs text-muted">{body.length}/1000</span>
        <SpinnerButton
          pending={pending}
          onClick={submit}
          className="rounded-full bg-brand px-4 py-1.5 text-sm font-semibold text-white disabled:opacity-50"
        >
          Save note
        </SpinnerButton>
      </div>
      <p className="text-xs text-muted">Submitting replaces any note you left here before.</p>
      <div className="mt-3">
        {trimmed.length > 0 && viewerAwardState && !viewerAwardState.note_earnable ? (
          <p className="rounded-lg border border-amber-300 bg-amber-50 p-2 text-xs font-semibold text-amber-800 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-300">
            You&rsquo;ve already earned points for a comment here — you can still update it, but it
            won&rsquo;t earn points again.
          </p>
        ) : (
          <PointsPreview lines={notePointsPreview(viewerAwardState, trimmed.length > 0)} />
        )}
      </div>
      {msg && (
        <p
          role="status"
          aria-live="polite"
          className={msg.tone === "ok" ? "text-emerald-700 dark:text-emerald-300" : "text-danger"}
        >
          {msg.text}
        </p>
      )}
    </div>
  );
}
