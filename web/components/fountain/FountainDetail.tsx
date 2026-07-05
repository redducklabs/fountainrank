import type React from "react";
import type { FountainDetail as Detail, NoteOut, PhotoOut } from "../../lib/fountains";
import { formatAverage, formatDate, formatVotes } from "../../lib/map/format";
import { ShareButton } from "./ShareButton";
import { Stars } from "./Stars";
import { StatusBlock } from "./StatusBlock";
import { AttributeList } from "./AttributeList";
import { NotesList } from "./NotesList";
import { ContributeSection } from "./ContributeSection";
import { PhotoGallery } from "./PhotoGallery";

export function FountainDetail({
  detail,
  notes,
  photos = [],
  now,
  isAuthenticated,
  adminControls,
  locationLabel,
}: {
  detail: Detail;
  notes: NoteOut[];
  photos?: PhotoOut[];
  now?: Date;
  isAuthenticated: boolean;
  adminControls?: React.ReactNode;
  // The public h1 label, e.g. "Public drinking fountain in Manhattan" — resolved server-side from
  // the fountain's public city (spec §7). Falls back to the generic label when no city resolves (or
  // on the admin path, which does not fetch the public place).
  locationLabel?: string;
}) {
  const renderNow = now ?? new Date();
  const { latitude, longitude } = detail.location;
  const contextComment = detail.comments || detail.placement_note;
  const dir = `https://www.google.com/maps/dir/?api=1&destination=${latitude},${longitude}`;
  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-lg font-bold text-[#0A357E]">
          {locationLabel ?? "Public drinking fountain"}
        </h1>
        <StatusBlock
          currentStatus={detail.current_status}
          isWorking={detail.is_working}
          lastVerifiedAt={detail.last_verified_at}
          now={renderNow}
        />
      </div>
      <PhotoGallery fountainId={detail.id} photos={photos} isAuthenticated={isAuthenticated} />
      {detail.average_rating != null ? (
        <div className="flex items-center gap-3">
          <span className="text-3xl font-extrabold leading-none text-[#0A357E]">
            {formatAverage(detail.average_rating)}
          </span>
          <div className="flex flex-col">
            <Stars value={detail.average_rating} size={18} />
            <span className="text-xs text-slate-500">{formatVotes(detail.rating_count)}</span>
          </div>
        </div>
      ) : (
        <div className="flex items-center gap-2">
          <Stars value={0} size={18} label="Not yet rated" />
          <span className="text-sm font-medium text-slate-500">Not yet rated</span>
        </div>
      )}
      <dl className="space-y-2 border-t border-slate-100 pt-3">
        {detail.dimensions.map((d) => (
          <div
            key={d.rating_type_id}
            className="grid grid-cols-[1fr_auto] items-center gap-x-3 gap-y-1"
          >
            <dt className="text-sm font-medium text-slate-700">{d.name}</dt>
            <dd className="flex items-center gap-2 text-sm">
              {d.average_rating != null ? (
                <>
                  <Stars
                    value={d.average_rating}
                    size={14}
                    label={`${d.name} rated ${d.average_rating.toFixed(1)} out of 5`}
                  />
                  <span className="font-semibold tabular-nums text-[#0A357E]">
                    {d.average_rating.toFixed(1)}
                  </span>
                  <span className="text-xs text-slate-400">({d.vote_count})</span>
                </>
              ) : (
                <span className="text-xs text-slate-400">Not yet rated</span>
              )}
            </dd>
            {d.average_rating != null && (
              <div
                className="col-span-2 h-1.5 overflow-hidden rounded-full bg-slate-100"
                aria-hidden="true"
              >
                <div
                  className="h-full rounded-full bg-[#0E4DA4]"
                  style={{ width: `${(Math.max(0, Math.min(5, d.average_rating)) / 5) * 100}%` }}
                />
              </div>
            )}
          </div>
        ))}
      </dl>
      <AttributeList attributes={detail.attributes} />
      {contextComment && (
        <div>
          <p className="rounded-lg border border-slate-200 bg-slate-50 p-3 text-sm break-words text-slate-700">
            {contextComment}
          </p>
          <p className="mt-1 text-xs text-slate-400">From the person who added this fountain</p>
        </div>
      )}
      <NotesList notes={notes} now={renderNow} />
      {adminControls}
      <ContributeSection
        fountainId={detail.id}
        dimensions={detail.dimensions}
        isAuthenticated={isAuthenticated}
        conditionPointsEligibleAt={detail.condition_points_eligible_at}
      />
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
