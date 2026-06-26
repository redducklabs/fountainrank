"use client";
import { useEffect, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { attributePointsPreview } from "@fountainrank/contributions";
import { submitAttributes } from "../../app/actions/contribute";
import { buildAttributeGroups, fetchAttributeTypes } from "../../lib/catalog";
import { AttributeObservationFields } from "../map/AttributeObservationFields";
import { PointsPreview } from "../contributions/PointsPreview";
import { errorText } from "./contributeError";

export function AttributeForm({ fountainId }: { fountainId: string }) {
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

  function submit() {
    if (observations.length === 0) {
      setMsg({ tone: "err", text: "Choose at least one detail." });
      return;
    }
    start(async () => {
      const res = await submitAttributes(fountainId, observations);
      if (res.ok) {
        setMsg({ tone: "ok", text: "Thanks — your observations were saved." });
        window.dispatchEvent(new Event("fountainrank:contribution"));
        router.refresh();
      } else {
        setMsg({ tone: "err", text: errorText(res.error) });
      }
    });
  }

  if (loading) return <p className="text-sm text-slate-600">Loading detail options…</p>;
  if (loadError) return <p className="text-sm text-red-700">Detail options could not load.</p>;
  if (groups.length === 0) return null;

  return (
    <div>
      <AttributeObservationFields
        groups={groups}
        value={values}
        onChange={(id, value) => setValues((current) => ({ ...current, [id]: value }))}
      />
      <div className="mt-3">
        <PointsPreview lines={attributePointsPreview(observations.length)} />
      </div>
      <button
        type="button"
        disabled={pending || observations.length === 0}
        onClick={submit}
        className="mt-3 rounded-full bg-[#0A357E] px-4 py-1.5 text-sm font-semibold text-white disabled:opacity-50"
      >
        Save details
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
