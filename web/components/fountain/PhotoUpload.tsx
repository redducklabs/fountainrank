"use client";
import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { isRatingDraftDirty } from "@fountainrank/contributions";
import { submitRating, uploadPhoto, type ContributeError } from "../../app/actions/contribute";
import { dispatchContribution } from "../../lib/contribution-event";
import { getCurrentPositionSafe } from "../../lib/geo/current-position";
import { errorText } from "./contributeError";
import { useRatingDraft } from "./RatingDraftContext";

const ACCEPTED_TYPES = "image/jpeg,image/png,image/webp";

export function PhotoUpload({ fountainId }: { fountainId: string }) {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<{ tone: "ok" | "err"; text: string } | null>(null);
  const { dimensions, edits, clear } = useRatingDraft();

  function handleChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setMsg(null);
    const formData = new FormData();
    formData.set("file", file);
    start(async () => {
      // #1 (spec §4.1): flush an unsaved rating first, but a rating failure — including the 50 mi
      // proximity 403 — must NEVER block the ungated photo upload. The two are independent.
      let ratingError: ContributeError | null = null;
      if (isRatingDraftDirty(dimensions, edits)) {
        const ratings = dimensions
          .map((d) => ({
            rating_type_id: d.rating_type_id,
            stars: edits[d.rating_type_id] ?? d.your_rating ?? 0,
          }))
          .filter((r) => r.stars > 0);
        const coords = await getCurrentPositionSafe();
        const rres = await submitRating(fountainId, ratings, coords ?? undefined);
        if (rres.ok) {
          clear();
          dispatchContribution();
        } else {
          ratingError = rres.error;
        }
      }
      const res = await uploadPhoto(fountainId, formData);
      if (res.ok) {
        dispatchContribution();
        router.refresh();
        setMsg(
          ratingError
            ? {
                tone: "ok",
                text:
                  ratingError === "too_far"
                    ? "Photo uploaded. Your rating wasn't saved — you're too far from this fountain to rate it."
                    : `Photo uploaded, but your rating wasn't saved: ${errorText(ratingError)}`,
              }
            : { tone: "ok", text: "Photo uploaded — thanks!" },
        );
      } else {
        setMsg({ tone: "err", text: errorText(res.error) });
      }
      // Always reset the input so re-selecting the same file re-fires onChange.
      if (inputRef.current) inputRef.current.value = "";
    });
  }

  return (
    <div>
      <h3 className="text-sm font-semibold text-foreground">Add a photo</h3>
      <input
        ref={inputRef}
        type="file"
        accept={ACCEPTED_TYPES}
        aria-label="Add a photo"
        disabled={pending}
        onChange={handleChange}
        className="mt-1 block w-full text-sm text-muted file:mr-3 file:rounded-full file:border-0 file:bg-brand file:px-4 file:py-1.5 file:text-sm file:font-semibold file:text-white file:disabled:opacity-50 disabled:opacity-50"
      />
      <p className="mt-1 text-xs text-muted">JPEG, PNG, or WebP, up to 10 MB.</p>
      {pending && (
        <p role="status" aria-live="polite" className="mt-1 text-xs text-muted">
          Uploading…
        </p>
      )}
      {!pending && msg && (
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
