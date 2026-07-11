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
import { dispatchContribution } from "../../lib/contribution-event";
import { getCurrentPositionSafe } from "../../lib/geo/current-position";
import { conditionStatusLabel } from "../../lib/map/format";
import { PointsPreview } from "../contributions/PointsPreview";
import { SpinnerButton } from "../ui/SpinnerButton";
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
      // Best-effort location so the server can derive is_proximate (#3); never blocks (null ok).
      const coords = await getCurrentPositionSafe();
      const res = await submitCondition(fountainId, status, coords ?? undefined);
      if (res.ok) {
        const earned = res.pointsAwarded ?? 0;
        setMsg({
          tone: "ok",
          text:
            earned > 0
              ? `Thanks — you earned ${earned} points.`
              : "Thanks — saved. (Already counted recently, so no points this time.)",
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
      <h3 className="text-sm font-semibold text-foreground">Is it working?</h3>
      <div className="mt-1 flex flex-wrap items-center gap-2">
        <SpinnerButton
          pending={pending}
          onClick={() => report("working")}
          className="rounded-full bg-emerald-600 px-4 py-1.5 text-sm font-semibold text-white disabled:opacity-50"
        >
          I checked — it&rsquo;s working
        </SpinnerButton>
        <button
          type="button"
          aria-expanded={showProblems}
          onClick={() => setShowProblems((v) => !v)}
          className="text-sm text-brand-ink underline"
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
            className="rounded border border-border px-2 py-1 text-sm"
          >
            {PROBLEMS.map((p) => (
              <option key={p} value={p}>
                {conditionStatusLabel(p)}
              </option>
            ))}
          </select>
          <SpinnerButton
            pending={pending}
            onClick={() => report(problem)}
            className="rounded-full bg-brand px-3 py-1.5 text-sm font-semibold text-white disabled:opacity-50"
          >
            Submit
          </SpinnerButton>
        </div>
      )}
      <div className="mt-3">
        {blocked ? (
          <p className="rounded-lg border border-amber-300 bg-amber-50 p-2 text-xs font-semibold text-amber-800 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-300">
            You&rsquo;ve earned points for updating this fountain recently — you can still update
            its status, but it won&rsquo;t earn points again{eligibleIn ? ` for ${eligibleIn}` : ""}
            .
          </p>
        ) : (
          <PointsPreview lines={conditionPointsPreview(showProblems ? "problem" : "working")} />
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
