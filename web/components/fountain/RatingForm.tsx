"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { components } from "@fountainrank/api-client";
import { ratingEarnablePoints, type ViewerAwardStateT } from "@fountainrank/contributions";
import { submitRating } from "../../app/actions/contribute";
import { dispatchContribution } from "../../lib/contribution-event";
import { getCurrentPositionSafe } from "../../lib/geo/current-position";
import { errorText } from "./contributeError";
import { useRatingDraft } from "./RatingDraftContext";
import { PointsPreview } from "../contributions/PointsPreview";
import { SpinnerButton } from "../ui/SpinnerButton";
import { StarGroup } from "./StarGroup";

type Dimension = components["schemas"]["DimensionSummary"];

export function RatingForm({
  fountainId,
  dimensions,
  viewerAwardState,
}: {
  fountainId: string;
  dimensions: Dimension[];
  viewerAwardState?: ViewerAwardStateT | null;
}) {
  const router = useRouter();
  // The draft is lifted to a context above the tabs so "Add photo" (in another tab) can flush it (#1).
  const { edits, setEdit, clear } = useRatingDraft();
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

  // Only what the viewer can ACTUALLY still earn, per the ledger (#204).
  const earnable = ratingEarnablePoints(
    viewerAwardState,
    chosen.map(([id]) => id),
  );

  function submit() {
    const ratings = chosen.map(([id, s]) => ({ rating_type_id: id, stars: s }));
    start(async () => {
      // Best-effort location for the proximity guard (#3). Never blocks: null on denial/timeout,
      // in which case the rating is accepted server-side but recorded as unverified.
      const coords = await getCurrentPositionSafe();
      const res = await submitRating(fountainId, ratings, coords ?? undefined);
      if (res.ok) {
        clear();
        // The SERVER's award — not `chosen.length * CONTRIBUTION_POINTS.rate`, which fired a fake
        // "+4 points" on every re-rate (#204). 0 means it deduped: say so, and do not celebrate.
        const earned = res.pointsAwarded;
        setMsg({
          tone: "ok",
          text:
            earned > 0
              ? `Thanks — you earned ${earned} points.`
              : "Rating updated. You already earned points for these dimensions, so no points this time.",
        });
        dispatchContribution(earned);
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
        <p className="text-xs font-medium text-brand-ink">
          You&rsquo;ve rated this fountain. Update your stars and submit to change it.
        </p>
      )}
      {dimensions.map((d) => (
        <StarGroup
          key={d.rating_type_id}
          id={d.rating_type_id}
          name={d.name}
          value={effectiveStars[d.rating_type_id] ?? 0}
          onChange={(n) => setEdit(d.rating_type_id, n)}
        />
      ))}
      <div className="mt-3">
        {chosen.length > 0 && earnable.length === 0 ? (
          <p className="rounded-lg border border-amber-300 bg-amber-50 p-2 text-xs font-semibold text-amber-800 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-300">
            You&rsquo;ve already earned points for these dimensions — you can still update your
            rating, but it won&rsquo;t earn points again.
          </p>
        ) : (
          <PointsPreview lines={earnable} />
        )}
      </div>
      <SpinnerButton
        pending={pending}
        disabled={chosen.length === 0}
        onClick={submit}
        className="mt-2 rounded-full bg-brand px-4 py-1.5 text-sm font-semibold text-white disabled:opacity-50"
      >
        {hasExistingRating ? "Update rating" : "Submit rating"}
      </SpinnerButton>
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
