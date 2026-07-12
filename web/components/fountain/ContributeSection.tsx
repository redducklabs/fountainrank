"use client";
import type { components } from "@fountainrank/api-client";
import type { ViewerAwardStateT } from "@fountainrank/contributions";
import { signInWithReturn } from "../../app/actions/auth";
import { FormSubmitButton } from "../ui/FormSubmitButton";
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
  conditionPointsEligibleAt,
  viewerAwardState,
  variant = "primary",
}: {
  fountainId: string;
  dimensions: Dimension[];
  isAuthenticated: boolean;
  conditionPointsEligibleAt?: string | null;
  // What this viewer can still EARN here, from the contribution ledger (#204). Null for anonymous
  // viewers. Drives the pre-submit previews so we never promise points a re-submit won't award.
  viewerAwardState?: ViewerAwardStateT | null;
  variant?: "primary" | "details" | "photos";
}) {
  const signInMessage =
    variant === "photos"
      ? "Sign in to add a photo to this fountain."
      : "Sign in to rate this fountain, report its status, or leave a note.";
  return (
    <section className="border-t border-border pt-4">
      <h2 className="text-sm font-bold text-brand-ink">Contribute</h2>
      {!isAuthenticated ? (
        <form action={signInWithReturn.bind(null, `/fountains/${fountainId}`)} className="mt-2">
          <p className="text-sm text-muted">{signInMessage}</p>
          <FormSubmitButton className="mt-2 rounded-full bg-accent-gold px-4 py-2 text-sm font-bold text-brand">
            Sign in to contribute
          </FormSubmitButton>
        </form>
      ) : (
        <div className="mt-2 space-y-4">
          {variant === "primary" ? (
            <>
              <RatingForm
                fountainId={fountainId}
                dimensions={dimensions}
                viewerAwardState={viewerAwardState}
              />
              <PhotoUpload fountainId={fountainId} viewerAwardState={viewerAwardState} />
            </>
          ) : variant === "photos" ? (
            <PhotoUpload fountainId={fountainId} viewerAwardState={viewerAwardState} />
          ) : (
            <>
              <AttributeForm fountainId={fountainId} viewerAwardState={viewerAwardState} />
              <ConditionForm
                fountainId={fountainId}
                conditionPointsEligibleAt={conditionPointsEligibleAt}
              />
              <NoteForm fountainId={fountainId} viewerAwardState={viewerAwardState} />
            </>
          )}
        </div>
      )}
    </section>
  );
}
