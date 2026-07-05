"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { components } from "@fountainrank/api-client";
import { ratingPointsPreview } from "@fountainrank/contributions";
import { submitRating } from "../../app/actions/contribute";
import { errorText } from "./contributeError";
import { PointsPreview } from "../contributions/PointsPreview";
import { StarGroup } from "./StarGroup";

type Dimension = components["schemas"]["DimensionSummary"];

export function RatingForm({
  fountainId,
  dimensions,
}: {
  fountainId: string;
  dimensions: Dimension[];
}) {
  const router = useRouter();
  const [edits, setEdits] = useState<Record<number, number>>({});
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<{ tone: "ok" | "err"; text: string } | null>(null);
  // Effective stars: an explicit edit wins, else the viewer's saved rating (#65 your_rating),
  // else 0. Derived each render (not synced via an effect) so a previously-rated fountain
  // pre-fills even when your_rating loads after mount, and the user's edits always win (#114).
  const hasExistingRating = dimensions.some((d) => d.your_rating != null);
  const effectiveStars: Record<number, number> = Object.fromEntries(
    dimensions.map((d) => [d.rating_type_id, edits[d.rating_type_id] ?? d.your_rating ?? 0]),
  );
  const chosen = dimensions
    .map((d) => [d.rating_type_id, effectiveStars[d.rating_type_id]] as const)
    .filter(([, s]) => s > 0);

  function submit() {
    const ratings = chosen.map(([id, s]) => ({ rating_type_id: id, stars: s }));
    start(async () => {
      const res = await submitRating(fountainId, ratings);
      if (res.ok) {
        setMsg({ tone: "ok", text: "Thanks — your rating was saved." });
        window.dispatchEvent(new Event("fountainrank:contribution"));
        router.refresh();
      } else {
        setMsg({ tone: "err", text: errorText(res.error) });
      }
    });
  }

  return (
    <div>
      <h3 className="text-sm font-semibold text-foreground">Rate it</h3>
      {hasExistingRating && (
        <p className="text-xs font-medium text-brand">
          You&rsquo;ve rated this fountain. Update your stars and submit to change it.
        </p>
      )}
      {dimensions.map((d) => (
        <StarGroup
          key={d.rating_type_id}
          id={d.rating_type_id}
          name={d.name}
          value={effectiveStars[d.rating_type_id] ?? 0}
          onChange={(n) => setEdits((s) => ({ ...s, [d.rating_type_id]: n }))}
        />
      ))}
      <div className="mt-3">
        <PointsPreview lines={ratingPointsPreview(chosen.length)} />
      </div>
      <button
        type="button"
        disabled={pending || chosen.length === 0}
        onClick={submit}
        className="mt-2 rounded-full bg-brand px-4 py-1.5 text-sm font-semibold text-white disabled:opacity-50"
      >
        {hasExistingRating ? "Update rating" : "Submit rating"}
      </button>
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
