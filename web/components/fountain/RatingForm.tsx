"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { components } from "@fountainrank/api-client";
import { submitRating } from "../../app/actions/contribute";
import { errorText } from "./contributeError";

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
        <fieldset key={d.rating_type_id} className="flex items-center justify-between py-1">
          <legend className="text-sm">{d.name}</legend>
          <span className="flex gap-1">
            {[1, 2, 3, 4, 5].map((n) => {
              const inputId = `dim-${d.rating_type_id}-star-${n}`;
              return (
                <span key={n} className="inline-flex">
                  <input
                    type="radio"
                    id={inputId}
                    name={`dim-${d.rating_type_id}`}
                    value={n}
                    checked={stars[d.rating_type_id] === n}
                    aria-label={`${d.name}: ${n} star${n > 1 ? "s" : ""}`}
                    onChange={() => setStars((s) => ({ ...s, [d.rating_type_id]: n }))}
                    className="peer sr-only"
                  />
                  <label
                    htmlFor={inputId}
                    aria-hidden="true"
                    className={`cursor-pointer text-lg peer-focus-visible:outline peer-focus-visible:outline-2 peer-focus-visible:outline-[#0A357E] ${
                      stars[d.rating_type_id] >= n ? "text-[#F2C200]" : "text-slate-300"
                    }`}
                  >
                    ★
                  </label>
                </span>
              );
            })}
          </span>
        </fieldset>
      ))}
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
