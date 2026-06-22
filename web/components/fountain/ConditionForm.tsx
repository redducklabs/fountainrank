"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { components } from "@fountainrank/api-client";
import { submitCondition } from "../../app/actions/contribute";
import { conditionStatusLabel } from "../../lib/map/format";
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

export function ConditionForm({ fountainId }: { fountainId: string }) {
  const router = useRouter();
  const [showProblems, setShowProblems] = useState(false);
  const [problem, setProblem] = useState<ConditionStatus>(PROBLEMS[0]);
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<{ tone: "ok" | "err"; text: string } | null>(null);

  function report(status: ConditionStatus) {
    start(async () => {
      const res = await submitCondition(fountainId, status);
      if (res.ok) {
        setMsg({ tone: "ok", text: "Thanks — your report was saved." });
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
