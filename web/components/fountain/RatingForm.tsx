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
  const [stars, setStars] = useState<Record<number, number>>({});
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<{ tone: "ok" | "err"; text: string } | null>(null);
  const chosen = Object.entries(stars).filter(([, s]) => s > 0);

  function submit() {
    const ratings = chosen.map(([id, s]) => ({ rating_type_id: Number(id), stars: s }));
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
      <h3 className="text-sm font-semibold text-slate-700">Rate it</h3>
      {dimensions.map((d) => (
        <StarGroup
          key={d.rating_type_id}
          id={d.rating_type_id}
          name={d.name}
          value={stars[d.rating_type_id] ?? 0}
          onChange={(n) => setStars((s) => ({ ...s, [d.rating_type_id]: n }))}
        />
      ))}
      <div className="mt-3">
        <PointsPreview lines={ratingPointsPreview(chosen.length)} />
      </div>
      <button
        type="button"
        disabled={pending || chosen.length === 0}
        onClick={submit}
        className="mt-2 rounded-full bg-[#0A357E] px-4 py-1.5 text-sm font-semibold text-white disabled:opacity-50"
      >
        Submit rating
      </button>
      {msg && (
        <p
          role="status"
          aria-live="polite"
          className={msg.tone === "ok" ? "text-emerald-700" : "text-red-700"}
        >
          {msg.text}
        </p>
      )}
    </div>
  );
}
