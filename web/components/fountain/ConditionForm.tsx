"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { components } from "@fountainrank/api-client";
import {
  conditionPointsBlocked,
  conditionPointsEligibleInText,
  conditionPointsPreview,
} from "@fountainrank/contributions";
import { submitCondition } from "../../app/actions/contribute";
import { conditionStatusLabel } from "../../lib/map/format";
import { PointsPreview } from "../contributions/PointsPreview";
import { errorText } from "./contributeError";

type ConditionStatus = components["schemas"]["ConditionReportRequest"]["status"];
const PROBLEMS: ConditionStatus[] = [
  "broken",
  "low_pressure",
  "dirty",
  "bad_taste",
  "blocked",
  "seasonal_unavailable",
  "hours_limited",
];

export function ConditionForm({
  fountainId,
  conditionPointsEligibleAt,
}: {
  fountainId: string;
  conditionPointsEligibleAt?: string | null;
}) {
  const router = useRouter();
  const [showProblems, setShowProblems] = useState(false);
  const [problem, setProblem] = useState<ConditionStatus>(PROBLEMS[0]);
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<{ tone: "ok" | "err"; text: string } | null>(null);
  const now = new Date();
  const blocked = conditionPointsBlocked(conditionPointsEligibleAt, now);
  const eligibleIn = conditionPointsEligibleInText(conditionPointsEligibleAt, now);

  function report(status: ConditionStatus) {
    start(async () => {
      const res = await submitCondition(fountainId, status);
      if (res.ok) {
        const earned = res.pointsAwarded ?? 0;
        setMsg({
          tone: "ok",
          text:
            earned > 0
              ? `Thanks — you earned ${earned} points.`
              : "Thanks — saved. (Already counted recently, so no points this time.)",
        });
        window.dispatchEvent(new Event("fountainrank:contribution"));
        router.refresh();
      } else {
        setMsg({ tone: "err", text: errorText(res.error) });
      }
    });
  }

  return (
    <div>
      <h3 className="text-sm font-semibold text-slate-700">Is it working?</h3>
      <div className="mt-1 flex flex-wrap items-center gap-2">
        <button
          type="button"
          disabled={pending}
          onClick={() => report("working")}
          className="rounded-full bg-emerald-600 px-4 py-1.5 text-sm font-semibold text-white disabled:opacity-50"
        >
          I checked — it&rsquo;s working
        </button>
        <button
          type="button"
          aria-expanded={showProblems}
          onClick={() => setShowProblems((v) => !v)}
          className="text-sm text-[#0C44A0] underline"
        >
          Report a problem
        </button>
      </div>
      {showProblems && (
        <div className="mt-2 flex items-center gap-2">
          <label className="sr-only" htmlFor="problem-select">
            Problem type
          </label>
          <select
            id="problem-select"
            value={problem}
            onChange={(e) => setProblem(e.target.value as ConditionStatus)}
            className="rounded border border-slate-300 px-2 py-1 text-sm"
          >
            {PROBLEMS.map((p) => (
              <option key={p} value={p}>
                {conditionStatusLabel(p)}
              </option>
            ))}
          </select>
          <button
            type="button"
            disabled={pending}
            onClick={() => report(problem)}
            className="rounded-full bg-[#0A357E] px-3 py-1.5 text-sm font-semibold text-white disabled:opacity-50"
          >
            Submit
          </button>
        </div>
      )}
      <div className="mt-3">
        {blocked ? (
          <p className="rounded-lg border border-amber-300 bg-amber-50 p-2 text-xs font-semibold text-amber-800">
            You&rsquo;ve earned points for updating this fountain recently — you can still update
            its status, but it won&rsquo;t earn points again{eligibleIn ? ` for ${eligibleIn}` : ""}.
          </p>
        ) : (
          <PointsPreview lines={conditionPointsPreview(showProblems ? "problem" : "working")} />
        )}
      </div>
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
