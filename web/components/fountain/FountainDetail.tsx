import type { FountainDetail as Detail, NoteOut } from "../../lib/fountains";
import { formatAverage, formatDate, formatDimension, formatVotes } from "../../lib/map/format";
import { ShareButton } from "./ShareButton";
import { StatusBlock } from "./StatusBlock";
import { AttributeList } from "./AttributeList";
import { NotesList } from "./NotesList";

export function FountainDetail({
  detail,
  notes,
  now,
}: {
  detail: Detail;
  notes: NoteOut[];
  now?: Date;
}) {
  const renderNow = now ?? new Date();
  const { latitude, longitude } = detail.location;
  const dir = `https://www.google.com/maps/dir/?api=1&destination=${latitude},${longitude}`;
  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-lg font-bold text-[#0A357E]">Public drinking fountain</h1>
        <StatusBlock
          currentStatus={detail.current_status}
          isWorking={detail.is_working}
          lastVerifiedAt={detail.last_verified_at}
          now={renderNow}
        />
      </div>
      {detail.placement_note && (
        <p className="text-sm break-words text-slate-600">
          <span aria-hidden="true">📍 </span>
          {detail.placement_note}
        </p>
      )}
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
      <AttributeList attributes={detail.attributes} />
      {detail.comments && (
        <div>
          <p className="rounded-lg border border-slate-200 bg-slate-50 p-3 text-sm break-words text-slate-700">
            {detail.comments}
          </p>
          <p className="mt-1 text-xs text-slate-400">From the person who added this fountain</p>
        </div>
      )}
      <NotesList notes={notes} now={renderNow} />
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
    </div>
  );
}
