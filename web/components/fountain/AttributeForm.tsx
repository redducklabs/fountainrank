"use client";
import { useEffect, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { attributeEarnablePoints, type ViewerAwardStateT } from "@fountainrank/contributions";
import { submitAttributes } from "../../app/actions/contribute";
import { dispatchContribution } from "../../lib/contribution-event";
import { buildAttributeGroups, fetchAttributeTypes } from "../../lib/catalog";
import { AttributeObservationFields } from "../map/AttributeObservationFields";
import { PointsPreview } from "../contributions/PointsPreview";
import { SpinnerButton } from "../ui/SpinnerButton";
import { errorText } from "./contributeError";

export function AttributeForm({
  fountainId,
  viewerAwardState,
}: {
  fountainId: string;
  viewerAwardState?: ViewerAwardStateT | null;
}) {
  const router = useRouter();
  const [values, setValues] = useState<Record<number, string>>({});
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<{ tone: "ok" | "err"; text: string } | null>(null);
  const [groups, setGroups] = useState<ReturnType<typeof buildAttributeGroups>>([]);

  useEffect(() => {
    let cancelled = false;
    fetchAttributeTypes()
      .then((types) => {
        if (cancelled) return;
        setGroups(buildAttributeGroups(types.filter((type) => type.place_type === "fountain")));
        setLoading(false);
      })
      .catch(() => {
        if (cancelled) return;
        setLoadError(true);
        setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const observations = useMemo(
    () =>
      Object.entries(values)
        .filter(([, value]) => value && value !== "unknown")
        .map(([id, value]) => ({ attribute_type_id: Number(id), value })),
    [values],
  );

  const earnable = attributeEarnablePoints(
    viewerAwardState,
    observations.map((o) => o.attribute_type_id),
  );

  function submit() {
    if (observations.length === 0) {
      setMsg({ tone: "err", text: "Choose at least one detail." });
      return;
    }
    start(async () => {
      const res = await submitAttributes(fountainId, observations);
      if (res.ok) {
        const earned = res.pointsAwarded; // the server's award, not a guess (#204)
        setMsg({
          tone: "ok",
          text:
            earned > 0
              ? `Thanks — you earned ${earned} points.`
              : "Details saved. You already earned points for these, so no points this time.",
        });
        dispatchContribution(earned);
        router.refresh();
      } else {
        setMsg({ tone: "err", text: errorText(res.error) });
      }
    });
  }

  if (loading) return <p className="text-sm text-muted">Loading detail options…</p>;
  if (loadError) return <p className="text-sm text-danger">Detail options could not load.</p>;
  if (groups.length === 0) return null;

  return (
    <div>
      <AttributeObservationFields
        groups={groups}
        value={values}
        onChange={(id, value) => setValues((current) => ({ ...current, [id]: value }))}
      />
      <div className="mt-3">
        {observations.length > 0 && earnable.length === 0 ? (
          <p className="rounded-lg border border-amber-300 bg-amber-50 p-2 text-xs font-semibold text-amber-800 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-300">
            You&rsquo;ve already earned points for these details — you can still update them, but
            they won&rsquo;t earn points again.
          </p>
        ) : (
          <PointsPreview lines={earnable} />
        )}
      </div>
      <SpinnerButton
        pending={pending}
        disabled={observations.length === 0}
        onClick={submit}
        className="mt-3 rounded-full bg-brand px-4 py-1.5 text-sm font-semibold text-white disabled:opacity-50"
      >
        Save details
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
