import {
  statusDisplay,
  formatRelativeTime,
  formatDateFull,
  type StatusTone,
} from "../../lib/map/format";

const CHIP: Record<StatusTone, string> = {
  ok: "bg-emerald-100 text-emerald-800",
  warn: "bg-amber-100 text-amber-800",
  bad: "bg-red-100 text-red-800",
};

export function StatusBlock({
  currentStatus,
  isWorking,
  lastVerifiedAt,
  now,
}: {
  currentStatus: string | null | undefined;
  isWorking: boolean;
  lastVerifiedAt: string | null | undefined;
  now: Date;
}) {
  const { chipLabel, chipTone, advisory } = statusDisplay(currentStatus, isWorking);
  return (
    <div className="mt-1 space-y-1">
      <span
        className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-bold ${CHIP[chipTone]}`}
      >
        {chipLabel}
      </span>
      {advisory && (
        <p className="text-xs text-amber-700">
          <span aria-hidden="true">⚠ </span>
          {advisory}
        </p>
      )}
      <p className="text-xs text-slate-400">
        {lastVerifiedAt ? (
          <span title={formatDateFull(lastVerifiedAt)}>
            Last verified {formatRelativeTime(lastVerifiedAt, now)}
          </span>
        ) : (
          "Not yet verified by anyone"
        )}
      </p>
    </div>
  );
}
