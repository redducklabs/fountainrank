"use client";
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { signInWithReturn } from "../../app/actions/auth";
import type { AddFountainError } from "../../lib/add-fountain";
import { COMMENTS_MAX } from "../../lib/add-fountain";
import type { AddPhase } from "../../lib/add-fountain-machine";
import type { AttributeGroup } from "../../lib/catalog";
import type { LngLat } from "../../lib/map/placement";
import type { components } from "@fountainrank/api-client";
import { AttributeObservationFields } from "./AttributeObservationFields";
import { RatingFields } from "./RatingFields";

export type AddFountainPanelProps = {
  phase: AddPhase;
  pin: LngLat | null;
  working: boolean;
  placeable: boolean;
  gpsUnavailable: boolean;
  duplicateId: string | null;
  errorKind: AddFountainError | null;
  onCancel: () => void;
  onPlaceAtCenter: () => void;
  onNudge: (dir: "n" | "s" | "e" | "w") => void;
  onNext: () => void;
  onBack: () => void;
  onSetWorking: (working: boolean) => void;
  onSubmit: () => void;
  onViewDuplicate?: () => void;
  // Optional PR-2 fields
  ratingTypes?: components["schemas"]["RatingTypeOut"][];
  attributeGroups?: AttributeGroup[];
  ratingValue?: Record<number, number>;
  obsValue?: Record<number, string>;
  comments?: string;
  onRate?: (id: number, stars: number) => void;
  onObserve?: (id: number, v: string) => void;
  onComments?: (v: string) => void;
};

const ERROR_COPY: Record<AddFountainError, string> = {
  unauthenticated: "Your session expired — sign in to finish.",
  validation: "Something about this fountain looks off. Check the details and try again.",
  server: "Couldn't add the fountain — please try again.",
};

export function AddFountainPanel(props: AddFountainPanelProps) {
  const { phase, onCancel } = props;
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (phase === "idle") return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onCancel();
    };
    document.addEventListener("keydown", onKey);
    ref.current?.focus();
    return () => document.removeEventListener("keydown", onKey);
  }, [phase, onCancel]);

  if (phase === "idle") return null;
  return (
    <div
      ref={ref}
      role="dialog"
      aria-label="Add a fountain"
      tabIndex={-1}
      className="absolute inset-x-0 bottom-0 z-40 mx-auto max-w-md rounded-t-2xl border border-slate-200 bg-white p-4 shadow-2xl outline-none sm:bottom-4 sm:left-auto sm:right-4 sm:mx-0 sm:rounded-2xl"
    >
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-bold text-[#0A357E]">Add a fountain</h2>
        <button
          type="button"
          onClick={onCancel}
          aria-label="Cancel"
          className="rounded p-1 text-slate-500 hover:bg-slate-100"
        >
          ✕
        </button>
      </div>
      {phase === "placing" && <PlacingStep {...props} />}
      {phase === "details" && <DetailsStep {...props} />}
      {(phase === "submitting" || phase === "done") && (
        <p role="status" className="mt-3 text-sm text-slate-600">
          {phase === "submitting" ? "Adding…" : "Fountain added."}
        </p>
      )}
      {phase === "duplicate" && (
        <div className="mt-3 space-y-2">
          <p role="status" className="text-sm text-slate-700">
            A fountain already exists here.
          </p>
          {props.duplicateId && (
            <Link
              href={`/fountains/${props.duplicateId}`}
              onClick={props.onViewDuplicate}
              className="inline-block rounded-full bg-[#F2C200] px-4 py-2 text-sm font-bold text-[#0A357E]"
            >
              View it
            </Link>
          )}
        </div>
      )}
      {phase === "error" && (
        <div className="mt-3 space-y-2">
          <p role="status" className="text-sm text-red-700">
            {props.errorKind ? ERROR_COPY[props.errorKind] : ERROR_COPY.server}
          </p>
          {props.errorKind === "unauthenticated" ? (
            // An expired session can't be retried — send the user back through sign-in (spec §8),
            // returning to the add flow. A "use server" action must run from a form action, not onClick.
            <form action={signInWithReturn.bind(null, "/?add=1")}>
              <button
                type="submit"
                className="rounded-full bg-[#F2C200] px-4 py-2 text-sm font-bold text-[#0A357E]"
              >
                Sign in
              </button>
            </form>
          ) : (
            <button
              type="button"
              onClick={props.onSubmit}
              className="rounded-full bg-[#0A357E] px-4 py-2 text-sm font-bold text-white"
            >
              Try again
            </button>
          )}
        </div>
      )}
    </div>
  );
}

function Coord({ pin }: { pin: LngLat | null }) {
  if (!pin) return <p className="mt-2 text-xs text-slate-500">Drop a pin to set the location.</p>;
  return (
    <p className="mt-2 text-xs tabular-nums text-slate-500">
      Lat {pin.lat.toFixed(5)} · Lng {pin.lng.toFixed(5)}
    </p>
  );
}

function PlacingStep(props: AddFountainPanelProps) {
  const dirs = { n: "north", s: "south", e: "east", w: "west" } as const;
  const glyph = { n: "↑", s: "↓", e: "→", w: "←" } as const;
  return (
    <div>
      <p className="mt-1 text-sm text-slate-600">
        Tap the map where the fountain is, then drag the pin to fine-tune.
      </p>
      {props.gpsUnavailable && (
        <p className="mt-2 rounded bg-amber-50 px-2 py-1 text-xs text-amber-800">
          We couldn&rsquo;t confirm your location — make sure the pin is exactly where the fountain
          is.
        </p>
      )}
      {!props.placeable && (
        <p className="mt-2 text-xs text-slate-500">Zoom in to place the fountain.</p>
      )}
      <Coord pin={props.pin} />
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={props.onPlaceAtCenter}
          disabled={!props.placeable}
          className="rounded-full border border-slate-300 px-3 py-1.5 text-sm text-slate-700 disabled:opacity-40"
        >
          Place at map center
        </button>
        <span className="inline-flex gap-1">
          {(["n", "s", "e", "w"] as const).map((d) => (
            <button
              key={d}
              type="button"
              onClick={() => props.onNudge(d)}
              disabled={!props.pin || !props.placeable}
              aria-label={`Nudge ${dirs[d]}`}
              className="rounded border border-slate-300 px-2 py-1 text-xs disabled:opacity-40"
            >
              {glyph[d]}
            </button>
          ))}
        </span>
      </div>
      <div className="mt-3 flex justify-end">
        <button
          type="button"
          onClick={props.onNext}
          disabled={!props.pin || !props.placeable}
          className="rounded-full bg-[#0A357E] px-4 py-2 text-sm font-bold text-white disabled:opacity-40"
        >
          Next: details
        </button>
      </div>
    </div>
  );
}

function DetailsStep(props: AddFountainPanelProps) {
  const [showMoreDetails, setShowMoreDetails] = useState(false);
  const commentsLen = (props.comments ?? "").length;
  return (
    <div className="mt-2">
      <Coord pin={props.pin} />
      <fieldset className="mt-3">
        <legend className="text-sm font-semibold text-slate-700">Is it working?</legend>
        <div className="mt-1 flex gap-4">
          <label className="flex items-center gap-2 text-sm">
            <input
              type="radio"
              name="working"
              checked={props.working}
              onChange={() => props.onSetWorking(true)}
            />
            Yes
          </label>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="radio"
              name="working"
              checked={!props.working}
              onChange={() => props.onSetWorking(false)}
            />
            No
          </label>
        </div>
      </fieldset>
      {props.ratingTypes && props.ratingTypes.length > 0 && props.onRate && (
        <RatingFields
          types={props.ratingTypes}
          value={props.ratingValue ?? {}}
          onChange={props.onRate}
        />
      )}
      {props.onComments !== undefined && (
        <div className="mt-3">
          <label className="block text-sm font-semibold text-slate-700" htmlFor="add-comments">
            Comments (optional)
          </label>
          <textarea
            id="add-comments"
            className="mt-1 w-full rounded border border-slate-300 px-2 py-1 text-sm"
            rows={3}
            maxLength={COMMENTS_MAX}
            value={props.comments ?? ""}
            onChange={(e) => props.onComments!(e.target.value)}
            aria-label="Comments"
          />
          <p className="mt-0.5 text-right text-xs text-slate-400">
            {commentsLen}/{COMMENTS_MAX}
          </p>
        </div>
      )}
      {props.attributeGroups && props.attributeGroups.length > 0 && props.onObserve && (
        <div className="mt-3">
          <button
            type="button"
            onClick={() => setShowMoreDetails((current) => !current)}
            className="rounded-full border border-slate-300 px-3 py-1.5 text-sm font-semibold text-[#0A357E]"
          >
            {showMoreDetails ? "Hide More Details" : "More Details"}
          </button>
          {showMoreDetails && (
            <AttributeObservationFields
              groups={props.attributeGroups}
              value={props.obsValue ?? {}}
              onChange={props.onObserve}
            />
          )}
        </div>
      )}
      <div className="mt-4 flex justify-between">
        <button type="button" onClick={props.onBack} className="text-sm text-slate-600 underline">
          Back
        </button>
        <button
          type="button"
          onClick={props.onSubmit}
          className="rounded-full bg-[#F2C200] px-4 py-2 text-sm font-bold text-[#0A357E]"
        >
          Add fountain
        </button>
      </div>
    </div>
  );
}
