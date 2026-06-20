import type { FountainDetail as Detail } from "../../lib/fountains";
import { formatAverage, formatDate, formatDimension, formatVotes } from "../../lib/map/format";
import { ShareButton } from "./ShareButton";

export function FountainDetail({ detail }: { detail: Detail }) {
  const { latitude, longitude } = detail.location;
  const dir = `https://www.google.com/maps/dir/?api=1&destination=${latitude},${longitude}`;
  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-lg font-bold text-[#0A357E]">Public drinking fountain</h1>
        <span
          className={`mt-1 inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-bold ${
            detail.is_working ? "bg-emerald-100 text-emerald-800" : "bg-red-100 text-red-800"
          }`}
        >
          {detail.is_working ? "Working" : "Out of order"}
        </span>
      </div>
      <div className="flex items-baseline gap-2">
        <span className="text-2xl font-extrabold text-[#0A357E]">
          {formatAverage(detail.average_rating ?? null)}
        </span>
        {detail.average_rating != null && (
          <>
            <span className="text-sm text-slate-500">·</span>{" "}
            <span className="text-sm text-slate-500">{formatVotes(detail.rating_count)}</span>
          </>
        )}
      </div>
      <dl className="divide-y divide-slate-100 border-t border-slate-100">
        {detail.dimensions.map((d) => (
          <div key={d.rating_type_id} className="flex items-center justify-between py-2">
            <dt className="text-sm font-medium">{d.name}</dt>
            <dd className="text-sm text-slate-600">
              {formatDimension(d.average_rating ?? null, d.vote_count)}
            </dd>
          </div>
        ))}
      </dl>
      {detail.comments && (
        <p className="rounded-lg border border-slate-200 bg-slate-50 p-3 text-sm text-slate-700">
          {detail.comments}
        </p>
      )}
      <p className="text-xs text-slate-400">
        Added {formatDate(detail.created_at)}
        {detail.last_rated_at ? ` · Last rated ${formatDate(detail.last_rated_at)}` : ""}
      </p>
      <div className="flex gap-2">
        <a
          href={dir}
          target="_blank"
          rel="noopener noreferrer"
          className="rounded-full bg-[#F2C200] px-4 py-2 text-sm font-bold text-[#0A357E]"
        >
          Directions
        </a>
        <ShareButton />
      </div>
      <p className="text-xs text-slate-400">
        &ldquo;Rate this fountain&rdquo; arrives in Phase 3b.
      </p>
    </div>
  );
}
