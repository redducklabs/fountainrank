"use client";
import type { components } from "@fountainrank/api-client";
import { useState } from "react";
import { signInWithReturn } from "../../app/actions/auth";
import { AttributeForm } from "./AttributeForm";
import { RatingForm } from "./RatingForm";
import { ConditionForm } from "./ConditionForm";
import { NoteForm } from "./NoteForm";
import { PhotoUpload } from "./PhotoUpload";

type Dimension = components["schemas"]["DimensionSummary"];

export function ContributeSection({
  fountainId,
  dimensions,
  isAuthenticated,
}: {
  fountainId: string;
  dimensions: Dimension[];
  isAuthenticated: boolean;
}) {
  const [showMoreDetails, setShowMoreDetails] = useState(false);
  return (
    <section className="border-t border-slate-100 pt-4">
      <h2 className="text-sm font-bold text-[#0A357E]">Contribute</h2>
      {!isAuthenticated ? (
        <form action={signInWithReturn.bind(null, `/fountains/${fountainId}`)} className="mt-2">
          <p className="text-sm text-slate-600">
            Sign in to rate this fountain, report its status, or leave a note.
          </p>
          <button
            type="submit"
            className="mt-2 rounded-full bg-[#F2C200] px-4 py-2 text-sm font-bold text-[#0A357E]"
          >
            Sign in to contribute
          </button>
        </form>
      ) : (
        <div className="mt-2 space-y-4">
          <RatingForm fountainId={fountainId} dimensions={dimensions} />
          <div>
            <button
              type="button"
              aria-expanded={showMoreDetails}
              onClick={() => setShowMoreDetails((current) => !current)}
              className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm font-semibold text-[#0A357E]"
            >
              {showMoreDetails ? "Hide More details" : "More details"}
            </button>
            {showMoreDetails && (
              <div className="mt-3 space-y-4">
                <AttributeForm fountainId={fountainId} />
                <ConditionForm fountainId={fountainId} />
                <NoteForm fountainId={fountainId} />
                <PhotoUpload fountainId={fountainId} />
              </div>
            )}
          </div>
        </div>
      )}
    </section>
  );
}
